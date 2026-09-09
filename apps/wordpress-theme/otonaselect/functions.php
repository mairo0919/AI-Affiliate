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
require_once $otonaselect_inc . '/site-pages.php';

/**
 * Enqueue the theme stylesheet (block themes still benefit from style.css rules).
 */
add_action('wp_enqueue_scripts', static function (): void {
	wp_enqueue_style(
		'otonaselect-style',
		get_stylesheet_uri(),
		[],
		wp_get_theme()->get('Version')
	);
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
