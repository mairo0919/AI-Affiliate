<?php
/**
 * Taxonomy hub pages: performers / categories / series listings.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/**
 * @return list<WP_Term>
 */
function otonaselect_hub_terms(string $taxonomy, bool $hide_empty = true): array {
	$terms = get_terms([
		'taxonomy' => $taxonomy,
		'hide_empty' => $hide_empty,
		'number' => 0,
	]);
	if (!is_array($terms)) {
		return [];
	}
	$out = [];
	foreach ($terms as $term) {
		if (!$term instanceof WP_Term) {
			continue;
		}
		if ($taxonomy === OTONASELECT_TAX_SERIES && function_exists('otonaselect_is_system_series_name')) {
			if (otonaselect_is_system_series_name($term->name)) {
				continue;
			}
		}
		if ($taxonomy === 'category') {
			if ((int) $term->term_id === 1) {
				continue; // Uncategorized
			}
			if ($term->name === '作品紹介' || $term->slug === 'uncategorized') {
				continue;
			}
		}
		if ($hide_empty && (int) $term->count <= 0) {
			continue;
		}
		$out[] = $term;
	}
	return $out;
}

/**
 * Render gojuon-grouped taxonomy grid.
 *
 * @param list<WP_Term> $terms
 */
function otonaselect_render_gojuon_term_hub(array $terms, string $heading, string $css_class): string {
	if ($terms === []) {
		return '<section class="' . esc_attr($css_class) . '"><h1 class="otonaselect-hub-title">' . esc_html($heading) . '</h1>'
			. '<p class="has-muted-color">表示できる項目はまだありません。</p></section>';
	}

	$grouped = otonaselect_group_terms_by_gojuon($terms);
	$group_meta = otonaselect_gojuon_groups();
	ob_start();
	?>
	<section class="<?php echo esc_attr($css_class); ?>">
		<h1 class="otonaselect-hub-title"><?php echo esc_html($heading); ?></h1>
		<nav class="otonaselect-gojuon-nav" aria-label="五十音インデックス">
			<?php foreach ($group_meta as $g) :
				if ($g['key'] === 'other') {
					continue;
				}
				$count = count($grouped[$g['key']] ?? []);
				if ($count === 0) {
					continue;
				}
				?>
				<a href="#gojuon-<?php echo esc_attr($g['key']); ?>"><?php echo esc_html($g['label']); ?></a>
			<?php endforeach; ?>
		</nav>
		<?php foreach ($group_meta as $g) :
			$list = $grouped[$g['key']] ?? [];
			if ($list === []) {
				continue;
			}
			?>
			<section class="otonaselect-gojuon-group" id="gojuon-<?php echo esc_attr($g['key']); ?>">
				<h2 class="otonaselect-gojuon-heading"><?php echo esc_html($g['label']); ?>行</h2>
				<ul class="otonaselect-term-grid">
					<?php foreach ($list as $term) : ?>
						<li>
							<a href="<?php echo esc_url(get_term_link($term)); ?>">
								<?php echo esc_html($term->name); ?>
								<span class="otonaselect-term-count"><?php echo esc_html((string) (int) $term->count); ?></span>
							</a>
						</li>
					<?php endforeach; ?>
				</ul>
			</section>
		<?php endforeach; ?>
	</section>
	<?php
	return (string) ob_get_clean();
}

function otonaselect_render_performer_hub(): string {
	return otonaselect_render_gojuon_term_hub(
		otonaselect_hub_terms(OTONASELECT_TAX_PERFORMER, true),
		'出演者一覧',
		'otonaselect-taxonomy-hub otonaselect-performer-hub'
	);
}

function otonaselect_render_category_hub(): string {
	return otonaselect_render_gojuon_term_hub(
		otonaselect_hub_terms('category', true),
		'カテゴリ一覧',
		'otonaselect-taxonomy-hub otonaselect-category-hub'
	);
}

function otonaselect_render_series_hub(): string {
	$terms = otonaselect_hub_terms(OTONASELECT_TAX_SERIES, true);
	if ($terms === []) {
		return '<section class="otonaselect-taxonomy-hub otonaselect-series-hub"><h1 class="otonaselect-hub-title">シリーズ一覧</h1>'
			. '<p class="has-muted-color">表示できるシリーズはまだありません。</p></section>';
	}
	return otonaselect_render_gojuon_term_hub(
		$terms,
		'シリーズ一覧',
		'otonaselect-taxonomy-hub otonaselect-series-hub'
	);
}

/**
 * Compact performer cloud for TOP sidebar (auto from taxonomy).
 */
function otonaselect_render_home_performer_cloud(int $limit = 18): string {
	$terms = otonaselect_hub_terms(OTONASELECT_TAX_PERFORMER, true);
	if ($terms === []) {
		return '<p class="has-muted-color has-small-font-size">出演者は準備中です。</p>';
	}
	$grouped = otonaselect_group_terms_by_gojuon($terms);
	$flat = [];
	foreach (otonaselect_gojuon_groups() as $g) {
		foreach ($grouped[$g['key']] ?? [] as $term) {
			$flat[] = $term;
		}
	}
	$shown = array_slice($flat, 0, max(1, $limit));
	$hub = home_url('/performers/');
	ob_start();
	echo '<ul class="otonaselect-home-performer-list">';
	foreach ($shown as $term) {
		printf(
			'<li><a href="%s">%s</a></li>',
			esc_url(get_term_link($term)),
			esc_html($term->name)
		);
	}
	echo '</ul>';
	printf(
		'<p class="otonaselect-hub-more"><a href="%s">出演者をすべて見る</a></p>',
		esc_url($hub)
	);
	return (string) ob_get_clean();
}

add_filter('render_block', static function (string $block_content, array $block): string {
	$name = (string) ($block['blockName'] ?? '');
	if ($name !== 'core/html') {
		return $block_content;
	}
	if (str_contains($block_content, 'otonaselect-performer-hub-slot')) {
		return otonaselect_render_performer_hub();
	}
	if (str_contains($block_content, 'otonaselect-category-hub-slot')) {
		return otonaselect_render_category_hub();
	}
	if (str_contains($block_content, 'otonaselect-series-hub-slot')) {
		return otonaselect_render_series_hub();
	}
	if (str_contains($block_content, 'otonaselect-home-performers-slot')) {
		return otonaselect_render_home_performer_cloud(18);
	}
	return $block_content;
}, 9, 2);
