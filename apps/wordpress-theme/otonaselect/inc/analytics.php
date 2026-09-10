<?php
/**
 * First-party analytics + optional GA4.
 * Events are aggregated for Factory Performance ingestion later.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

const OTONASELECT_OPTION_GA4_ID = 'otonaselect_ga4_measurement_id';
const OTONASELECT_OPTION_ANALYTICS = 'otonaselect_analytics_store_v1';
const OTONASELECT_META_POST_PV = 'otonaselect_pv_total';

/**
 * @return array{
 *   days: array<string, array{pv:int, visits:int, cta:int}>,
 *   posts: array<string, array{pv:int, cta:int, title?:string}>,
 *   categories: array<string, int>,
 *   tags: array<string, int>,
 *   referrers: array<string, int>,
 *   cta: array<string, int>,
 *   updatedAt: string
 * }
 */
function otonaselect_analytics_store_default(): array {
	return [
		'days' => [],
		'posts' => [],
		'categories' => [],
		'tags' => [],
		'referrers' => [],
		'cta' => [],
		'ageGate' => [
			'view' => 0,
			'accepted' => 0,
			'denied' => 0,
		],
		'updatedAt' => gmdate('c'),
	];
}

/**
 * @return array<string, mixed>
 */
function otonaselect_analytics_get_store(): array {
	$store = get_option(OTONASELECT_OPTION_ANALYTICS, null);
	if (!is_array($store)) {
		return otonaselect_analytics_store_default();
	}
	return array_merge(otonaselect_analytics_store_default(), $store);
}

/**
 * @param array<string, mixed> $store
 */
function otonaselect_analytics_save_store(array $store): void {
	$store['updatedAt'] = gmdate('c');
	// Keep roughly 90 days of daily buckets.
	if (isset($store['days']) && is_array($store['days']) && count($store['days']) > 100) {
		krsort($store['days']);
		$store['days'] = array_slice($store['days'], 0, 90, true);
	}
	update_option(OTONASELECT_OPTION_ANALYTICS, $store, false);
}

function otonaselect_analytics_day_key(?int $ts = null): string {
	$ts = $ts ?? time();
	return wp_date('Y-m-d', $ts) ?: gmdate('Y-m-d', $ts);
}

function otonaselect_ga4_measurement_id(): string {
	if (defined('OTONASELECT_GA4_MEASUREMENT_ID') && is_string(OTONASELECT_GA4_MEASUREMENT_ID)) {
		$id = trim(OTONASELECT_GA4_MEASUREMENT_ID);
		if ($id !== '') {
			return $id;
		}
	}
	$id = get_option(OTONASELECT_OPTION_GA4_ID, '');
	return is_string($id) ? trim($id) : '';
}

/**
 * Record a first-party event (aggregated; no PII).
 *
 * @param array<string, mixed> $payload
 */
