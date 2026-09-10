<?php
/**
 * Contact form — mail-only, anti-spam hardened.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

const OTONASELECT_OPTION_CONTACT_EMAIL = 'otonaselect_contact_notify_email';
const OTONASELECT_OPTION_CONTACT_LOG = 'otonaselect_contact_abuse_log';

/**
 * @return list<string>
 */
function otonaselect_contact_types(): array {
	return [
		'サイトについて',
		'掲載内容について',
		'広告・提携について',
		'権利関係について',
		'その他',
	];
}

function otonaselect_contact_notify_email(): string {
	if (defined('OTONASELECT_CONTACT_NOTIFY_EMAIL') && is_string(OTONASELECT_CONTACT_NOTIFY_EMAIL)) {
		$from_const = trim(OTONASELECT_CONTACT_NOTIFY_EMAIL);
		if ($from_const !== '' && is_email($from_const)) {
			return $from_const;
		}
	}
	$opt = get_option(OTONASELECT_OPTION_CONTACT_EMAIL, '');
	if (is_string($opt) && is_email($opt)) {
		return $opt;
	}
	$admin = get_option('admin_email');
	return is_string($admin) && is_email($admin) ? $admin : '';
}

/**
 * @param array<string, mixed> $entry
 */
function otonaselect_contact_log_abuse(string $reason, array $entry = []): void {
	$log = get_option(OTONASELECT_OPTION_CONTACT_LOG, []);
	if (!is_array($log)) {
		$log = [];
	}
	$log[] = [
		'at' => gmdate('c'),
		'reason' => substr(sanitize_key($reason), 0, 40),
		'ipHash' => isset($_SERVER['REMOTE_ADDR']) ? substr(hash('sha256', (string) $_SERVER['REMOTE_ADDR']), 0, 12) : '',
		'meta' => [
			'type' => isset($entry['type']) ? substr(sanitize_text_field((string) $entry['type']), 0, 40) : '',
		],
	];
	if (count($log) > 80) {
		$log = array_slice($log, -80);
	}
	update_option(OTONASELECT_OPTION_CONTACT_LOG, $log, false);
}

function otonaselect_contact_client_key(): string {
	$ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : 'unknown';
	$ua = isset($_SERVER['HTTP_USER_AGENT']) ? (string) $_SERVER['HTTP_USER_AGENT'] : '';
	return md5($ip . '|' . substr($ua, 0, 80));
}

/**
 * Strip header injection / control characters.
 */
function otonaselect_contact_sanitize_header_value(string $value): string {
	$value = str_replace(["\r", "\n", "%0a", "%0d", "%0A", "%0D"], '', $value);
	return trim($value);
}

function otonaselect_contact_sanitize_body(string $body): string {
	$body = wp_strip_all_tags($body);
	$body = preg_replace('/[^\P{C}\n\t]/u', '', $body) ?? $body;
	return trim($body);
}

/**
 * @return array{ok:bool,message:string,code?:string}
 */
