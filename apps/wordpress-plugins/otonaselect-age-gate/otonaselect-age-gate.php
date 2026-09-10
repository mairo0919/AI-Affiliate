<?php
/**
 * Plugin Name: OtonaSelect Age Gate
 * Description: Site-wide 18+ age confirmation (SSOT). Self-contained — does not load theme age-gate.php.
 * Version: 1.0.2
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: Otona Select
 *
 * Important:
 * - Single-file plugin (no secondary require) to avoid "failed opening required" fatals.
 * - All symbols are function_exists / defined guarded for safe coexistence with theme fallback.
 * - Conditional tags are only used when WP_Query is available.
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Bootstrap after pluggable functions exist.
 */
add_action('init', 'otonaselect_age_gate_plugin_bootstrap', 0);

/**
 * @return void
 */
function otonaselect_age_gate_plugin_bootstrap() {
	if (defined('OTONASELECT_AGE_GATE_LOADED')) {
		return;
	}
	define('OTONASELECT_AGE_GATE_LOADED', true);

	if (!defined('OTONASELECT_AGE_COOKIE')) {
		define('OTONASELECT_AGE_COOKIE', 'otonaselect_age_ok');
	}
	if (!defined('OTONASELECT_AGE_COOKIE_OK')) {
		define('OTONASELECT_AGE_COOKIE_OK', '1');
	}
	if (!defined('OTONASELECT_AGE_COOKIE_DENY')) {
		define('OTONASELECT_AGE_COOKIE_DENY', '0');
	}

	if (!has_action('template_redirect', 'otonaselect_age_gate_on_template_redirect')) {
		add_action('template_redirect', 'otonaselect_age_gate_on_template_redirect', 0);
	}
}

/**
 * @return int
 */
function otonaselect_age_cookie_ttl_ok() {
	$day = defined('DAY_IN_SECONDS') ? (int) DAY_IN_SECONDS : 86400;
	return 30 * $day;
}

/**
 * @return int
 */
function otonaselect_age_cookie_ttl_deny() {
	return defined('DAY_IN_SECONDS') ? (int) DAY_IN_SECONDS : 86400;
}

/**
 * @return bool
 */
function otonaselect_age_gate_is_crawler() {
	$ua = isset($_SERVER['HTTP_USER_AGENT']) ? (string) $_SERVER['HTTP_USER_AGENT'] : '';
	if ($ua === '') {
		return false;
	}
	return (bool) preg_match(
		'/Googlebot|Google-InspectionTool|Storebot-Google|AdsBot-Google|bingbot|BingPreview|Slurp|DuckDuckBot|Baiduspider|YandexBot|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|TelegramBot|WhatsApp|Applebot|PetalBot|Bytespider/i',
		$ua
	);
}

/**
 * @return bool
 */
function otonaselect_age_gate_query_ready() {
	global $wp_query;
	return isset($wp_query) && class_exists('WP_Query') && $wp_query instanceof WP_Query;
}

/**
 * @return bool
 */
function otonaselect_age_gate_should_skip_request() {
	if (is_admin()) {
		return true;
	}
	if (function_exists('wp_doing_ajax') && wp_doing_ajax()) {
		return true;
	}
	if (function_exists('wp_doing_cron') && wp_doing_cron()) {
		return true;
	}
	if (defined('REST_REQUEST') && REST_REQUEST) {
		return true;
	}
	if (defined('XMLRPC_REQUEST') && XMLRPC_REQUEST) {
		return true;
	}
	if (defined('WP_CLI') && WP_CLI) {
		return true;
	}

	$request = isset($_SERVER['REQUEST_URI']) ? (string) (function_exists('wp_unslash') ? wp_unslash($_SERVER['REQUEST_URI']) : $_SERVER['REQUEST_URI']) : '';
	if ($request !== '' && preg_match('#/(wp-json|wp-admin|wp-login\.php|xmlrpc\.php|wp-cron\.php|wp-sitemap\.xsl)#i', $request)) {
		return true;
	}
	if ($request !== '' && preg_match('#/wp-sitemap([a-z0-9_-]*)\.xml#i', $request)) {
		return true;
	}

	// Never call conditional tags before WP_Query exists (avoids fatals on older WP).
	if (otonaselect_age_gate_query_ready()) {
		if (function_exists('is_feed') && is_feed()) {
			return true;
		}
		if (function_exists('is_robots') && is_robots()) {
			return true;
		}
		if (function_exists('is_favicon') && is_favicon()) {
			return true;
		}
	}

	if (function_exists('is_user_logged_in') && is_user_logged_in() && function_exists('current_user_can') && current_user_can('edit_posts')) {
		return true;
	}
	if (otonaselect_age_gate_is_crawler()) {
		return true;
	}
	return false;
}

