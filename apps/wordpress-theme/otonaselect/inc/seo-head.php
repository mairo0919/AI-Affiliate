<?php
/**
 * Canonical, robots, title/description, Open Graph / Twitter cards.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Force production public URLs for front-end SEO surfaces.
 */
function otonaselect_public_origin(): string {
	$home = home_url('/');
	$host = wp_parse_url($home, PHP_URL_HOST);
	if (is_string($host) && in_array(strtolower($host), OTONASELECT_LEGACY_HOSTS, true)) {
		return OTONASELECT_PRODUCTION_ORIGIN;
	}
	$configured = wp_parse_url(OTONASELECT_PRODUCTION_ORIGIN, PHP_URL_HOST);
	if (is_string($host) && is_string($configured) && strtolower($host) === strtolower($configured)) {
		return OTONASELECT_PRODUCTION_ORIGIN;
	}
	// Prefer production origin for SEO even if WP is temporarily on another host.
	if (!is_admin()) {
		return OTONASELECT_PRODUCTION_ORIGIN;
	}
	return untrailingslashit($home) ?: OTONASELECT_PRODUCTION_ORIGIN;
}

function otonaselect_replace_legacy_host(string $url): string {
	$parsed = wp_parse_url($url);
	if (!is_array($parsed) || empty($parsed['host'])) {
		return $url;
	}
	$host = strtolower((string) $parsed['host']);
	if (!in_array($host, OTONASELECT_LEGACY_HOSTS, true)) {
		return $url;
	}
	$path = $parsed['path'] ?? '/';
	$query = isset($parsed['query']) ? '?' . $parsed['query'] : '';
	$fragment = isset($parsed['fragment']) ? '#' . $parsed['fragment'] : '';
	return OTONASELECT_PRODUCTION_ORIGIN . $path . $query . $fragment;
}

function otonaselect_canonical_url(): string {
	if (is_singular()) {
		$url = get_permalink();
		return is_string($url) ? otonaselect_replace_legacy_host($url) : otonaselect_public_origin() . '/';
	}
	if (is_home() || is_front_page()) {
		return otonaselect_public_origin() . '/';
	}
	if (is_category() || is_tag() || is_tax()) {
		$link = get_term_link(get_queried_object());
		return !is_wp_error($link) ? otonaselect_replace_legacy_host($link) : otonaselect_public_origin() . '/';
	}
	if (is_search()) {
		return otonaselect_replace_legacy_host(get_search_link());
	}
	$request = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '/';
	$path = wp_parse_url($request, PHP_URL_PATH);
	$path = is_string($path) && $path !== '' ? $path : '/';
	return otonaselect_public_origin() . $path;
}

add_action('after_setup_theme', static function (): void {
	add_theme_support('title-tag');
});

/**
 * Register post meta used by Factory / theme SEO (REST-visible).
 */
add_action('init', static function (): void {
	$meta_keys = [
		OTONASELECT_META_SEO_TITLE => [
			'type' => 'string',
			'description' => 'SEO title override',
		],
		OTONASELECT_META_SEO_DESCRIPTION => [
			'type' => 'string',
			'description' => 'SEO meta description',
		],
		OTONASELECT_META_PRODUCT_CID => [
			'type' => 'string',
			'description' => 'FANZA product canonical id',
		],
		OTONASELECT_META_SAFE_OG_IMAGE => [
			'type' => 'string',
			'description' => 'Optional safe OG image URL (never auto adult sample)',
		],
		OTONASELECT_META_SERIES_NAME => [
			'type' => 'string',
			'description' => 'Series display name snapshot',
		],
	];
	foreach ($meta_keys as $key => $args) {
		register_post_meta('post', $key, [
			'type' => $args['type'],
			'description' => $args['description'],
			'single' => true,
			'show_in_rest' => true,
			'auth_callback' => static function (): bool {
				return current_user_can('edit_posts');
			},
		]);
	}
});

