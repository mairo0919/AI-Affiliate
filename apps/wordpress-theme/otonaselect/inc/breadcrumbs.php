<?php
/**
 * Visible breadcrumbs (matches BreadcrumbList JSON-LD).
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

function otonaselect_render_breadcrumbs(): void {
	$items = otonaselect_breadcrumb_items();
	if (count($items) < 2) {
		return;
	}
	echo '<nav class="otonaselect-breadcrumbs" aria-label="パンくずリスト">';
	echo '<ol class="otonaselect-breadcrumbs-list">';
	$last = count($items) - 1;
	foreach ($items as $i => $item) {
		$name = esc_html($item['name']);
		$url = esc_url($item['url']);
		echo '<li class="otonaselect-breadcrumbs-item">';
		if ($i < $last) {
			echo '<a href="' . $url . '">' . $name . '</a>';
			echo '<span class="otonaselect-breadcrumbs-sep" aria-hidden="true">›</span>';
		} else {
			echo '<span aria-current="page">' . $name . '</span>';
		}
		echo '</li>';
	}
	echo '</ol></nav>';
}

/**
 * Shortcode / block-friendly render for FSE templates via HTML block pattern.
 */
add_shortcode('otonaselect_breadcrumbs', static function (): string {
	ob_start();
	otonaselect_render_breadcrumbs();
	return (string) ob_get_clean();
});

add_filter('render_block', static function (string $block_content, array $block): string {
	if (($block['blockName'] ?? '') === 'core/html' && str_contains($block_content, 'otonaselect-breadcrumbs-slot')) {
		ob_start();
		otonaselect_render_breadcrumbs();
		$crumbs = (string) ob_get_clean();
		return $crumbs !== '' ? $crumbs : $block_content;
	}
	return $block_content;
}, 10, 2);
