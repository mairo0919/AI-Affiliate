<?php
/**
 * JSON-LD: WebSite, Organization, BreadcrumbList, Article.
 * Never invent rating / review / price / availability.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

function otonaselect_print_json_ld(array $graph): void {
	$payload = [
		'@context' => 'https://schema.org',
		'@graph' => array_values(array_filter($graph)),
	];
	echo '<script type="application/ld+json">' .
		wp_json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) .
		'</script>' . "\n";
}

/**
 * @return list<array{name:string,url:string}>
 */
function otonaselect_breadcrumb_items(): array {
	$items = [
		[
			'name' => 'ホーム',
			'url' => otonaselect_public_origin() . '/',
		],
	];

	if (is_singular('post')) {
		$post_id = (int) get_queried_object_id();
		$performers = get_the_terms($post_id, OTONASELECT_TAX_PERFORMER);
		if (is_array($performers) && $performers !== []) {
			// No root /performer/ landing — link the concrete term only (avoid 404 crumbs).
			$first = $performers[0];
			if ($first instanceof WP_Term) {
				$link = get_term_link($first);
				$items[] = [
					'name' => $first->name,
					'url' => !is_wp_error($link) ? otonaselect_replace_legacy_host($link) : otonaselect_public_origin() . '/performer/' . rawurlencode($first->slug) . '/',
				];
			}
		} else {
			$cats = get_the_category($post_id);
			if (is_array($cats) && $cats !== []) {
				$cat = $cats[0];
				$link = get_category_link($cat->term_id);
				$items[] = [
					'name' => $cat->name,
					'url' => is_string($link) ? otonaselect_replace_legacy_host($link) : otonaselect_public_origin() . '/',
				];
			}
		}
		$title = otonaselect_seo_title_for_post($post_id);
		$items[] = [
			'name' => $title !== '' ? $title : get_the_title($post_id),
			'url' => otonaselect_canonical_url(),
		];
		return $items;
	}

	if (is_tax(OTONASELECT_TAX_PERFORMER) || is_tax(OTONASELECT_TAX_SERIES)) {
		$term = get_queried_object();
		if ($term instanceof WP_Term) {
			$items[] = [
				'name' => $term->name,
				'url' => otonaselect_canonical_url(),
			];
		}
		return $items;
	}

	if (is_category() || is_tag()) {
		$term = get_queried_object();
		if ($term instanceof WP_Term) {
			$items[] = [
				'name' => $term->name,
				'url' => otonaselect_canonical_url(),
			];
		}
	}

	return $items;
}

function otonaselect_breadcrumb_list_ld(array $items): array {
	$elements = [];
	$pos = 1;
	foreach ($items as $item) {
		$elements[] = [
			'@type' => 'ListItem',
			'position' => $pos,
			'name' => $item['name'],
			'item' => $item['url'],
		];
		$pos++;
	}
	return [
		'@type' => 'BreadcrumbList',
		'@id' => otonaselect_canonical_url() . '#breadcrumb',
		'itemListElement' => $elements,
	];
}

add_action('wp_head', static function (): void {
	if (is_admin()) {
		return;
	}

	$origin = otonaselect_public_origin();
	$site_name = get_bloginfo('name') ?: 'オトナセレクト';
	$graph = [];

	$graph[] = [
		'@type' => 'WebSite',
		'@id' => $origin . '/#website',
		'url' => $origin . '/',
		'name' => $site_name,
		'inLanguage' => 'ja-JP',
		'publisher' => ['@id' => $origin . '/#organization'],
		'potentialAction' => [
			'@type' => 'SearchAction',
			'target' => $origin . '/?s={search_term_string}',
			'query-input' => 'required name=search_term_string',
		],
	];

	$graph[] = [
		'@type' => 'Organization',
		'@id' => $origin . '/#organization',
		'name' => $site_name,
		'url' => $origin . '/',
	];

	$crumbs = otonaselect_breadcrumb_items();
	if (count($crumbs) >= 2) {
		$graph[] = otonaselect_breadcrumb_list_ld($crumbs);
	}

	if (is_singular('post')) {
		$post_id = (int) get_queried_object_id();
		$post = get_post($post_id);
		if ($post instanceof WP_Post) {
			$article = [
				'@type' => 'Article',
				'@id' => otonaselect_canonical_url() . '#article',
				'headline' => otonaselect_seo_title_for_post($post_id),
				'description' => otonaselect_seo_description_for_post($post_id),
				'datePublished' => get_the_date('c', $post) ?: null,
				'dateModified' => get_the_modified_date('c', $post) ?: null,
				'mainEntityOfPage' => [
					'@type' => 'WebPage',
					'@id' => otonaselect_canonical_url(),
				],
				'isPartOf' => ['@id' => $origin . '/#website'],
				'publisher' => ['@id' => $origin . '/#organization'],
				'inLanguage' => 'ja-JP',
			];

			// Entity hints from taxonomy — no fabricated Product offers.
			$about = [];
			$performers = get_the_terms($post_id, OTONASELECT_TAX_PERFORMER);
			if (is_array($performers)) {
				foreach ($performers as $term) {
					if ($term instanceof WP_Term) {
						$link = get_term_link($term);
						$person = [
							'@type' => 'Person',
							'name' => $term->name,
						];
						if (!is_wp_error($link)) {
							$person['url'] = otonaselect_replace_legacy_host($link);
						}
						$about[] = $person;
					}
				}
			}
			$series_terms = get_the_terms($post_id, OTONASELECT_TAX_SERIES);
			if (is_array($series_terms)) {
				foreach ($series_terms as $term) {
					if ($term instanceof WP_Term) {
						$about[] = [
							'@type' => 'CreativeWorkSeries',
							'name' => $term->name,
						];
					}
				}
			}
			$cid = get_post_meta($post_id, OTONASELECT_META_PRODUCT_CID, true);
			if (is_string($cid) && preg_match('/^[a-z][a-z0-9]{2,31}$/', strtolower($cid))) {
				$about[] = [
					'@type' => 'CreativeWork',
					'name' => otonaselect_seo_title_for_post($post_id),
					'identifier' => strtolower($cid),
				];
			}
			if ($about !== []) {
				$article['about'] = $about;
			}

			// Strip nulls
			$article = array_filter(
				$article,
				static fn ($v) => $v !== null && $v !== ''
			);
			$graph[] = $article;
		}
	}

	otonaselect_print_json_ld($graph);
}, 5);