function otonaselect_seo_title_for_post(int $post_id): string {
	$custom = get_post_meta($post_id, OTONASELECT_META_SEO_TITLE, true);
	if (is_string($custom) && trim($custom) !== '') {
		return trim($custom);
	}
	$title = get_the_title($post_id);
	return is_string($title) ? trim(wp_strip_all_tags($title)) : '';
}

function otonaselect_seo_description_for_post(int $post_id): string {
	$custom = get_post_meta($post_id, OTONASELECT_META_SEO_DESCRIPTION, true);
	if (is_string($custom) && trim($custom) !== '') {
		return trim(wp_strip_all_tags($custom));
	}
	$excerpt = get_the_excerpt($post_id);
	if (is_string($excerpt) && trim($excerpt) !== '') {
		return otonaselect_truncate_meta(trim(wp_strip_all_tags($excerpt)), 120);
	}
	// Last resort: first paragraph — not a raw mechanical dump of the whole body.
	$content = get_post_field('post_content', $post_id);
	if (!is_string($content) || $content === '') {
		return '';
	}
	$text = trim(wp_strip_all_tags(preg_replace('/\s+/u', ' ', $content) ?? ''));
	return otonaselect_truncate_meta($text, 120);
}

function otonaselect_truncate_meta(string $text, int $max = 120): string {
	$text = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
	if (mb_strlen($text, 'UTF-8') <= $max) {
		return $text;
	}
	$cut = mb_substr($text, 0, $max - 1, 'UTF-8');
	$sp = mb_strrpos($cut, ' ', 0, 'UTF-8');
	if (is_int($sp) && $sp > 40) {
		$cut = mb_substr($cut, 0, $sp, 'UTF-8');
	}
	return rtrim($cut) . '…';
}

add_filter('document_title_parts', static function (array $parts): array {
	if (is_singular('post')) {
		$post_id = (int) get_queried_object_id();
		$title = otonaselect_seo_title_for_post($post_id);
		if ($title !== '') {
			$parts['title'] = $title;
		}
	}
	$parts['site'] = get_bloginfo('name') ?: 'オトナセレクト';
	return $parts;
});

/**
 * Single rel=canonical — remove duplicates from core / other plugins when possible.
 */
remove_action('wp_head', 'rel_canonical');
add_action('wp_head', static function (): void {
	if (is_admin()) {
		return;
	}
	$url = esc_url(otonaselect_canonical_url());
	echo '<link rel="canonical" href="' . $url . '" />' . "\n";
}, 1);

/**
 * Robots: public content indexable; keep admin/search/private controlled.
 */
add_filter('wp_robots', static function (array $robots): array {
	if (is_search() || is_404()) {
		$robots['noindex'] = true;
		$robots['follow'] = true;
		unset($robots['index']);
		return $robots;
	}
	if (is_singular()) {
		$post = get_post();
		if ($post instanceof WP_Post && $post->post_status !== 'publish') {
			$robots['noindex'] = true;
			$robots['nofollow'] = true;
			unset($robots['index'], $robots['follow']);
			return $robots;
		}
	}
	// Published posts / archives / home: index,follow
	$robots['index'] = true;
	$robots['follow'] = true;
	unset($robots['noindex'], $robots['nofollow']);
	return $robots;
});

/**
 * Safe OG image only — never auto-pick adult FANZA samples from content.
 */
function otonaselect_safe_og_image_url(): ?string {
	if (is_singular('post')) {
		$post_id = (int) get_queried_object_id();
		$custom = get_post_meta($post_id, OTONASELECT_META_SAFE_OG_IMAGE, true);
		if (is_string($custom) && $custom !== '' && otonaselect_is_safe_og_url($custom)) {
			return otonaselect_replace_legacy_host($custom);
		}
	}
	$default = get_theme_file_uri('assets/og-default.svg');
	return is_string($default) && $default !== '' ? otonaselect_replace_legacy_host($default) : null;
}

