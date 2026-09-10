<?php
/**
 * Site-wide Age Gate (18+).
 *
 * Server-side first render for unverified humans so adult images/titles
 * never flash before confirmation. Known crawlers skip the gate for SEO.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

if (defined('OTONASELECT_AGE_GATE_LOADED')) {
	return;
}
define('OTONASELECT_AGE_GATE_LOADED', true);

/** Cookie: accepted adult confirmation. */
const OTONASELECT_AGE_COOKIE = 'otonaselect_age_ok';

/** Cookie value when accepted. */
const OTONASELECT_AGE_COOKIE_OK = '1';

/** Cookie value when under-18 (blocks site content). */
const OTONASELECT_AGE_COOKIE_DENY = '0';

/** Retention for accept cookie (seconds). Not permanent. */
function otonaselect_age_cookie_ttl_ok(): int {
	return 30 * DAY_IN_SECONDS;
}

/** Retention for deny cookie (seconds). */
function otonaselect_age_cookie_ttl_deny(): int {
	return DAY_IN_SECONDS;
}

/**
 * Whether the current request is a known search/social crawler.
 * Crawlers receive full HTML (canonical / OG / JSON-LD unchanged).
 */
function otonaselect_age_gate_is_crawler(): bool {
	$ua = isset($_SERVER['HTTP_USER_AGENT']) ? (string) $_SERVER['HTTP_USER_AGENT'] : '';
	if ($ua === '') {
		return false;
	}
	return (bool) preg_match(
		'/'
		. 'Googlebot|Google-InspectionTool|Storebot-Google|AdsBot-Google|'
		. 'bingbot|BingPreview|Slurp|DuckDuckBot|Baiduspider|YandexBot|'
		. 'facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|'
		. 'Discordbot|TelegramBot|WhatsApp|Applebot|PetalBot|Bytespider'
		. '/i',
		$ua
	);
}

function otonaselect_age_gate_should_skip_request(): bool {
	if (is_admin() || wp_doing_ajax() || wp_doing_cron()) {
		return true;
	}
	if (defined('REST_REQUEST') && REST_REQUEST) {
		return true;
	}
	if (defined('XMLRPC_REQUEST') && XMLRPC_REQUEST) {
		return true;
	}
	// Feeds / sitemaps must stay crawlable without a gate body.
	if (is_feed()) {
		return true;
	}
	$request = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '';
	if ($request !== '' && preg_match('#/(wp-json|wp-admin|wp-login\.php|xmlrpc\.php)#i', $request)) {
		return true;
	}
	if (is_user_logged_in() && current_user_can('edit_posts')) {
		return true;
	}
	if (otonaselect_age_gate_is_crawler()) {
		return true;
	}
	return false;
}

function otonaselect_age_gate_cookie_value(): ?string {
	if (!isset($_COOKIE[OTONASELECT_AGE_COOKIE])) {
		return null;
	}
	$raw = (string) wp_unslash($_COOKIE[OTONASELECT_AGE_COOKIE]);
	if ($raw === OTONASELECT_AGE_COOKIE_OK || $raw === OTONASELECT_AGE_COOKIE_DENY) {
		return $raw;
	}
	return null;
}

function otonaselect_age_gate_set_cookie(string $value, int $ttl): void {
	$path = defined('COOKIEPATH') && is_string(COOKIEPATH) && COOKIEPATH !== '' ? COOKIEPATH : '/';
	$domain = defined('COOKIE_DOMAIN') && is_string(COOKIE_DOMAIN) ? COOKIE_DOMAIN : '';
	$secure = is_ssl();
	$expires = time() + max(60, $ttl);

	// Prefer PHP 7.3+ options array.
	setcookie(OTONASELECT_AGE_COOKIE, $value, [
		'expires' => $expires,
		'path' => $path,
		'domain' => $domain,
		'secure' => $secure,
		'httponly' => true,
		'samesite' => 'Lax',
	]);
	$_COOKIE[OTONASELECT_AGE_COOKIE] = $value;
}

function otonaselect_age_gate_request_path(): string {
	$uri = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '/';
	$path = wp_parse_url($uri, PHP_URL_PATH);
	return is_string($path) && $path !== '' ? $path : '/';
}

/**
 * Record age-gate analytics without PII (aggregated counters only).
 */
function otonaselect_age_gate_record(string $type): void {
	if (function_exists('otonaselect_analytics_record_event')) {
		$result = otonaselect_analytics_record_event([
			'type' => $type,
			'path' => otonaselect_age_gate_request_path(),
		]);
		if (is_array($result) && !empty($result['ok'])) {
			return;
		}
	}
	$opt = 'otonaselect_age_gate_stats_v1';
	$store = get_option($opt, null);
	if (!is_array($store)) {
		$store = ['view' => 0, 'accepted' => 0, 'denied' => 0];
	}
	$key = match ($type) {
		'age_gate_view' => 'view',
		'age_gate_accepted' => 'accepted',
		'age_gate_denied' => 'denied',
		default => null,
	};
	if ($key === null) {
		return;
	}
	$store[$key] = (int) ($store[$key] ?? 0) + 1;
	update_option($opt, $store, false);
}

