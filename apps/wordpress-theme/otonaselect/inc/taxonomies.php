<?php
/**
 * Custom taxonomies: performer + series (stable hash slugs).
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Stable slug independent of Japanese characters alone.
 * Optional ASCII hint (romanization) may be passed as $preferred_ascii.
 */
function otonaselect_stable_term_slug(string $display_name, string $prefix = 'p', ?string $preferred_ascii = null): string {
	$ascii = is_string($preferred_ascii) ? strtolower(trim($preferred_ascii)) : '';
	$ascii = preg_replace('/[^a-z0-9]+/', '-', $ascii ?? '') ?? '';
	$ascii = trim($ascii, '-');
	if ($ascii !== '' && strlen($ascii) >= 2 && strlen($ascii) <= 48) {
		return $prefix . '-' . $ascii;
	}
	$normalized = mb_strtolower(preg_replace('/\s+/u', '', trim($display_name)) ?? '', 'UTF-8');
	$hash = substr(hash('sha256', $normalized), 0, 12);
	return $prefix . '-' . $hash;
}

add_action('init', static function (): void {
	register_taxonomy(
		OTONASELECT_TAX_PERFORMER,
		['post'],
		[
			'labels' => [
				'name' => '出演者',
				'singular_name' => '出演者',
				'search_items' => '出演者を検索',
				'all_items' => '出演者一覧',
				'edit_item' => '出演者を編集',
				'update_item' => '出演者を更新',
				'add_new_item' => '出演者を追加',
				'new_item_name' => '新しい出演者',
				'menu_name' => '出演者',
			],
			'public' => true,
			'hierarchical' => false,
			'show_ui' => true,
			'show_admin_column' => true,
			'show_in_rest' => true,
			'rest_base' => 'performer',
			'rewrite' => [
				'slug' => 'performer',
				'with_front' => false,
			],
			'query_var' => true,
		]
	);

	register_taxonomy(
		OTONASELECT_TAX_SERIES,
		['post'],
		[
			'labels' => [
				'name' => 'シリーズ',
				'singular_name' => 'シリーズ',
				'search_items' => 'シリーズを検索',
				'all_items' => 'シリーズ一覧',
				'edit_item' => 'シリーズを編集',
				'update_item' => 'シリーズを更新',
				'add_new_item' => 'シリーズを追加',
				'new_item_name' => '新しいシリーズ',
				'menu_name' => 'シリーズ',
			],
			'public' => true,
			'hierarchical' => false,
			'show_ui' => true,
			'show_admin_column' => true,
			'show_in_rest' => true,
			'rest_base' => 'series',
			'rewrite' => [
				'slug' => 'series',
				'with_front' => false,
			],
			'query_var' => true,
		]
	);

	// Pretty permalinks for custom taxonomies require a rewrite flush after
	// registration (or slug changes). Version-gate so production heals on load.
	$rewrite_ver = 'otonaselect-tax-rewrite-1.6.7';
	if (get_option('otonaselect_tax_rewrite_version') !== $rewrite_ver) {
		flush_rewrite_rules(false);
		update_option('otonaselect_tax_rewrite_version', $rewrite_ver, true);
	}
}, 5);

/**
 * Register reading term meta (SSOT for gojuon sort). Never AI-invented.
 */
add_action('init', static function (): void {
	$taxonomies = [OTONASELECT_TAX_PERFORMER, OTONASELECT_TAX_SERIES, 'category'];
	foreach ($taxonomies as $taxonomy) {
		register_term_meta($taxonomy, 'otonaselect_reading_kana', [
			'type' => 'string',
			'description' => 'Kana reading for gojuon sort (official evidence only)',
			'single' => true,
			'show_in_rest' => true,
			'auth_callback' => static function (): bool {
				return current_user_can('edit_posts');
			},
		]);
	}
}, 6);

/**
 * Hide legacy catch-all category from public term lists.
 */
