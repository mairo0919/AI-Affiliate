<?php
/**
 * オトナセレクト — lightweight block theme helpers.
 *
 * Keeps Factory-generated post HTML untouched. No Jetpack / paid deps.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

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

/**
 * Related / "more posts" Query Loop helper.
 *
 * Template queries with class `otonaselect-related`:
 * - exclude current post on singular
 * - prefer shared tags, else shared categories
 * - if neither exists, remain a normal recent-posts query (still excludes current)
 */
add_filter(
	'query_loop_block_query_vars',
	static function (array $query, $block): array {
		$class_name = '';
		if (is_object($block) && isset($block->attributes['className']) && is_string($block->attributes['className'])) {
			$class_name = $block->attributes['className'];
		}
		if (!str_contains($class_name, 'otonaselect-related')) {
			return $query;
		}

		if (is_singular('post')) {
			$post_id = (int) get_queried_object_id();
			if ($post_id > 0) {
				$exclude = isset($query['post__not_in']) && is_array($query['post__not_in'])
					? $query['post__not_in']
					: [];
				$exclude[] = $post_id;
				$query['post__not_in'] = array_values(array_unique(array_map('intval', $exclude)));

				$tag_ids = wp_get_post_tags($post_id, ['fields' => 'ids']);
				if (is_array($tag_ids) && $tag_ids !== []) {
					$query['tag__in'] = array_map('intval', $tag_ids);
				} else {
					$cat_ids = wp_get_post_categories($post_id);
					if (is_array($cat_ids) && $cat_ids !== []) {
						$query['category__in'] = array_map('intval', $cat_ids);
					}
				}
			}
		}

		return $query;
	},
	10,
	2
);
