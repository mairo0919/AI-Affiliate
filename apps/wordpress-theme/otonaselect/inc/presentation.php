<?php
/**
 * Front presentation helpers: taxonomy summary, card images, home sections.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/** Semantic / system series groups — kept in taxonomy, hidden from article header. */
const OTONASELECT_SYSTEM_SERIES_NAMES = [
	'ベスト・総集編',
	'ベスト',
	'総集編',
	'デビュー作',
	'完全版',
	'周年記念',
	'VR',
	'単体作品',
	'企画',
	'作品紹介',
];

/**
 * @return list<string>
 */
function otonaselect_system_series_keys(): array {
	$keys = [];
	foreach (OTONASELECT_SYSTEM_SERIES_NAMES as $name) {
		$keys[] = otonaselect_normalize_label_key($name);
	}
	return $keys;
}

function otonaselect_normalize_label_key(string $name): string {
	return strtolower(preg_replace('/\s+/u', '', trim($name)) ?? '');
}

function otonaselect_is_system_series_name(string $name): bool {
	$key = otonaselect_normalize_label_key($name);
	if ($key === '') {
		return false;
	}
	foreach (otonaselect_system_series_keys() as $sys) {
		if ($key === $sys) {
			return true;
		}
	}
	// Synonym collapse for BEST / ベスト盤 etc.
	if (preg_match('/^(best|ベスト盤|ベスト総集編)$/u', $key)) {
		return true;
	}
	return false;
}

/**
 * Official work series only (exclude semantic system groups).
 *
 * @return list<WP_Term>
 */
function otonaselect_displayable_series_terms(int $post_id): array {
	$terms = get_the_terms($post_id, OTONASELECT_TAX_SERIES);
	if (!is_array($terms)) {
		return [];
	}
	$out = [];
	foreach ($terms as $term) {
		if (!$term instanceof WP_Term) {
			continue;
		}
		if (otonaselect_is_system_series_name($term->name)) {
			continue;
		}
		$out[] = $term;
	}
	return $out;
}

/**
 * Tag synonyms collapsed for front-only dedupe (does not mutate WP terms).
 *
 * @return array<string, string> aliasKey => canonicalKey
 */
function otonaselect_tag_synonym_map(): array {
	$map = [
		'best' => 'ベスト',
		'ベスト盤' => 'ベスト',
		'総集編' => 'ベスト',
		'ベスト総集編' => 'ベスト',
		'ベスト・総集編' => 'ベスト',
		'人妻主婦' => '人妻・主婦',
		'主婦' => '人妻・主婦',
		'マッサージリフレ' => 'マッサージ・リフレ',
		'リフレ' => 'マッサージ・リフレ',
		'メンズエステ' => 'メンエス',
	];
	$out = [];
	foreach ($map as $alias => $canonical) {
		$out[otonaselect_normalize_label_key((string) $alias)] = otonaselect_normalize_label_key($canonical);
	}
	return $out;
}

/**
 * @param list<string> $blocked_keys
 * @return list<WP_Term>
 */
function otonaselect_dedupe_display_tags(int $post_id, array $blocked_keys = []): array {
	$tags = get_the_tags($post_id);
	if (!is_array($tags) || $tags === []) {
		return [];
	}

	$blocked = [];
	foreach ($blocked_keys as $k) {
		if ($k !== '') {
			$blocked[$k] = true;
		}
	}

	$synonyms = otonaselect_tag_synonym_map();
	$seen = [];
	$out = [];
	foreach ($tags as $tag) {
		if (!$tag instanceof WP_Term) {
			continue;
		}
		$key = otonaselect_normalize_label_key($tag->name);
		if ($key === '') {
			continue;
		}
		$canonical = $synonyms[$key] ?? $key;
		if (isset($blocked[$key]) || isset($blocked[$canonical])) {
			continue;
		}
		if (isset($seen[$canonical])) {
			continue;
		}
		$seen[$canonical] = true;
		$out[] = $tag;
	}
	return $out;
}

/**
 * @return list<string>
 */
function otonaselect_term_name_keys(array $terms): array {
	$keys = [];
	foreach ($terms as $term) {
		if ($term instanceof WP_Term) {
			$keys[] = otonaselect_normalize_label_key($term->name);
		} elseif (is_string($term)) {
			$keys[] = otonaselect_normalize_label_key($term);
		}
	}
	return array_values(array_filter($keys));
}

/**
 * @param list<WP_Term> $terms
 */
