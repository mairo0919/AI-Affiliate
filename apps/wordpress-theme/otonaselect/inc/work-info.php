<?php
/**
 * Product code and current sale under the work title on a single post.
 *
 * Search Console (2026-11-27): 10 of 13 clicks came from people searching the product code
 * (h_1711docm00001), which the page only carried inside image URLs. The sale line comes from
 * the DMM API campaign field, refreshed daily by the Factory into OTONASELECT_META_CAMPAIGN.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/** FANZA content id from post meta, else from the work-title link (older posts have no meta). */
function otonaselect_post_cid(int $post_id): string {
	$cid = trim((string) get_post_meta($post_id, OTONASELECT_META_PRODUCT_CID, true));
	if ($cid === '') {
		$content = (string) get_post_field('post_content', $post_id);
		if (preg_match('/(?:%3Fid%3D|[?&]id=|cid=)([a-z0-9_]+)/i', $content, $m)) {
			$cid = $m[1];
		}
	}
	$cid = strtolower(preg_replace('/^[a-z]+:/i', '', $cid) ?? '');
	return preg_match('/^[a-z0-9_]{4,40}$/', $cid) ? $cid : '';
}

/** The code as it is printed on the package: h_1711docm00001 → DOCM-001, kavr00522 → KAVR-522. */
function otonaselect_package_code(string $cid): string {
	if (!preg_match('/([a-z]+)0*(\d{3,})$/', $cid, $m)) {
		return '';
	}
	return strtoupper($m[1]) . '-' . $m[2];
}

/**
 * Sales running now, from the stored DMM campaign list.
 *
 * @return list<array{title:string,end:string}>
 */
function otonaselect_active_campaigns(int $post_id): array {
	$raw = (string) get_post_meta($post_id, OTONASELECT_META_CAMPAIGN, true);
	$list = $raw !== '' ? json_decode($raw, true) : null;
	if (!is_array($list)) {
		return [];
	}
	$now = time();
	$out = [];
	foreach ($list as $c) {
		if (!is_array($c) || !is_string($c['title'] ?? null) || !is_string($c['end'] ?? null)) {
			continue;
		}
		$end = strtotime($c['end']);
		$begin = is_string($c['begin'] ?? null) ? strtotime($c['begin']) : false;
		if ($end === false || $end <= $now || ($begin !== false && $begin > $now)) {
			continue;
		}
		$out[] = ['title' => trim($c['title']), 'end' => $c['end']];
	}
	return $out;
}

function otonaselect_render_work_info(int $post_id, string $work_href): string {
	$html = '';
	$cid = otonaselect_post_cid($post_id);
	if ($cid !== '') {
		$code = otonaselect_package_code($cid);
		$label = $code !== '' && strtolower(str_replace('-', '', $code)) !== $cid ? $cid . '（' . $code . '）' : $cid;
		$html .= '<p class="otonaselect-work-code">品番：' . esc_html($label) . '</p>';
	}
	foreach (otonaselect_active_campaigns($post_id) as $c) {
		$end = strtotime($c['end']);
		// DMM sales end at 09:59:59 JST; say so rather than imply the whole day.
		$until = wp_date('H:i', $end) === '23:59' ? wp_date('n/j', $end) . ' まで' : wp_date('n/j G:i', $end) . ' まで';
		$text = esc_html($c['title']) . '（' . esc_html($until) . '）';
		$inner = $work_href !== ''
			? '<a href="' . esc_url($work_href) . '" data-otonaselect-cta="1" data-cta="campaign" data-provider="fanza" rel="noopener noreferrer">' . $text . '</a>'
			: $text;
		$html .= '<p class="otonaselect-campaign" data-end="' . esc_attr(gmdate('c', $end)) . '">セール中：' . $inner . '</p>';
	}
	if (str_contains($html, 'otonaselect-campaign')) {
		// Pages are cached; hide a sale that ended after the page was built.
		$html .= '<script>document.querySelectorAll(".otonaselect-campaign[data-end]").forEach(function(e){if(Date.parse(e.dataset.end)<=Date.now())e.hidden=true;});</script>';
	}
	return $html;
}

add_filter('render_block_core/post-content', static function (string $content): string {
	if (!is_singular('post') || !str_contains($content, 'class="blog-work-title"')) {
		return $content;
	}
	$start = strpos($content, 'class="blog-work-title"');
	$close = strpos($content, '</p>', (int) $start);
	if ($close === false) {
		return $content;
	}
	$href = '';
	if (preg_match('/<a href="([^"]+)"/', substr($content, (int) $start, $close - (int) $start), $m)) {
		$href = html_entity_decode($m[1]);
	}
	$info = otonaselect_render_work_info((int) get_queried_object_id(), $href);
	if ($info === '') {
		return $content;
	}
	$at = $close + strlen('</p>');
	return substr($content, 0, $at) . $info . substr($content, $at);
}, 10, 1);