/**
 * Handle accept / deny POST before any adult markup is emitted.
 */
function otonaselect_age_gate_handle_post(): void {
	if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
		return;
	}
	if (empty($_POST['otonaselect_age_nonce']) || empty($_POST['otonaselect_age'])) {
		return;
	}
	$nonce = sanitize_text_field(wp_unslash((string) $_POST['otonaselect_age_nonce']));
	if (!wp_verify_nonce($nonce, 'otonaselect_age_gate')) {
		return;
	}
	$choice = sanitize_key(wp_unslash((string) $_POST['otonaselect_age']));
	$redirect = otonaselect_age_gate_canonical_redirect_url();

	if ($choice === 'accept') {
		otonaselect_age_gate_set_cookie(OTONASELECT_AGE_COOKIE_OK, otonaselect_age_cookie_ttl_ok());
		otonaselect_age_gate_record('age_gate_accepted');
		wp_safe_redirect($redirect, 303);
		exit;
	}

	if ($choice === 'deny') {
		otonaselect_age_gate_set_cookie(OTONASELECT_AGE_COOKIE_DENY, otonaselect_age_cookie_ttl_deny());
		// Aggregate only — no post titles / adult metadata.
		otonaselect_age_gate_record('age_gate_denied');
		wp_safe_redirect($redirect, 303);
		exit;
	}
}

function otonaselect_age_gate_canonical_redirect_url(): string {
	if (function_exists('otonaselect_canonical_url')) {
		$url = otonaselect_canonical_url();
		if (is_string($url) && $url !== '') {
			return $url;
		}
	}
	$uri = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '/';
	$path = wp_parse_url($uri, PHP_URL_PATH);
	$path = is_string($path) && $path !== '' ? $path : '/';
	$query = wp_parse_url($uri, PHP_URL_QUERY);
	$origin = function_exists('otonaselect_public_origin')
		? otonaselect_public_origin()
		: home_url('/');
	$origin = untrailingslashit($origin);
	return $origin . $path . (is_string($query) && $query !== '' ? '?' . $query : '');
}

/**
 * Render age gate or under-18 exit screen and stop the normal template.
 *
 * @param 'gate'|'denied' $mode
 */
function otonaselect_age_gate_render_and_exit(string $mode): void {
	nocache_headers();
	header('Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0');
	header('Pragma: no-cache');
	status_header(200);

	if ($mode === 'gate') {
		otonaselect_age_gate_record('age_gate_view');
	}

	$title = wp_get_document_title();
	if (!is_string($title) || $title === '') {
		$title = 'オトナセレクト';
	}
	$canonical = function_exists('otonaselect_canonical_url')
		? otonaselect_canonical_url()
		: home_url('/');
	$origin = function_exists('otonaselect_public_origin')
		? otonaselect_public_origin()
		: home_url('/');

	$action = esc_url($canonical);
	$nonce = wp_create_nonce('otonaselect_age_gate');

	$is_denied = $mode === 'denied';
	$page_heading = $is_denied ? 'ご利用いただけません' : 'オトナセレクト';
	$doc_title = $is_denied ? 'ご利用いただけません | オトナセレクト' : $title;

	// Keep URL identity for SEO surfaces in <head>; body has zero adult media.
	echo '<!DOCTYPE html><html lang="ja"><head>';
	echo '<meta charset="' . esc_attr(get_bloginfo('charset') ?: 'UTF-8') . '" />';
	echo '<meta name="viewport" content="width=device-width, initial-scale=1" />';
	echo '<title>' . esc_html($doc_title) . '</title>';
	echo '<link rel="canonical" href="' . esc_url($canonical) . '" />';
	// Humans on the gate should not be indexed as the gate itself; crawlers skip this template.
	echo '<meta name="robots" content="noindex,nofollow" />';
	echo '<meta name="description" content="オトナセレクトは成人向けコンテンツを含むサイトです。18歳以上の方のみご利用いただけます。" />';
	echo '<meta property="og:site_name" content="オトナセレクト" />';
	echo '<meta property="og:title" content="' . esc_attr('オトナセレクト') . '" />';
	echo '<meta property="og:url" content="' . esc_url($canonical) . '" />';
	echo '<meta property="og:type" content="website" />';
	echo '<meta property="og:description" content="成人向けコンテンツを含むサイトです。18歳以上の方のみご利用いただけます。" />';
	echo '<link rel="icon" href="' . esc_url(trailingslashit($origin) . 'favicon.ico') . '" />';
	echo '<style>';
	echo otonaselect_age_gate_inline_css();
	echo '</style>';
	echo '</head><body class="otonaselect-age-gate-body' . ($is_denied ? ' is-denied' : '') . '">';
	echo '<main class="otonaselect-age-gate" role="main">';
	echo '<div class="otonaselect-age-gate-panel">';
	echo '<p class="otonaselect-age-gate-brand">オトナセレクト</p>';
	if ($is_denied) {
		echo '<h1 class="otonaselect-age-gate-title">' . esc_html($page_heading) . '</h1>';
		echo '<p class="otonaselect-age-gate-text">18歳未満の方はご利用いただけません。</p>';
		echo '<p class="otonaselect-age-gate-text muted">成人向けの記事・画像・一覧は表示しません。</p>';
		echo '<p class="otonaselect-age-gate-actions"><a class="otonaselect-age-gate-btn is-secondary" href="https://www.google.com/">サイトを離れる</a></p>';
	} else {
		echo '<h1 class="otonaselect-age-gate-title">このサイトは成人向けコンテンツを含みます。</h1>';
		echo '<p class="otonaselect-age-gate-text">18歳未満の方はご利用いただけません。</p>';
		echo '<form class="otonaselect-age-gate-form" method="post" action="' . $action . '">';
		echo '<input type="hidden" name="otonaselect_age_nonce" value="' . esc_attr($nonce) . '" />';
		echo '<div class="otonaselect-age-gate-actions">';
		echo '<button type="submit" class="otonaselect-age-gate-btn is-primary" name="otonaselect_age" value="accept">18歳以上です</button>';
		echo '<button type="submit" class="otonaselect-age-gate-btn is-secondary" name="otonaselect_age" value="deny">18歳未満です</button>';
		echo '</div></form>';
	}
	echo '</div></main></body></html>';
	exit;
}