/**
 * @return string|null
 */
function otonaselect_age_gate_cookie_value() {
	if (!isset($_COOKIE[OTONASELECT_AGE_COOKIE])) {
		return null;
	}
	$raw = (string) (function_exists('wp_unslash') ? wp_unslash($_COOKIE[OTONASELECT_AGE_COOKIE]) : $_COOKIE[OTONASELECT_AGE_COOKIE]);
	if ($raw === OTONASELECT_AGE_COOKIE_OK || $raw === OTONASELECT_AGE_COOKIE_DENY) {
		return $raw;
	}
	return null;
}

/**
 * @param string $value
 * @param int    $ttl
 * @return void
 */
function otonaselect_age_gate_set_cookie($value, $ttl) {
	$path = (defined('COOKIEPATH') && is_string(COOKIEPATH) && COOKIEPATH !== '') ? COOKIEPATH : '/';
	$domain = (defined('COOKIE_DOMAIN') && is_string(COOKIE_DOMAIN)) ? COOKIE_DOMAIN : '';
	$secure = function_exists('is_ssl') ? is_ssl() : (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
	$expires = time() + max(60, (int) $ttl);

	// PHP 7.3+ options array; keep HttpOnly (JS must not be required to read consent).
	if (PHP_VERSION_ID >= 70300) {
		setcookie(OTONASELECT_AGE_COOKIE, (string) $value, array(
			'expires' => $expires,
			'path' => $path,
			'domain' => $domain,
			'secure' => (bool) $secure,
			'httponly' => true,
			'samesite' => 'Lax',
		));
	} else {
		setcookie(OTONASELECT_AGE_COOKIE, (string) $value, $expires, $path, $domain, (bool) $secure, true);
	}
	$_COOKIE[OTONASELECT_AGE_COOKIE] = (string) $value;
}

/**
 * @return string
 */
function otonaselect_age_gate_request_path() {
	$uri = isset($_SERVER['REQUEST_URI']) ? (string) (function_exists('wp_unslash') ? wp_unslash($_SERVER['REQUEST_URI']) : $_SERVER['REQUEST_URI']) : '/';
	$path = function_exists('wp_parse_url') ? wp_parse_url($uri, PHP_URL_PATH) : parse_url($uri, PHP_URL_PATH);
	return (is_string($path) && $path !== '') ? $path : '/';
}

/**
 * @param string $type
 * @return void
 */
function otonaselect_age_gate_record($type) {
	$type = (string) $type;
	if (function_exists('otonaselect_analytics_record_event')) {
		$result = otonaselect_analytics_record_event(array(
			'type' => $type,
			'path' => otonaselect_age_gate_request_path(),
		));
		if (is_array($result) && !empty($result['ok'])) {
			return;
		}
	}

	$opt = 'otonaselect_age_gate_stats_v1';
	$store = function_exists('get_option') ? get_option($opt, null) : null;
	if (!is_array($store)) {
		$store = array('view' => 0, 'accepted' => 0, 'denied' => 0);
	}

	$key = null;
	if ($type === 'age_gate_view') {
		$key = 'view';
	} elseif ($type === 'age_gate_accepted') {
		$key = 'accepted';
	} elseif ($type === 'age_gate_denied') {
		$key = 'denied';
	}
	if ($key === null) {
		return;
	}
	$store[$key] = (int) (isset($store[$key]) ? $store[$key] : 0) + 1;
	if (function_exists('update_option')) {
		update_option($opt, $store, false);
	}
}

/**
 * @return string
 */
function otonaselect_age_gate_canonical_redirect_url() {
	if (function_exists('otonaselect_canonical_url')) {
		$url = otonaselect_canonical_url();
		if (is_string($url) && $url !== '') {
			return $url;
		}
	}
	$uri = isset($_SERVER['REQUEST_URI']) ? (string) (function_exists('wp_unslash') ? wp_unslash($_SERVER['REQUEST_URI']) : $_SERVER['REQUEST_URI']) : '/';
	$path = function_exists('wp_parse_url') ? wp_parse_url($uri, PHP_URL_PATH) : parse_url($uri, PHP_URL_PATH);
	$path = (is_string($path) && $path !== '') ? $path : '/';
	$query = function_exists('wp_parse_url') ? wp_parse_url($uri, PHP_URL_QUERY) : parse_url($uri, PHP_URL_QUERY);
	$origin = function_exists('otonaselect_public_origin')
		? otonaselect_public_origin()
		: (function_exists('home_url') ? home_url('/') : '/');
	$origin = function_exists('untrailingslashit') ? untrailingslashit($origin) : rtrim($origin, '/');
	return $origin . $path . (is_string($query) && $query !== '' ? '?' . $query : '');
}

/**
 * @return void
 */
function otonaselect_age_gate_handle_post() {
	if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') {
		return;
	}
	if (empty($_POST['otonaselect_age_nonce']) || empty($_POST['otonaselect_age'])) {
		return;
	}
	$nonce = function_exists('sanitize_text_field')
		? sanitize_text_field(wp_unslash((string) $_POST['otonaselect_age_nonce']))
		: (string) $_POST['otonaselect_age_nonce'];
	if (function_exists('wp_verify_nonce') && !wp_verify_nonce($nonce, 'otonaselect_age_gate')) {
		return;
	}
	$choice = function_exists('sanitize_key')
		? sanitize_key(wp_unslash((string) $_POST['otonaselect_age']))
		: (string) $_POST['otonaselect_age'];
	$redirect = otonaselect_age_gate_canonical_redirect_url();

	if ($choice === 'accept') {
		otonaselect_age_gate_set_cookie(OTONASELECT_AGE_COOKIE_OK, otonaselect_age_cookie_ttl_ok());
		otonaselect_age_gate_record('age_gate_accepted');
		if (function_exists('wp_safe_redirect')) {
			wp_safe_redirect($redirect, 303);
		} else {
			header('Location: ' . $redirect, true, 303);
		}
		exit;
	}

	if ($choice === 'deny') {
		otonaselect_age_gate_set_cookie(OTONASELECT_AGE_COOKIE_DENY, otonaselect_age_cookie_ttl_deny());
		otonaselect_age_gate_record('age_gate_denied');
		if (function_exists('wp_safe_redirect')) {
			wp_safe_redirect($redirect, 303);
		} else {
			header('Location: ' . $redirect, true, 303);
		}
		exit;
	}
}