function otonaselect_contact_handle_submit(array $post): array {
	$fail = static fn (string $code): array => [
		'ok' => false,
		'message' => '送信できませんでした。時間をおいて再度お試しください。',
		'code' => $code,
	];

	$nonce = isset($post['otonaselect_contact_nonce']) ? (string) $post['otonaselect_contact_nonce'] : '';
	if (!wp_verify_nonce($nonce, 'otonaselect_contact_submit')) {
		otonaselect_contact_log_abuse('csrf');
		return $fail('csrf');
	}

	// Honeypot
	$honey = isset($post['otonaselect_hp_company']) ? trim((string) $post['otonaselect_hp_company']) : '';
	if ($honey !== '') {
		otonaselect_contact_log_abuse('honeypot');
		return ['ok' => true, 'message' => 'お問い合わせを受け付けました。', 'code' => 'honeypot_silent'];
	}

	$started = isset($post['otonaselect_form_started']) ? (int) $post['otonaselect_form_started'] : 0;
	$now = time();
	if ($started <= 0 || ($now - $started) < 3) {
		otonaselect_contact_log_abuse('too_fast');
		return $fail('too_fast');
	}
	if (($now - $started) > 86400) {
		otonaselect_contact_log_abuse('stale_form');
		return $fail('stale');
	}

	$client = otonaselect_contact_client_key();
	$rl = (int) get_transient('otonaselect_contact_rl_' . $client);
	if ($rl >= 5) {
		otonaselect_contact_log_abuse('rate_limit');
		return $fail('rate_limit');
	}

	$name = isset($post['otonaselect_name']) ? sanitize_text_field((string) $post['otonaselect_name']) : '';
	$email = isset($post['otonaselect_email']) ? sanitize_email((string) $post['otonaselect_email']) : '';
	$type = isset($post['otonaselect_type']) ? sanitize_text_field((string) $post['otonaselect_type']) : '';
	$body = isset($post['otonaselect_body']) ? otonaselect_contact_sanitize_body((string) $post['otonaselect_body']) : '';

	$name = otonaselect_contact_sanitize_header_value($name);
	$email = otonaselect_contact_sanitize_header_value($email);

	if ($name === '' || mb_strlen($name) > 80) {
		return $fail('name');
	}
	if ($email === '' || !is_email($email) || mb_strlen($email) > 120) {
		return $fail('email');
	}
	if (!in_array($type, otonaselect_contact_types(), true)) {
		return $fail('type');
	}
	if ($body === '' || mb_strlen($body) < 5 || mb_strlen($body) > 4000) {
		return $fail('body');
	}

	$url_count = preg_match_all('#https?://#i', $body) ?: 0;
	if ($url_count >= 4) {
		otonaselect_contact_log_abuse('url_spam', ['type' => $type]);
		return $fail('url_spam');
	}

	$dup_hash = hash('sha256', strtolower($email) . '|' . $type . '|' . $body);
	$dup_key = 'otonaselect_contact_dup_' . $dup_hash;
	if (get_transient($dup_key)) {
		otonaselect_contact_log_abuse('duplicate');
		return $fail('duplicate');
	}

	$to = otonaselect_contact_notify_email();
	if ($to === '') {
		otonaselect_contact_log_abuse('no_recipient');
		return $fail('config');
	}

	$site = wp_parse_url(home_url(), PHP_URL_HOST) ?: 'otonaselect.net';
	$subject = otonaselect_contact_sanitize_header_value('[オトナセレクト] お問い合わせ: ' . $type);
	$when = wp_date('Y-m-d H:i:s') ?: gmdate('Y-m-d H:i:s');
	$message = "送信日時: {$when}\n"
		. "お名前: {$name}\n"
		. "メールアドレス: {$email}\n"
		. "お問い合わせ種別: {$type}\n"
		. "----\n"
		. $body
		. "\n";

	$from_email = 'noreply@' . preg_replace('/^www\./', '', (string) $site);
	if (!is_email($from_email)) {
		$from_email = get_option('admin_email');
		$from_email = is_string($from_email) ? $from_email : $to;
	}

	$headers = [
		'Content-Type: text/plain; charset=UTF-8',
		'From: オトナセレクト <' . otonaselect_contact_sanitize_header_value((string) $from_email) . '>',
		'Reply-To: ' . otonaselect_contact_sanitize_header_value($name) . ' <' . $email . '>',
	];

	$sent = wp_mail($to, $subject, $message, $headers);
	if (!$sent) {
		otonaselect_contact_log_abuse('mail_failed', ['type' => $type]);
		return $fail('mail');
	}

	set_transient($dup_key, 1, 10 * MINUTE_IN_SECONDS);
	set_transient('otonaselect_contact_rl_' . $client, $rl + 1, 15 * MINUTE_IN_SECONDS);

	return ['ok' => true, 'message' => 'お問い合わせを受け付けました。'];
}