function otonaselect_age_gate_inline_css(): string {
	return <<<'CSS'
html,body{margin:0;padding:0;min-height:100%;}
body.otonaselect-age-gate-body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Noto Sans JP","Helvetica Neue",Arial,sans-serif;
  background:linear-gradient(165deg,#f7f7f7 0%,#ffffff 45%,#f0f0f0 100%);
  color:#1a1a1a;
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
}
.otonaselect-age-gate{width:100%;padding:1.5rem;box-sizing:border-box;}
.otonaselect-age-gate-panel{
  max-width:28rem;margin:0 auto;padding:2rem 1.5rem;
  background:#fff;border:1px solid #e6e6e6;border-radius:4px;
  text-align:center;
}
.otonaselect-age-gate-brand{
  margin:0 0 1.25rem;font-size:1.5rem;font-weight:700;letter-spacing:0.04em;line-height:1.3;
}
.otonaselect-age-gate-title{
  margin:0 0 0.75rem;font-size:1.05rem;font-weight:600;line-height:1.55;
}
.otonaselect-age-gate-text{margin:0 0 0.5rem;font-size:0.9375rem;line-height:1.7;color:#1a1a1a;}
.otonaselect-age-gate-text.muted{color:#5c5c5c;font-size:0.875rem;}
.otonaselect-age-gate-form{margin-top:1.5rem;}
.otonaselect-age-gate-actions{
  display:flex;flex-direction:column;gap:0.75rem;margin-top:1.25rem;
}
.otonaselect-age-gate-btn{
  display:block;width:100%;box-sizing:border-box;
  min-height:3rem;padding:0.85rem 1rem;
  font-size:1rem;font-weight:600;line-height:1.3;
  border-radius:4px;border:1px solid #222;cursor:pointer;
  text-decoration:none;text-align:center;
}
.otonaselect-age-gate-btn.is-primary{background:#222;color:#fff;}
.otonaselect-age-gate-btn.is-secondary{background:#fff;color:#222;}
.otonaselect-age-gate-btn:focus-visible{outline:2px solid #222;outline-offset:2px;}
@media (min-width:640px){
  .otonaselect-age-gate-actions{flex-direction:row;}
  .otonaselect-age-gate-btn{flex:1;}
  .otonaselect-age-gate-panel{padding:2.5rem 2rem;}
}
CSS;
}

add_action('template_redirect', static function (): void {
	otonaselect_age_gate_handle_post();

	if (otonaselect_age_gate_should_skip_request()) {
		return;
	}

	$cookie = otonaselect_age_gate_cookie_value();
	if ($cookie === OTONASELECT_AGE_COOKIE_OK) {
		return;
	}
	if ($cookie === OTONASELECT_AGE_COOKIE_DENY) {
		otonaselect_age_gate_render_and_exit('denied');
	}
	otonaselect_age_gate_render_and_exit('gate');
}, 0);

/**
 * Do not enqueue front analytics / enhance scripts on gated responses
 * (those templates exit before wp_enqueue runs for the main page — kept for safety).
 */
add_action('wp_enqueue_scripts', static function (): void {
	if (otonaselect_age_gate_should_skip_request()) {
		return;
	}
	$cookie = otonaselect_age_gate_cookie_value();
	if ($cookie === OTONASELECT_AGE_COOKIE_OK) {
		return;
	}
	wp_dequeue_script('otonaselect-analytics');
	wp_dequeue_script('otonaselect-front-enhance');
}, 100);