/**
 * @return string
 */
function otonaselect_age_gate_inline_css() {
	return 'html,body{margin:0;padding:0;min-height:100%;}body.otonaselect-age-gate-body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Noto Sans JP","Helvetica Neue",Arial,sans-serif;background:linear-gradient(165deg,#f7f7f7 0%,#ffffff 45%,#f0f0f0 100%);color:#1a1a1a;min-height:100vh;display:flex;align-items:center;justify-content:center;}.otonaselect-age-gate{width:100%;padding:1.5rem;box-sizing:border-box;}.otonaselect-age-gate-panel{max-width:28rem;margin:0 auto;padding:2rem 1.5rem;background:#fff;border:1px solid #e6e6e6;border-radius:4px;text-align:center;}.otonaselect-age-gate-brand{margin:0 0 1.25rem;font-size:1.5rem;font-weight:700;letter-spacing:0.04em;line-height:1.3;}.otonaselect-age-gate-title{margin:0 0 0.75rem;font-size:1.05rem;font-weight:600;line-height:1.55;}.otonaselect-age-gate-text{margin:0 0 0.5rem;font-size:0.9375rem;line-height:1.7;color:#1a1a1a;}.otonaselect-age-gate-text.muted{color:#5c5c5c;font-size:0.875rem;}.otonaselect-age-gate-form{margin-top:1.5rem;}.otonaselect-age-gate-actions{display:flex;flex-direction:column;gap:0.75rem;margin-top:1.25rem;}.otonaselect-age-gate-btn{display:block;width:100%;box-sizing:border-box;min-height:3rem;padding:0.85rem 1rem;font-size:1rem;font-weight:600;line-height:1.3;border-radius:4px;border:1px solid #222;cursor:pointer;text-decoration:none;text-align:center;}.otonaselect-age-gate-btn.is-primary{background:#222;color:#fff;}.otonaselect-age-gate-btn.is-secondary{background:#fff;color:#222;}.otonaselect-age-gate-btn:focus-visible{outline:2px solid #222;outline-offset:2px;}@media (min-width:640px){.otonaselect-age-gate-actions{flex-direction:row;}.otonaselect-age-gate-btn{flex:1;}.otonaselect-age-gate-panel{padding:2.5rem 2rem;}}';
}

/**
 * @param string $mode gate|denied
 * @return void
 */