function otonaselect_analytics_record_event(array $payload): array {
	$type = isset($payload['type']) && is_string($payload['type']) ? $payload['type'] : '';
	$allowed = ['page_view', 'cta_click', 'age_gate_view', 'age_gate_accepted', 'age_gate_denied'];
	if (!in_array($type, $allowed, true)) {
		return ['ok' => false, 'error' => 'invalid_type'];
	}

	$store = otonaselect_analytics_get_store();
	if (!isset($store['ageGate']) || !is_array($store['ageGate'])) {
		$store['ageGate'] = ['view' => 0, 'accepted' => 0, 'denied' => 0];
	}
	$day = otonaselect_analytics_day_key();
	if (!isset($store['days'][$day]) || !is_array($store['days'][$day])) {
		$store['days'][$day] = ['pv' => 0, 'visits' => 0, 'cta' => 0, 'ageGateView' => 0, 'ageGateAccepted' => 0, 'ageGateDenied' => 0];
	}

	$post_id = isset($payload['postId']) ? (int) $payload['postId'] : 0;
	$post_key = $post_id > 0 ? (string) $post_id : '0';

	if ($type === 'page_view') {
		$store['days'][$day]['pv'] = (int) $store['days'][$day]['pv'] + 1;
		$is_unique = !empty($payload['isUnique']);
		if ($is_unique) {
			$store['days'][$day]['visits'] = (int) $store['days'][$day]['visits'] + 1;
		}
		if ($post_id > 0) {
			if (!isset($store['posts'][$post_key]) || !is_array($store['posts'][$post_key])) {
				$store['posts'][$post_key] = ['pv' => 0, 'cta' => 0];
			}
			$store['posts'][$post_key]['pv'] = (int) $store['posts'][$post_key]['pv'] + 1;
			$title = get_the_title($post_id);
			if (is_string($title) && $title !== '') {
				$store['posts'][$post_key]['title'] = mb_substr($title, 0, 120);
			}
			$prev = (int) get_post_meta($post_id, OTONASELECT_META_POST_PV, true);
			update_post_meta($post_id, OTONASELECT_META_POST_PV, $prev + 1);

			$cats = get_the_category($post_id);
			if (is_array($cats)) {
				foreach (array_slice($cats, 0, 3) as $cat) {
					if ($cat instanceof WP_Term) {
						$name = $cat->name;
						$store['categories'][$name] = (int) ($store['categories'][$name] ?? 0) + 1;
					}
				}
			}
			$tags = get_the_tags($post_id);
			if (is_array($tags)) {
				foreach (array_slice($tags, 0, 5) as $tag) {
					if ($tag instanceof WP_Term) {
						$name = $tag->name;
						$store['tags'][$name] = (int) ($store['tags'][$name] ?? 0) + 1;
					}
				}
			}
		}

		$ref = isset($payload['referrerHost']) && is_string($payload['referrerHost'])
			? strtolower(preg_replace('/[^a-z0-9.-]/i', '', $payload['referrerHost']) ?? '')
			: '';
		if ($ref !== '' && strlen($ref) <= 80) {
			$store['referrers'][$ref] = (int) ($store['referrers'][$ref] ?? 0) + 1;
		}
	}

	if ($type === 'cta_click') {
		$store['days'][$day]['cta'] = (int) $store['days'][$day]['cta'] + 1;
		if ($post_id > 0) {
			if (!isset($store['posts'][$post_key]) || !is_array($store['posts'][$post_key])) {
				$store['posts'][$post_key] = ['pv' => 0, 'cta' => 0];
			}
			$store['posts'][$post_key]['cta'] = (int) $store['posts'][$post_key]['cta'] + 1;
		}
		$provider = isset($payload['provider']) && is_string($payload['provider']) ? sanitize_key($payload['provider']) : 'unknown';
		$cta = isset($payload['cta']) && is_string($payload['cta']) ? sanitize_key($payload['cta']) : 'affiliate';
		$product = isset($payload['productId']) && is_string($payload['productId'])
			? preg_replace('/[^a-zA-Z0-9_-]/', '', $payload['productId'])
			: '';
		$cta_key = $provider . ':' . $cta . ($product ? ':' . $product : '');
		$store['cta'][$cta_key] = (int) ($store['cta'][$cta_key] ?? 0) + 1;
	}

	if ($type === 'age_gate_view') {
		$store['days'][$day]['ageGateView'] = (int) ($store['days'][$day]['ageGateView'] ?? 0) + 1;
		$store['ageGate']['view'] = (int) ($store['ageGate']['view'] ?? 0) + 1;
	}
	if ($type === 'age_gate_accepted') {
		$store['days'][$day]['ageGateAccepted'] = (int) ($store['days'][$day]['ageGateAccepted'] ?? 0) + 1;
		$store['ageGate']['accepted'] = (int) ($store['ageGate']['accepted'] ?? 0) + 1;
	}
	if ($type === 'age_gate_denied') {
		// Aggregate counter only — no adult titles / personal identifiers.
		$store['days'][$day]['ageGateDenied'] = (int) ($store['days'][$day]['ageGateDenied'] ?? 0) + 1;
		$store['ageGate']['denied'] = (int) ($store['ageGate']['denied'] ?? 0) + 1;
	}

	otonaselect_analytics_save_store($store);
	return ['ok' => true];
}

