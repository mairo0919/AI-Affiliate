<?php
/**
 * Site foundation pages for affiliate application / trust.
 * Creates missing pages on theme switch; does not duplicate existing slugs.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/**
 * @return array<string, array{title:string,content:string}>
 */
function otonaselect_foundation_page_defs(): array {
	return [
		'about' => [
			'title' => 'サイトについて / 運営者情報',
			'content' => <<<'HTML'
<!-- wp:heading {"level":1} --><h1 class="wp-block-heading">サイトについて</h1><!-- /wp:heading -->
<!-- wp:paragraph --><p>オトナセレクト（otonaselect.net）は、公開情報に基づき作品や出演者の情報を読みやすい記事としてまとめるメディアです。</p><!-- /wp:paragraph -->
<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">運営方針</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>記事は確認できる事実を中心に構成します。存在しない評価・価格・在庫・口コミを捏造しません。</p><!-- /wp:paragraph -->
<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">年齢制限</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>本サイトは成人向け情報を含みます。18歳未満の方はご利用いただけません。</p><!-- /wp:paragraph -->
HTML,
		],
		'contact' => [
			'title' => 'お問い合わせ',
			'content' => <<<'HTML'
<!-- wp:heading {"level":1} --><h1 class="wp-block-heading">お問い合わせ</h1><!-- /wp:heading -->
<!-- wp:paragraph --><p>掲載内容に関するご連絡、削除・訂正のご依頼、広告・提携のご相談は以下のフォームよりご連絡ください。</p><!-- /wp:paragraph -->
<!-- wp:paragraph --><p>※返信には数営業日いただく場合があります。アフィリエイト成果や個人の購入サポートには回答できないことがあります。</p><!-- /wp:paragraph -->
HTML,
		],
		'privacy' => [
			'title' => 'プライバシーポリシー',
			'content' => <<<'HTML'
<!-- wp:heading {"level":1} --><h1 class="wp-block-heading">プライバシーポリシー</h1><!-- /wp:heading -->
<!-- wp:paragraph --><p>当サイトは、アクセス解析や広告配信のため Cookie 等を利用する場合があります。</p><!-- /wp:paragraph -->
<!-- wp:paragraph --><p>お問い合わせで取得した連絡先は、当該対応の目的でのみ利用し、法令に基づく場合を除き第三者に提供しません。</p><!-- /wp:paragraph -->
<!-- wp:paragraph --><p>詳細な改定がある場合は本ページを更新します。</p><!-- /wp:paragraph -->
HTML,
		],
		'affiliate-disclosure' => [
			'title' => '広告・アフィリエイトについて',
			'content' => <<<'HTML'
<!-- wp:heading {"level":1} --><h1 class="wp-block-heading">広告・アフィリエイトについて</h1><!-- /wp:heading -->
<!-- wp:paragraph --><p>本サイトの情報にはアフィリエイト広告（成果報酬型リンク）が含まれる場合があります。</p><!-- /wp:paragraph -->
<!-- wp:paragraph --><p>リンク経由の購入等により当サイトが報酬を受け取る場合がありますが、紹介内容の方針（確認できる事実に基づく記述）は報酬の有無で変更しません。</p><!-- /wp:paragraph -->
<!-- wp:paragraph --><p>商品の最新情報・価格・在庫・配信条件は各公式ページでご確認ください。</p><!-- /wp:paragraph -->
HTML,
		],
		'disclaimer' => [
			'title' => '免責事項',
			'content' => <<<'HTML'
<!-- wp:heading {"level":1} --><h1 class="wp-block-heading">免責事項</h1><!-- /wp:heading -->
<!-- wp:paragraph --><p>記事の内容は公開時点で確認できた情報に基づきます。情報の正確性・完全性・有用性について保証するものではありません。</p><!-- /wp:paragraph -->
<!-- wp:paragraph --><p>本サイト利用により生じた損害について、法令で認められる範囲を超えて責任を負いません。</p><!-- /wp:paragraph -->
HTML,
		],
		'performers' => [
			'title' => '出演者一覧',
			'content' => <<<'HTML'
<!-- wp:html -->
<div class="otonaselect-performer-hub-slot"></div>
<!-- /wp:html -->
HTML,
		],
		'categories' => [
			'title' => 'カテゴリ一覧',
			'content' => <<<'HTML'
<!-- wp:html -->
<div class="otonaselect-category-hub-slot"></div>
<!-- /wp:html -->
HTML,
		],
		'series-list' => [
			'title' => 'シリーズ一覧',
			'content' => <<<'HTML'
<!-- wp:html -->
<div class="otonaselect-series-hub-slot"></div>
<!-- /wp:html -->
HTML,
		],
	];
}

/**
 * Ensure foundation pages exist (idempotent).
 *
 * @return array{created:list<string>,existing:list<string>}
 */
function otonaselect_ensure_foundation_pages(): array {
	$created = [];
	$existing = [];
	$updated = [];
	foreach (otonaselect_foundation_page_defs() as $slug => $def) {
		$found = get_page_by_path($slug);
		if ($found instanceof WP_Post) {
			$existing[] = $slug;
			// Hub pages: refresh slot markup if missing (idempotent content fix).
			if (in_array($slug, ['performers', 'categories', 'series-list'], true)) {
				$content = (string) $found->post_content;
				$needs =
					($slug === 'performers' && !str_contains($content, 'otonaselect-performer-hub-slot'))
					|| ($slug === 'categories' && !str_contains($content, 'otonaselect-category-hub-slot'))
					|| ($slug === 'series-list' && !str_contains($content, 'otonaselect-series-hub-slot'));
				if ($needs) {
					$r = wp_update_post([
						'ID' => (int) $found->ID,
						'post_content' => $def['content'],
						'post_title' => $def['title'],
					], true);
					if (!is_wp_error($r)) {
						$updated[] = $slug;
					}
				}
			}
			continue;
		}
		$id = wp_insert_post([
			'post_type' => 'page',
			'post_status' => 'publish',
			'post_title' => $def['title'],
			'post_name' => $slug,
			'post_content' => $def['content'],
		], true);
		if (!is_wp_error($id) && $id) {
			$created[] = $slug;
		}
	}
	return compact('created', 'existing', 'updated');
}

add_action('after_switch_theme', static function (): void {
	otonaselect_ensure_foundation_pages();
	flush_rewrite_rules();
});

/**
 * Admin / WP-CLI helper: Tools → also expose via REST for ops.
 */
add_action('rest_api_init', static function (): void {
	register_rest_route('otonaselect/v1', '/ensure-foundation-pages', [
		'methods' => 'POST',
		'permission_callback' => static function (): bool {
			return current_user_can('manage_options');
		},
		'callback' => static function () {
			return rest_ensure_response(otonaselect_ensure_foundation_pages());
		},
	]);

	register_rest_route('otonaselect/v1', '/flush-rewrites', [
		'methods' => 'POST',
		'permission_callback' => static function (): bool {
			return current_user_can('manage_options');
		},
		'callback' => static function () {
			flush_rewrite_rules(false);
			$ver = 'otonaselect-tax-rewrite-1.6.4';
			update_option('otonaselect_tax_rewrite_version', $ver, true);
			return rest_ensure_response([
				'ok' => true,
				'rewriteVersion' => $ver,
			]);
		},
	]);
});