function otonaselect_render_term_links(array $terms, string $separator = ' / '): string {
	$links = [];
	foreach ($terms as $term) {
		if (!$term instanceof WP_Term) {
			continue;
		}
		$link = get_term_link($term);
		if (is_wp_error($link)) {
			continue;
		}
		$links[] = '<a href="' . esc_url(otonaselect_replace_legacy_host($link)) . '">' . esc_html($term->name) . '</a>';
	}
	return implode($separator, $links);
}

/**
 * Article header taxonomy block (date is rendered separately in template).
 */
function otonaselect_render_article_taxonomy_summary(int $post_id): void {
	$performers = get_the_terms($post_id, OTONASELECT_TAX_PERFORMER);
	$performers = is_array($performers) ? array_values(array_filter($performers, static fn ($t) => $t instanceof WP_Term)) : [];

	$series = otonaselect_displayable_series_terms($post_id);

	$cats = get_the_category($post_id);
	$cats = is_array($cats) ? array_values(array_filter($cats, static fn ($t) => $t instanceof WP_Term)) : [];

	$blocked = array_merge(
		otonaselect_term_name_keys($performers),
		otonaselect_term_name_keys($series),
		otonaselect_term_name_keys($cats),
		otonaselect_system_series_keys()
	);
	$tags = otonaselect_dedupe_display_tags($post_id, $blocked);

	$rows = [];
	if ($performers !== []) {
		$rows[] = '<div class="otonaselect-entity-row"><span class="otonaselect-entity-label">出演者</span> ' . otonaselect_render_term_links($performers, ' · ') . '</div>';
	}
	if ($cats !== []) {
		$rows[] = '<div class="otonaselect-entity-row"><span class="otonaselect-entity-label">カテゴリ</span> ' . otonaselect_render_term_links($cats, ' · ') . '</div>';
	}
	if ($series !== []) {
		$rows[] = '<div class="otonaselect-entity-row"><span class="otonaselect-entity-label">シリーズ</span> ' . otonaselect_render_term_links($series, ' · ') . '</div>';
	}
	if ($tags !== []) {
		$rows[] = '<div class="otonaselect-entity-row"><span class="otonaselect-entity-label">タグ</span> ' . otonaselect_render_term_links($tags, ' / ') . '</div>';
	}

	if ($rows === []) {
		return;
	}
	echo '<aside class="otonaselect-entity-links otonaselect-article-taxonomy" aria-label="記事の分類">' . implode('', $rows) . '</aside>';
}

/**
 * Trusted DMM/FANZA CDN hosts for PUBLIC URL-reference images.
 */
function otonaselect_is_trusted_product_image_url(string $url): bool {
	$parts = wp_parse_url($url);
	if (!is_array($parts) || empty($parts['host']) || empty($parts['scheme'])) {
		return false;
	}
	if (!in_array(strtolower((string) $parts['scheme']), ['https', 'http'], true)) {
		return false;
	}
	$host = strtolower((string) $parts['host']);
	$trusted = [
		'pics.dmm.co.jp',
		'pics.dmm.com',
		'awsimgsrc.dmm.co.jp',
		'awsimgsrc.dmm.com',
		'ebook-assets.dmm.co.jp',
	];
	foreach ($trusted as $allow) {
		if ($host === $allow || str_ends_with($host, '.' . $allow)) {
			return true;
		}
	}
	return false;
}

/**
 * Prefer max official FANZA size variant (no network). Same rules as Factory resolver.
 */
function otonaselect_prefer_max_official_variant(string $url): string {
	if (!otonaselect_is_trusted_product_image_url($url)) {
		return $url;
	}
	$parts = wp_parse_url($url);
	if (!is_array($parts) || empty($parts['path'])) {
		return $url;
	}
	$file = basename((string) $parts['path']);
	$next = $file;
	if (preg_match('/^([a-z0-9_]+)(ps|pt)\.(jpe?g|webp|png)$/i', $file)) {
		$next = preg_replace('/(ps|pt)\./i', 'pl.', $file, 1) ?? $file;
	} elseif (preg_match('/^([a-z0-9_]+)js-(\d+)\.(jpe?g|webp|png)$/i', $file)) {
		$next = preg_replace('/js-/i', 'jp-', $file, 1) ?? $file;
	} elseif (preg_match('/^([a-z0-9_]+)-(\d+)\.(jpe?g|webp|png)$/i', $file) && !preg_match('/j[ps]-\d+\./i', $file)) {
		$next = preg_replace('/^([a-z0-9_]+)-(\d+)\./i', '$1jp-$2.', $file, 1) ?? $file;
	}
	if ($next === $file) {
		return $url;
	}
	$path = (string) $parts['path'];
	$new_path = preg_replace('/' . preg_quote($file, '/') . '$/', $next, $path) ?? $path;
	$scheme = $parts['scheme'] ?? 'https';
	$host = $parts['host'] ?? '';
	$query = isset($parts['query']) ? '?' . $parts['query'] : '';
	return $scheme . '://' . $host . $new_path . $query;
}