/**
 * @return list<array{postId:int,pv:int,title:string,url:string}>
 */
function otonaselect_popular_posts(int $limit = 6, int $min_pv = 3): array {
	$store = otonaselect_analytics_get_store();
	$posts = isset($store['posts']) && is_array($store['posts']) ? $store['posts'] : [];
	$rows = [];
	foreach ($posts as $id => $row) {
		$post_id = (int) $id;
		$pv = is_array($row) ? (int) ($row['pv'] ?? 0) : 0;
		if ($post_id <= 0 || $pv < $min_pv) {
			continue;
		}
		$post = get_post($post_id);
		if (!$post instanceof WP_Post || $post->post_status !== 'publish' || $post->post_type !== 'post') {
			continue;
		}
		$url = get_permalink($post_id);
		$rows[] = [
			'postId' => $post_id,
			'pv' => $pv,
			'title' => get_the_title($post_id) ?: (string) ($row['title'] ?? ''),
			'url' => is_string($url) ? otonaselect_replace_legacy_host($url) : '',
		];
	}
	usort($rows, static fn ($a, $b) => $b['pv'] <=> $a['pv']);
	return array_slice($rows, 0, max(0, $limit));
}

function otonaselect_render_popular_posts_section(int $limit = 6): string {
	$popular = otonaselect_popular_posts($limit, 3);
	if (count($popular) < 3) {
		// Not enough real measurements — hide (no fake ranking).
		return '';
	}
	$items = '';
	foreach ($popular as $row) {
		$img = otonaselect_card_image_url($row['postId']);
		$img_html = $img
			? '<div class="otonaselect-popular-thumb"><img src="' . esc_url($img) . '" alt="" loading="lazy" decoding="async" /></div>'
			: '';
		$items .= '<li class="otonaselect-popular-item">'
			. '<a class="otonaselect-popular-link" href="' . esc_url($row['url']) . '">'
			. $img_html
			. '<span class="otonaselect-popular-title">' . esc_html($row['title']) . '</span>'
			. '</a></li>';
	}
	return '<section class="otonaselect-popular-section" aria-label="人気記事">'
		. '<h2 class="otonaselect-section-heading">人気記事</h2>'
		. '<ul class="otonaselect-popular-list">' . $items . '</ul>'
		. '</section>';
}

add_action('rest_api_init', static function (): void {
	register_rest_route('otonaselect/v1', '/events', [
		'methods' => 'POST',
		'permission_callback' => '__return_true',
		'callback' => static function (WP_REST_Request $req) {
			$ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : 'unknown';
			$rl_key = 'otonaselect_evt_rl_' . md5($ip);
			$hits = (int) get_transient($rl_key);
			if ($hits > 120) {
				return new WP_REST_Response(['ok' => false], 429);
			}
			set_transient($rl_key, $hits + 1, 60);

			$body = $req->get_json_params();
			if (!is_array($body)) {
				$body = [];
			}
			$result = otonaselect_analytics_record_event($body);
			return rest_ensure_response($result);
		},
	]);

	register_rest_route('otonaselect/v1', '/performance-summary', [
		'methods' => 'GET',
		'permission_callback' => static function (): bool {
			return current_user_can('manage_options');
		},
		'callback' => static function (WP_REST_Request $req) {
			$range = $req->get_param('range');
			$days = match ($range) {
				'today' => 1,
				'yesterday' => 1,
				'7d' => 7,
				'30d' => 30,
				default => 7,
			};
			return rest_ensure_response(otonaselect_analytics_summary($days, is_string($range) ? $range : '7d'));
		},
	]);
});

/**
 * @return array<string, mixed>
 */
