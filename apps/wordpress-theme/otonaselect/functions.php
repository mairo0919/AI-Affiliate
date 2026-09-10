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
require_once $otonaselect_inc . '/analytics.php';
// Age Gate SSOT = plugin `otonaselect-age-gate` when active.
// Theme fallback loads only if the plugin is not active (avoids double gates).
$otonaselect_age_plugin = 'otonaselect-age-gate/otonaselect-age-gate.php';
$otonaselect_age_plugins = (array) get_option('active_plugins', []);
if (!in_array($otonaselect_age_plugin, $otonaselect_age_plugins, true)) {
	require_once $otonaselect_inc . '/age-gate.php';
}
require_once $otonaselect_inc . '/contact.php';
require_once $otonaselect_inc . '/site-pages.php';

/**
 * Enqueue the theme stylesheet (block themes still benefit from style.css rules).
 */
add_action('wp_enqueue_scripts', static function (): void {
	$ver = wp_get_theme()->get('Version') ?: '1.6.2';
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