function otonaselect_contact_form_markup(?array $result = null): string {
	$types = otonaselect_contact_types();
	$msg = '';
	if (is_array($result)) {
		$class = !empty($result['ok']) ? 'is-success' : 'is-error';
		$msg = '<div class="otonaselect-contact-message ' . esc_attr($class) . '" role="status">'
			. esc_html((string) ($result['message'] ?? ''))
			. '</div>';
	}

	$action = esc_url(get_permalink() ?: '');
	$nonce = wp_nonce_field('otonaselect_contact_submit', 'otonaselect_contact_nonce', true, false);
	$started = (string) time();

	$options = '';
	foreach ($types as $type) {
		$options .= '<option value="' . esc_attr($type) . '">' . esc_html($type) . '</option>';
	}

	return <<<HTML
{$msg}
<form class="otonaselect-contact-form" method="post" action="{$action}" novalidate>
	{$nonce}
	<input type="hidden" name="otonaselect_contact_submit" value="1" />
	<input type="hidden" name="otonaselect_form_started" value="{$started}" />
	<p class="otonaselect-hp-field" aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;">
		<label>Company<input type="text" name="otonaselect_hp_company" value="" tabindex="-1" autocomplete="off" /></label>
	</p>
	<p>
		<label for="otonaselect_name">お名前 <span class="required">必須</span></label>
		<input id="otonaselect_name" name="otonaselect_name" type="text" required maxlength="80" autocomplete="name" />
	</p>
	<p>
		<label for="otonaselect_email">メールアドレス <span class="required">必須</span></label>
		<input id="otonaselect_email" name="otonaselect_email" type="email" required maxlength="120" autocomplete="email" />
	</p>
	<p>
		<label for="otonaselect_type">お問い合わせ種別 <span class="required">必須</span></label>
		<select id="otonaselect_type" name="otonaselect_type" required>
			<option value="">選択してください</option>
			{$options}
		</select>
	</p>
	<p>
		<label for="otonaselect_body">本文 <span class="required">必須</span></label>
		<textarea id="otonaselect_body" name="otonaselect_body" rows="8" required maxlength="4000"></textarea>
	</p>
	<p><button type="submit" class="otonaselect-contact-submit">送信する</button></p>
</form>
HTML;
}

add_shortcode('otonaselect_contact_form', static function (): string {
	return otonaselect_contact_form_markup();
});

add_action('template_redirect', static function (): void {
	if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
		return;
	}
	if (empty($_POST['otonaselect_contact_submit'])) {
		return;
	}
	if (!is_page('contact')) {
		return;
	}
	$result = otonaselect_contact_handle_submit(wp_unslash($_POST));
	$GLOBALS['otonaselect_contact_result'] = $result;
});

add_filter('the_content', static function (string $content): string {
	if (!is_page('contact') || !in_the_loop() || !is_main_query()) {
		return $content;
	}
	$result = $GLOBALS['otonaselect_contact_result'] ?? null;
	$form = otonaselect_contact_form_markup(is_array($result) ? $result : null);
	if (str_contains($content, 'otonaselect-contact-form') || str_contains($content, '[otonaselect_contact_form]')) {
		return $content;
	}
	return $content . "\n\n" . $form;
}, 12);

add_action('admin_init', static function (): void {
	register_setting('general', OTONASELECT_OPTION_CONTACT_EMAIL, [
		'type' => 'string',
		'sanitize_callback' => static function ($value) {
			$value = is_string($value) ? sanitize_email($value) : '';
			return is_email($value) ? $value : '';
		},
		'default' => '',
	]);
	add_settings_field(
		OTONASELECT_OPTION_CONTACT_EMAIL,
		'オトナセレクト 問い合わせ通知先',
		static function (): void {
			$value = otonaselect_contact_notify_email();
			echo '<input type="email" class="regular-text" name="' . esc_attr(OTONASELECT_OPTION_CONTACT_EMAIL) . '" value="' . esc_attr((string) get_option(OTONASELECT_OPTION_CONTACT_EMAIL, '')) . '" placeholder="notify@example.com" />';
			echo '<p class="description">未設定時は管理メール（現在の解決値: ' . esc_html($value) . '）。theme へハードコードしません。wp-config の OTONASELECT_CONTACT_NOTIFY_EMAIL も可。</p>';
		},
		'general'
	);
});

add_action('rest_api_init', static function (): void {
	register_rest_route('otonaselect/v1', '/contact-settings', [
		'methods' => 'POST',
		'permission_callback' => static function (): bool {
			return current_user_can('manage_options');
		},
		'callback' => static function (WP_REST_Request $req) {
			$email = sanitize_email((string) $req->get_param('email'));
			if (!is_email($email)) {
				return new WP_REST_Response(['ok' => false, 'error' => 'invalid_email'], 400);
			}
			update_option(OTONASELECT_OPTION_CONTACT_EMAIL, $email, false);
			return rest_ensure_response([
				'ok' => true,
				'email' => $email,
				'resolved' => otonaselect_contact_notify_email(),
			]);
		},
	]);
});