/**
 * Score a trusted product image URL for card selection.
 */
function otonaselect_card_image_score(string $url): int {
	$file = strtolower(basename((string) (wp_parse_url($url, PHP_URL_PATH) ?? '')));
	if (str_contains($file, 'pl.')) {
		return 100;
	}
	if (preg_match('/jp-\d+\./', $file)) {
		return 80;
	}
	if (preg_match('/ps\.|pt\./', $file)) {
		return 50;
	}
	if (preg_match('/js-\d+\./', $file)) {
		return 40;
	}
	if (preg_match('/-\d+\./', $file)) {
		return 30;
	}
	return 10;
}

/**
 * Resolve TOP/list card image URL.
 * Priority: featured attachment URL (trusted) → card meta → body PUBLIC images → null.
 */
function otonaselect_card_image_url(int $post_id): ?string {
	if ($post_id <= 0) {
		return null;
	}

	if (has_post_thumbnail($post_id)) {
		$thumb = wp_get_attachment_image_url((int) get_post_thumbnail_id($post_id), 'full');
		if (is_string($thumb) && $thumb !== '' && otonaselect_is_trusted_product_image_url($thumb)) {
			return otonaselect_prefer_max_official_variant($thumb);
		}
	}

	$meta = get_post_meta($post_id, OTONASELECT_META_CARD_IMAGE, true);
	if (is_string($meta) && $meta !== '' && otonaselect_is_trusted_product_image_url($meta)) {
		return otonaselect_prefer_max_official_variant($meta);
	}

	$safe_og = get_post_meta($post_id, OTONASELECT_META_SAFE_OG_IMAGE, true);
	if (is_string($safe_og) && $safe_og !== '' && otonaselect_is_trusted_product_image_url($safe_og)) {
		return otonaselect_prefer_max_official_variant($safe_og);
	}

	$post = get_post($post_id);
	if (!$post instanceof WP_Post) {
		return null;
	}
	$content = (string) $post->post_content;
	$candidates = [];

	if (preg_match_all('/<img[^>]+src=["\']([^"\']+)["\']/i', $content, $m)) {
		foreach ($m[1] as $src) {
			$src = html_entity_decode($src, ENT_QUOTES | ENT_HTML5, 'UTF-8');
			if (!otonaselect_is_trusted_product_image_url($src)) {
				continue;
			}
			$src = otonaselect_prefer_max_official_variant($src);
			$candidates[] = ['url' => $src, 'score' => otonaselect_card_image_score($src)];
		}
	}

	if ($candidates === []) {
		return null;
	}
	usort($candidates, static fn ($a, $b) => $b['score'] <=> $a['score']);
	$best = $candidates[0]['url'];

	// Persist for stable SSR without re-parsing body every time.
	if (!is_string($meta) || $meta === '') {
		update_post_meta($post_id, OTONASELECT_META_CARD_IMAGE, $best);
	}

	return $best;
}

/**
 * Resolve post id for featured-image block inside Query Loop.
 *
 * @param array<string, mixed> $parsed_block
 */
function otonaselect_block_post_id(array $parsed_block, $block = null): int {
	if ($block instanceof WP_Block && isset($block->context['postId'])) {
		return (int) $block->context['postId'];
	}
	if (isset($parsed_block['attrs']['postId'])) {
		return (int) $parsed_block['attrs']['postId'];
	}
	$id = (int) get_the_ID();
	if ($id > 0) {
		return $id;
	}
	return (int) get_queried_object_id();
}

/**
 * Server-side card image for post-featured-image blocks.
 * Does not rely on front-enhance.js / REST.
 *
 * @param array<string, mixed> $parsed_block
 */