function otonaselect_analytics_summary(int $days, string $range_label = '7d'): array {
	$store = otonaselect_analytics_get_store();
	$day_map = isset($store['days']) && is_array($store['days']) ? $store['days'] : [];
	$keys = [];
	if ($range_label === 'today') {
		$keys[] = otonaselect_analytics_day_key();
	} elseif ($range_label === 'yesterday') {
		$keys[] = otonaselect_analytics_day_key(time() - DAY_IN_SECONDS);
	} else {
		for ($i = 0; $i < $days; $i++) {
			$keys[] = otonaselect_analytics_day_key(time() - ($i * DAY_IN_SECONDS));
		}
	}

	$pv = 0;
	$visits = 0;
	$cta = 0;
	$series = [];
	foreach ($keys as $k) {
		$row = $day_map[$k] ?? null;
		$day_pv = is_array($row) ? (int) ($row['pv'] ?? 0) : 0;
		$day_visits = is_array($row) ? (int) ($row['visits'] ?? 0) : 0;
		$day_cta = is_array($row) ? (int) ($row['cta'] ?? 0) : 0;
		$pv += $day_pv;
		$visits += $day_visits;
		$cta += $day_cta;
		$series[] = ['date' => $k, 'pv' => $day_pv, 'visits' => $day_visits, 'cta' => $day_cta];
	}

	$popular = otonaselect_popular_posts(10, 1);
	$categories = isset($store['categories']) && is_array($store['categories']) ? $store['categories'] : [];
	$tags = isset($store['tags']) && is_array($store['tags']) ? $store['tags'] : [];
	$referrers = isset($store['referrers']) && is_array($store['referrers']) ? $store['referrers'] : [];
	arsort($categories);
	arsort($tags);
	arsort($referrers);

	return [
		'range' => $range_label,
		'pageViews' => $pv,
		'uniqueVisitsApprox' => $visits,
		'ctaClicks' => $cta,
		'daily' => array_reverse($series),
		'popularPosts' => $popular,
		'topCategories' => array_slice($categories, 0, 10, true),
		'topTags' => array_slice($tags, 0, 10, true),
		'topReferrers' => array_slice($referrers, 0, 10, true),
		'ageGate' => [
			'view' => (int) (($store['ageGate']['view'] ?? 0)),
			'accepted' => (int) (($store['ageGate']['accepted'] ?? 0)),
			'denied' => (int) (($store['ageGate']['denied'] ?? 0)),
		],
		'eventSchema' => [
			'page_view' => ['postId', 'isUnique', 'referrerHost', 'path'],
			'cta_click' => ['postId', 'productId', 'provider', 'cta', 'hrefHost'],
			'age_gate_view' => ['path'],
			'age_gate_accepted' => ['path'],
			'age_gate_denied' => [],
		],
		'factoryNote' => 'Export via otonaselect/v1/performance-summary for Factory Performance SSOT.',
	];
}

add_action('wp_enqueue_scripts', static function (): void {
	$ver = wp_get_theme()->get('Version') ?: '1.6.2';
	wp_enqueue_script(
		'otonaselect-analytics',
		get_template_directory_uri() . '/assets/analytics.js',
		[],
		$ver,
		true
	);

	$post_id = is_singular('post') ? (int) get_queried_object_id() : 0;
	$product_cid = $post_id > 0 ? (string) get_post_meta($post_id, OTONASELECT_META_PRODUCT_CID, true) : '';
	wp_localize_script('otonaselect-analytics', 'otonaselectAnalytics', [
		'endpoint' => esc_url_raw(rest_url('otonaselect/v1/events')),
		'postId' => $post_id,
		'productId' => $product_cid,
		'provider' => 'fanza',
		'ga4Id' => otonaselect_ga4_measurement_id(),
		'path' => isset($_SERVER['REQUEST_URI']) ? esc_url_raw(wp_unslash((string) $_SERVER['REQUEST_URI'])) : '',
	]);
});

add_action('admin_menu', static function (): void {
	add_menu_page(
		'アクセス概要',
		'アクセス概要',
		'manage_options',
		'otonaselect-analytics',
		'otonaselect_render_analytics_admin_page',
		'dashicons-chart-area',
		3
	);
});

