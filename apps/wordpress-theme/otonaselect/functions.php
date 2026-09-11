<?php
/**
 * オトナセレクト — SEO / AEO / GEO foundation + presentation helpers.
 *
 * Factory-generated post HTML is not rewritten here.
 * No Jetpack / paid SEO plugins.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

$otonaselect_inc = get_template_directory() . '/inc';
require_once $otonaselect_inc . '/constants.php';
require_once $otonaselect_inc . '/taxonomies.php';
require_once $otonaselect_inc . '/seo-head.php';
require_once $otonaselect_inc . '/json-ld.php';
require_once $otonaselect_inc . '/breadcrumbs.php';
require_once $otonaselect_inc . '/related.php';
require_once $otonaselect_inc . '/presentation.php';
require_once $otonaselect_inc . '/reading.php';
require_once $otonaselect_inc . '/taxonomy-hubs.php';
require_once $otonaselect_inc . '/home-query.php';
require_once $otonaselect_inc . '/analytics.php';
// Age Gate SSOT = plugin. The plugin defines OTONASELECT_AGE_GATE_PLUGIN_ACTIVE
// at include-time (before the theme loads). Avoid admin-only plugin APIs here.
if (
	!defined('OTONASELECT_AGE_GATE_PLUGIN_ACTIVE')
	&& !defined('OTONASELECT_AGE_GATE_LOADED')
	&& !function_exists('otonaselect_age_gate_on_template_redirect')
) {
	require_once $otonaselect_inc . '/age-gate.php';
}
require_once $otonaselect_inc . '/contact.php';
require_once $otonaselect_inc . '/site-pages.php';

/**
 * Enqueue the theme stylesheet (block themes still benefit from style.css rules).
 */
add_action('wp_enqueue_scripts', static function (): void {
	$ver = wp_get_theme()->get('Version') ?: '1.6.7';
	wp_enqueue_style(
		'otonaselect-style',
		get_stylesheet_uri(),
		[],
		$ver
	);
	wp_enqueue_script(
		'otonaselect-front-enhance',
		get_template_directory_uri() . '/assets/front-enhance.js',
		[],
		$ver,
		true
	);
});

/**
 * Register post meta used by Factory SEO attach / card images.
 */
add_action('init', static function (): void {
	$meta_keys = [
		OTONASELECT_META_SEO_TITLE,
		OTONASELECT_META_SEO_DESCRIPTION,
		OTONASELECT_META_PRODUCT_CID,
		OTONASELECT_META_SAFE_OG_IMAGE,
		OTONASELECT_META_CARD_IMAGE,
		OTONASELECT_META_SERIES_NAME,
	];
	foreach ($meta_keys as $key) {
		register_post_meta('post', $key, [
			'type' => 'string',
			'single' => true,
			'show_in_rest' => true,
			'auth_callback' => static function (): bool {
				return current_user_can('edit_posts');
			},
		]);
	}
});

/**
 * Register pattern category used by optional theme patterns.
 */
add_action('init', static function (): void {
	register_block_pattern_category(
		'otonaselect',
		[
			'label' => 'オトナセレクト',
		]
	);
});