add_filter('render_block_core/post-featured-image', static function (string $content, array $parsed_block, $block = null): string {
	$post_id = otonaselect_block_post_id($parsed_block, $block);
	$resolved = otonaselect_card_image_url($post_id);

	// Keep native featured media only when we have no PUBLIC product image.
	if ($resolved === null && str_contains($content, '<img') && has_post_thumbnail($post_id)) {
		return $content;
	}

	if ($resolved === null) {
		// Last-resort safe default (cream SVG). Avoid when a body image exists but failed trust checks.
		$default = get_template_directory_uri() . '/assets/og-default.svg';
		$url = $default;
		$is_default = true;
	} else {
		$url = $resolved;
		$is_default = false;
	}

	$permalink = get_permalink($post_id);
	$alt = get_the_title($post_id);
	$class = 'wp-block-post-featured-image otonaselect-card-image' . ($is_default ? ' is-default' : '');
	$img = '<img src="' . esc_url($url) . '" alt="' . esc_attr(is_string($alt) ? $alt : '') . '" width="640" height="360" loading="lazy" decoding="async" />';
	if (is_string($permalink) && $permalink !== '') {
		$img = '<a href="' . esc_url(otonaselect_replace_legacy_host($permalink)) . '">' . $img . '</a>';
	}
	return '<figure class="' . esc_attr($class) . '" style="aspect-ratio:16/9">' . $img . '</figure>';
}, 10, 3);

/**
 * Never show "no posts" empty state on front when published posts exist.
 *
 * @param array<string, mixed> $parsed_block
 */
add_filter('render_block_core/query-no-results', static function (string $content, array $parsed_block, $block = null): string {
	if (!(is_front_page() || is_home())) {
		return $content;
	}
	$has_publish = (int) wp_count_posts('post')->publish;
	if ($has_publish > 0) {
		return '';
	}
	return $content;
}, 10, 3);

/**
 * Compact card taxonomy under title (performer / category / few tags).
 */
function otonaselect_render_card_taxonomy(int $post_id, int $max_tags = 3): string {
	$parts = [];
	$performers = get_the_terms($post_id, OTONASELECT_TAX_PERFORMER);
	if (is_array($performers) && $performers !== []) {
		$names = [];
		foreach (array_slice($performers, 0, 2) as $term) {
			if ($term instanceof WP_Term) {
				$names[] = esc_html($term->name);
			}
		}
		if ($names !== []) {
			$parts[] = '<span class="otonaselect-card-tax-item"><span class="otonaselect-card-tax-label">出演者</span> ' . implode(' · ', $names) . '</span>';
		}
	}

	$cats = get_the_category($post_id);
	if (is_array($cats) && $cats !== []) {
		$primary = $cats[0];
		if ($primary instanceof WP_Term) {
			$parts[] = '<span class="otonaselect-card-tax-item"><span class="otonaselect-card-tax-label">カテゴリ</span> ' . esc_html($primary->name) . '</span>';
		}
	}

	$blocked = array_merge(
		otonaselect_term_name_keys(is_array($performers) ? $performers : []),
		otonaselect_term_name_keys(is_array($cats) ? $cats : []),
		otonaselect_system_series_keys()
	);
	$tags = otonaselect_dedupe_display_tags($post_id, $blocked);
	if ($tags !== []) {
		$tag_names = [];
		foreach (array_slice($tags, 0, max(0, $max_tags)) as $tag) {
			$tag_names[] = esc_html($tag->name);
		}
		if ($tag_names !== []) {
			$parts[] = '<span class="otonaselect-card-tax-item"><span class="otonaselect-card-tax-label">タグ</span> ' . implode(' / ', $tag_names) . '</span>';
		}
	}

	if ($parts === []) {
		return '';
	}
	return '<div class="otonaselect-card-taxonomy">' . implode('', $parts) . '</div>';
}

add_filter('render_block', static function (string $block_content, array $block): string {
	$name = $block['blockName'] ?? '';
	if ($name === 'core/html' && str_contains($block_content, 'otonaselect-entity-links-slot')) {
		if (!is_singular('post')) {
			return '';
		}
		ob_start();
		otonaselect_render_article_taxonomy_summary((int) get_queried_object_id());
		return (string) ob_get_clean();
	}

	if ($name === 'core/html' && str_contains($block_content, 'otonaselect-card-taxonomy-slot')) {
		$post_id = (int) get_the_ID();
		if ($post_id <= 0) {
			return '';
		}
		return otonaselect_render_card_taxonomy($post_id, 3);
	}

	if ($name === 'core/html' && str_contains($block_content, 'otonaselect-popular-posts-slot')) {
		return otonaselect_render_popular_posts_section(6);
	}

	return $block_content;
}, 10, 2);