add_filter('get_terms', static function ($terms, $taxonomies = []) {
	if (is_admin() || !is_array($terms) || is_wp_error($terms)) {
		return $terms;
	}
	$out = [];
	foreach ($terms as $term) {
		if (
			$term instanceof WP_Term
			&& $term->taxonomy === 'category'
			&& ($term->name === '作品紹介' || $term->slug === 'sakuhin-shoukai')
		) {
			continue;
		}
		$out[] = $term;
	}
	return $out;
}, 10, 2);

/**
 * Ensure a performer term exists; returns term_id or 0.
 *
 * @param array{name:string,slug?:string|null,ascii?:string|null,reading?:string|null} $performer
 */
function otonaselect_ensure_performer_term(array $performer): int {
	$name = isset($performer['name']) ? trim((string) $performer['name']) : '';
	if ($name === '') {
		return 0;
	}
	$preferred = isset($performer['slug']) ? (string) $performer['slug'] : null;
	if ($preferred === null || $preferred === '') {
		$preferred = isset($performer['ascii']) ? (string) $performer['ascii'] : null;
	}
	$slug = otonaselect_stable_term_slug($name, 'p', $preferred);
	$existing = get_term_by('slug', $slug, OTONASELECT_TAX_PERFORMER);
	if ($existing instanceof WP_Term) {
		$term_id = (int) $existing->term_id;
		if (isset($performer['reading']) && is_string($performer['reading']) && trim($performer['reading']) !== '') {
			if (function_exists('otonaselect_set_term_reading')) {
				otonaselect_set_term_reading($term_id, $performer['reading']);
			}
		}
		return $term_id;
	}
	$by_name = get_term_by('name', $name, OTONASELECT_TAX_PERFORMER);
	if ($by_name instanceof WP_Term) {
		$term_id = (int) $by_name->term_id;
		if (isset($performer['reading']) && is_string($performer['reading']) && trim($performer['reading']) !== '') {
			if (function_exists('otonaselect_set_term_reading')) {
				otonaselect_set_term_reading($term_id, $performer['reading']);
			}
		}
		return $term_id;
	}
	$result = wp_insert_term($name, OTONASELECT_TAX_PERFORMER, ['slug' => $slug]);
	if (is_wp_error($result)) {
		return 0;
	}
	$term_id = (int) ($result['term_id'] ?? 0);
	if ($term_id > 0) {
		update_term_meta($term_id, 'otonaselect_display_name', $name);
		update_term_meta($term_id, 'otonaselect_entity_key', mb_strtolower(preg_replace('/\s+/u', '', $name) ?? '', 'UTF-8'));
		if (isset($performer['reading']) && is_string($performer['reading']) && trim($performer['reading']) !== '') {
			if (function_exists('otonaselect_set_term_reading')) {
				otonaselect_set_term_reading($term_id, $performer['reading']);
			} else {
				update_term_meta($term_id, 'otonaselect_reading_kana', trim($performer['reading']));
			}
		}
	}
	return $term_id;
}

/**
 * Ensure a series term exists; returns term_id or 0.
 */
function otonaselect_ensure_series_term(string $name, ?string $ascii = null): int {
	$name = trim($name);
	if ($name === '') {
		return 0;
	}
	$slug = otonaselect_stable_term_slug($name, 's', $ascii);
	$existing = get_term_by('slug', $slug, OTONASELECT_TAX_SERIES);
	if ($existing instanceof WP_Term) {
		return (int) $existing->term_id;
	}
	$by_name = get_term_by('name', $name, OTONASELECT_TAX_SERIES);
	if ($by_name instanceof WP_Term) {
		return (int) $by_name->term_id;
	}
	$result = wp_insert_term($name, OTONASELECT_TAX_SERIES, ['slug' => $slug]);
	if (is_wp_error($result)) {
		return 0;
	}
	return (int) ($result['term_id'] ?? 0);
}