function otonaselect_render_analytics_admin_page(): void {
	if (!current_user_can('manage_options')) {
		return;
	}
	$range = isset($_GET['range']) ? sanitize_key((string) wp_unslash($_GET['range'])) : '7d';
	if (!in_array($range, ['today', 'yesterday', '7d', '30d'], true)) {
		$range = '7d';
	}
	$summary = otonaselect_analytics_summary(30, $range);
	$ga4 = otonaselect_ga4_measurement_id();

	if (isset($_POST['otonaselect_ga4_nonce']) && wp_verify_nonce(sanitize_text_field(wp_unslash((string) $_POST['otonaselect_ga4_nonce'])), 'otonaselect_save_ga4')) {
		$id = isset($_POST['otonaselect_ga4_id']) ? sanitize_text_field(wp_unslash((string) $_POST['otonaselect_ga4_id'])) : '';
		if ($id === '' || preg_match('/^G-[A-Z0-9]+$/', $id)) {
			update_option(OTONASELECT_OPTION_GA4_ID, $id, false);
			$ga4 = $id;
			echo '<div class="notice notice-success"><p>GA4 Measurement ID を保存しました。</p></div>';
		} else {
			echo '<div class="notice notice-error"><p>Measurement ID の形式が不正です（例: G-XXXXXXXX）。</p></div>';
		}
	}

	echo '<div class="wrap"><h1>オトナセレクト アクセス概要</h1>';
	echo '<p>Factory Performance へ将来接続するための一次集計です。個人を特定するデータは保存しません。</p>';
	echo '<p>';
	foreach (['today' => '今日', 'yesterday' => '昨日', '7d' => '7日', '30d' => '30日'] as $key => $label) {
		$url = admin_url('admin.php?page=otonaselect-analytics&range=' . $key);
		$style = $range === $key ? 'font-weight:700;' : '';
		echo '<a style="margin-right:1rem;' . esc_attr($style) . '" href="' . esc_url($url) . '">' . esc_html($label) . '</a>';
	}
	echo '</p>';
	echo '<table class="widefat striped" style="max-width:40rem"><tbody>';
	echo '<tr><th>総PV</th><td>' . esc_html((string) $summary['pageViews']) . '</td></tr>';
	echo '<tr><th>訪問数（概算）</th><td>' . esc_html((string) $summary['uniqueVisitsApprox']) . '</td></tr>';
	echo '<tr><th>CTAクリック</th><td>' . esc_html((string) $summary['ctaClicks']) . '</td></tr>';
	$age = is_array($summary['ageGate'] ?? null) ? $summary['ageGate'] : [];
	echo '<tr><th>Age Gate表示</th><td>' . esc_html((string) ($age['view'] ?? 0)) . '</td></tr>';
	echo '<tr><th>Age Gate同意（18歳以上）</th><td>' . esc_html((string) ($age['accepted'] ?? 0)) . '</td></tr>';
	echo '<tr><th>Age Gate拒否（18歳未満）</th><td>' . esc_html((string) ($age['denied'] ?? 0)) . '</td></tr>';
	echo '</tbody></table>';

	echo '<h2>人気記事</h2><ol>';
	$popular = is_array($summary['popularPosts']) ? $summary['popularPosts'] : [];
	if ($popular === []) {
		echo '<li>まだ十分な実測がありません。</li>';
	} else {
		foreach ($popular as $row) {
			if (!is_array($row)) {
				continue;
			}
			echo '<li>' . esc_html((string) ($row['title'] ?? '')) . '（PV ' . esc_html((string) ($row['pv'] ?? 0)) . '）</li>';
		}
	}
	echo '</ol>';

	echo '<h2>GA4（任意）</h2>';
	echo '<form method="post">';
	wp_nonce_field('otonaselect_save_ga4', 'otonaselect_ga4_nonce');
	echo '<p><label>Measurement ID <input type="text" name="otonaselect_ga4_id" value="' . esc_attr($ga4) . '" placeholder="G-XXXXXXXX" class="regular-text" /></label></p>';
	echo '<p class="description">未設定でも一次集計は動作します。コードへ直書きせず、この option または wp-config の OTONASELECT_GA4_MEASUREMENT_ID で管理します。</p>';
	submit_button('保存');
	echo '</form></div>';
}