function otonaselect_is_safe_og_url(string $url): bool {
	$host = wp_parse_url($url, PHP_URL_HOST);
	if (!is_string($host) || $host === '') {
		return false;
	}
	$host = strtolower($host);
	// Block known adult CDN hosts for automatic social cards.
	$blocked = [
		'pics.dmm.co.jp',
		'awsimgsrc.dmm.co.jp',
		'pics.dmm.com',
	];
	foreach ($blocked as $b) {
		if ($host === $b || str_ends_with($host, '.' . $b)) {
			return false;
		}
	}
	return true;
}

add_action('wp_head', static function (): void {
	if (is_admin()) {
		return;
	}

	$canonical = esc_url(otonaselect_canonical_url());
	$site_name = esc_attr(get_bloginfo('name') ?: 'オトナセレクト');
	$og_type = is_singular('post') ? 'article' : 'website';

	if (is_singular('post')) {
		$post_id = (int) get_queried_object_id();
		$title = esc_attr(otonaselect_seo_title_for_post($post_id));
		$desc = esc_attr(otonaselect_seo_description_for_post($post_id));
	} else {
		$title = esc_attr(wp_get_document_title());
		$desc = esc_attr(get_bloginfo('description') ?: '作品や出演者の情報を読みやすい記事としてまとめるメディアです。');
	}

	$og_image = otonaselect_safe_og_image_url();

	echo '<meta name="description" content="' . $desc . '" />' . "\n";
	echo '<meta property="og:locale" content="ja_JP" />' . "\n";
	echo '<meta property="og:type" content="' . esc_attr($og_type) . '" />' . "\n";
	echo '<meta property="og:site_name" content="' . $site_name . '" />' . "\n";
	echo '<meta property="og:title" content="' . $title . '" />' . "\n";
	echo '<meta property="og:description" content="' . $desc . '" />' . "\n";
	echo '<meta property="og:url" content="' . $canonical . '" />' . "\n";
	if ($og_image) {
		echo '<meta property="og:image" content="' . esc_url($og_image) . '" />' . "\n";
	}

	echo '<meta name="twitter:card" content="' . ($og_image ? 'summary_large_image' : 'summary') . '" />' . "\n";
	echo '<meta name="twitter:title" content="' . $title . '" />' . "\n";
	echo '<meta name="twitter:description" content="' . $desc . '" />' . "\n";
	if ($og_image) {
		echo '<meta name="twitter:image" content="' . esc_url($og_image) . '" />' . "\n";
	}

	if (is_singular('post')) {
		$post = get_post();
		if ($post instanceof WP_Post) {
			$published = get_the_date('c', $post);
			$modified = get_the_modified_date('c', $post);
			if (is_string($published) && $published !== '') {
				echo '<meta property="article:published_time" content="' . esc_attr($published) . '" />' . "\n";
			}
			if (is_string($modified) && $modified !== '') {
				echo '<meta property="article:modified_time" content="' . esc_attr($modified) . '" />' . "\n";
			}
		}
	}
}, 2);

/**
 * Sitemap: force production host; exclude legacy hosts.
 */
add_filter('wp_sitemaps_enabled', '__return_true');
add_filter('wp_sitemaps_posts_entry', static function (array $entry): array {
	if (isset($entry['loc']) && is_string($entry['loc'])) {
		$entry['loc'] = otonaselect_replace_legacy_host($entry['loc']);
	}
	return $entry;
});
add_filter('wp_sitemaps_taxonomies_entry', static function (array $entry): array {
	if (isset($entry['loc']) && is_string($entry['loc'])) {
		$entry['loc'] = otonaselect_replace_legacy_host($entry['loc']);
	}
	return $entry;
});
add_filter('home_url', static function ($url, $path = '', $scheme = null) {
	if (is_admin() || wp_doing_cron()) {
		return $url;
	}
	// Only rewrite known legacy hosts — do not invent alternate domains for unrelated hosts.
	return otonaselect_replace_legacy_host((string) $url);
}, 20, 3);
