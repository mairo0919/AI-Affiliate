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

/**
 * Render taxonomy chips with internal links (performer / series / category / tags).
 */
function otonaselect_render_entity_links(int $post_id): void {
	$sections = [];

	$performers = get_the_terms($post_id, OTONASELECT_TAX_PERFORMER);
	if (is_array($performers) && $performers !== []) {
		$links = [];
		foreach ($performers as $term) {
			if (!$term instanceof WP_Term) {
				continue;
			}
			$link = get_term_link($term);
			if (is_wp_error($link)) {
				continue;
			}
			$links[] = '<a href="' . esc_url(otonaselect_replace_legacy_host($link)) . '">' . esc_html($term->name) . '</a>';
		}
		if ($links !== []) {
			$sections[] = '<div class="otonaselect-entity-row"><span class="otonaselect-entity-label">出演者</span> ' . implode(' · ', $links) . '</div>';
		}
	}

	$series = get_the_terms($post_id, OTONASELECT_TAX_SERIES);
	if (is_array($series) && $series !== []) {
		$links = [];
		foreach ($series as $term) {
			if (!$term instanceof WP_Term) {
				continue;
			}
			$link = get_term_link($term);
			if (is_wp_error($link)) {
				continue;
			}
			$links[] = '<a href="' . esc_url(otonaselect_replace_legacy_host($link)) . '">' . esc_html($term->name) . '</a>';
		}
		if ($links !== []) {
			$sections[] = '<div class="otonaselect-entity-row"><span class="otonaselect-entity-label">シリーズ</span> ' . implode(' · ', $links) . '</div>';
		}
	}

	$cats = get_the_category($post_id);
	if (is_array($cats) && $cats !== []) {
		$links = [];
		foreach ($cats as $cat) {
			$link = get_category_link($cat->term_id);
			if (!is_string($link)) {
				continue;
			}
			$links[] = '<a href="' . esc_url(otonaselect_replace_legacy_host($link)) . '">' . esc_html($cat->name) . '</a>';
		}
		if ($links !== []) {
			$sections[] = '<div class="otonaselect-entity-row"><span class="otonaselect-entity-label">カテゴリ</span> ' . implode(' · ', $links) . '</div>';
		}
	}

	if ($sections === []) {
		return;
	}
	echo '<aside class="otonaselect-entity-links" aria-label="関連エンティティ">' . implode('', $sections) . '</aside>';
}

add_filter('render_block', static function (string $block_content, array $block): string {
	if (($block['blockName'] ?? '') === 'core/html' && str_contains($block_content, 'otonaselect-entity-links-slot')) {
		if (!is_singular('post')) {
			return '';
		}
		ob_start();
		otonaselect_render_entity_links((int) get_queried_object_id());
		return (string) ob_get_clean();
	}
	return $block_content;
}, 10, 2);
