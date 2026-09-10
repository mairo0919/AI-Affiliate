<?php
/**
 * Related posts: performer → series → category → tag (adult attribute tags included).
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/**
 * @return list<int>
 */
function otonaselect_related_post_ids(int $post_id, int $limit = 3): array {
	$limit = max(0, min(6, $limit));
	if ($limit === 0 || $post_id <= 0) {
		return [];
	}
	$found = [];

	$collect = static function (array $args) use (&$found, $post_id, $limit): void {
		if (count($found) >= $limit) {
			return;
		}
		$args = array_merge(
			[
				'post_type' => 'post',
				'post_status' => 'publish',
				'fields' => 'ids',
				'ignore_sticky_posts' => true,
				'no_found_rows' => true,
			],
			$args
		);
		$args['post__not_in'] = array_values(array_unique(array_merge(
			isset($args['post__not_in']) && is_array($args['post__not_in']) ? $args['post__not_in'] : [],
			[$post_id],
			$found
		)));
		$args['posts_per_page'] = $limit - count($found);
		$ids = get_posts($args);
		if (is_array($ids)) {
			foreach ($ids as $id) {
				$found[] = (int) $id;
			}
		}
	};

	$performer_ids = wp_get_post_terms($post_id, OTONASELECT_TAX_PERFORMER, ['fields' => 'ids']);
	if (is_array($performer_ids) && $performer_ids !== []) {
		$collect([
			'tax_query' => [[
				'taxonomy' => OTONASELECT_TAX_PERFORMER,
				'field' => 'term_id',
				'terms' => array_map('intval', $performer_ids),
			]],
		]);
	}

	$series_ids = wp_get_post_terms($post_id, OTONASELECT_TAX_SERIES, ['fields' => 'ids']);
	if (is_array($series_ids) && $series_ids !== []) {
		$collect([
			'tax_query' => [[
				'taxonomy' => OTONASELECT_TAX_SERIES,
				'field' => 'term_id',
				'terms' => array_map('intval', $series_ids),
			]],
		]);
	}

	$cat_ids = wp_get_post_categories($post_id);
	if (is_array($cat_ids) && $cat_ids !== []) {
		$collect(['category__in' => array_map('intval', $cat_ids)]);
	}

	$tag_ids = wp_get_post_tags($post_id, ['fields' => 'ids']);
	if (is_array($tag_ids) && $tag_ids !== []) {
		$collect(['tag__in' => array_map('intval', $tag_ids)]);
	}

	return array_values(array_unique(array_map('intval', $found)));
}

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

		if (!is_singular('post')) {
			return $query;
		}

		$post_id = (int) get_queried_object_id();
		$limit = isset($query['posts_per_page']) ? (int) $query['posts_per_page'] : 3;
		$related = otonaselect_related_post_ids($post_id, $limit);
		if ($related === []) {
			// No related matches — force empty result (do not pad with random posts).
			$query['post__in'] = [0];
			$query['post__not_in'] = [$post_id];
			return $query;
		}

		$query['post__in'] = $related;
		$query['orderby'] = 'post__in';
		$query['post__not_in'] = [$post_id];
		unset($query['tag__in'], $query['category__in']);
		return $query;
	},
	10,
	2
);

// Article header taxonomy rendering lives in presentation.php (deduped display).