function otonaselect_age_gate_render_and_exit($mode) {
	if (function_exists('nocache_headers')) {
		nocache_headers();
	}
	header('Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0');
	header('Pragma: no-cache');
	if (function_exists('status_header')) {
		status_header(200);
	} else {
		header('HTTP/1.1 200 OK');
	}

	if ($mode === 'gate') {
		otonaselect_age_gate_record('age_gate_view');
	}

	$title = function_exists('wp_get_document_title') ? wp_get_document_title() : 'オトナセレクト';
	if (!is_string($title) || $title === '') {
		$title = 'オトナセレクト';
	}
	$canonical = function_exists('otonaselect_canonical_url')
		? otonaselect_canonical_url()
		: (function_exists('home_url') ? home_url('/') : '/');
	$origin = function_exists('otonaselect_public_origin')
		? otonaselect_public_origin()
		: (function_exists('home_url') ? home_url('/') : '/');

	$action = function_exists('esc_url') ? esc_url($canonical) : htmlspecialchars((string) $canonical, ENT_QUOTES, 'UTF-8');
	$nonce = function_exists('wp_create_nonce') ? wp_create_nonce('otonaselect_age_gate') : '';
	$is_denied = ($mode === 'denied');
	$page_heading = $is_denied ? 'ご利用いただけません' : 'オトナセレクト';
	$doc_title = $is_denied ? 'ご利用いただけません | オトナセレクト' : $title;
	$esc = function_exists('esc_html') ? 'esc_html' : function ($v) {
		return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
	};
	$esc_attr = function_exists('esc_attr') ? 'esc_attr' : function ($v) {
		return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
	};

	$charset = function_exists('get_bloginfo') ? get_bloginfo('charset') : 'UTF-8';
	if (!is_string($charset) || $charset === '') {
		$charset = 'UTF-8';
	}

	echo '<!DOCTYPE html><html lang="ja"><head>';
	echo '<meta charset="' . $esc_attr($charset) . '" />';
	echo '<meta name="viewport" content="width=device-width, initial-scale=1" />';
	echo '<title>' . $esc($doc_title) . '</title>';
	echo '<link rel="canonical" href="' . (function_exists('esc_url') ? esc_url($canonical) : $esc_attr($canonical)) . '" />';
	echo '<meta name="robots" content="noindex,nofollow" />';
	echo '<meta name="description" content="オトナセレクトは成人向けコンテンツを含むサイトです。18歳以上の方のみご利用いただけます。" />';
	echo '<style>' . otonaselect_age_gate_inline_css() . '</style>';
	echo '</head><body class="otonaselect-age-gate-body' . ($is_denied ? ' is-denied' : '') . '">';
	echo '<main class="otonaselect-age-gate" role="main"><div class="otonaselect-age-gate-panel">';
	echo '<p class="otonaselect-age-gate-brand">オトナセレクト</p>';
	if ($is_denied) {
		echo '<h1 class="otonaselect-age-gate-title">' . $esc($page_heading) . '</h1>';
		echo '<p class="otonaselect-age-gate-text">18歳未満の方はご利用いただけません。</p>';
		echo '<p class="otonaselect-age-gate-text muted">成人向けの記事・画像・一覧は表示しません。</p>';
		echo '<p class="otonaselect-age-gate-actions"><a class="otonaselect-age-gate-btn is-secondary" href="https://www.google.com/">サイトを離れる</a></p>';
	} else {
		echo '<h1 class="otonaselect-age-gate-title">このサイトは成人向けコンテンツを含みます。</h1>';
		echo '<p class="otonaselect-age-gate-text">18歳未満の方はご利用いただけません。</p>';
		echo '<form class="otonaselect-age-gate-form" method="post" action="' . $action . '">';
		echo '<input type="hidden" name="otonaselect_age_nonce" value="' . $esc_attr($nonce) . '" />';
		echo '<div class="otonaselect-age-gate-actions">';
		echo '<button type="submit" class="otonaselect-age-gate-btn is-primary" name="otonaselect_age" value="accept">18歳以上です</button>';
		echo '<button type="submit" class="otonaselect-age-gate-btn is-secondary" name="otonaselect_age" value="deny">18歳未満です</button>';
		echo '</div></form>';
	}
	echo '</div></main></body></html>';
	exit;
}

/**
 * @return void
 */
function otonaselect_age_gate_on_template_redirect() {
	try {
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
	} catch (Throwable $e) {
		// Never take down the whole site if Age Gate fails unexpectedly.
		return;
	}
}
