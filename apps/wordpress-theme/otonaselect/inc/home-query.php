<?php
/**
 * Front / home latest posts: publish date DESC, 12 per page, standard /page/N/.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Main query for the blog-on-front stream and taxonomy archives.
 * Order is always post_date DESC; sticky never jumps ahead.
 */
add_action(
	'pre_get_posts',
	static function (WP_Query $query): void {
		if (is_admin() || !$query->is_main_query()) {
			return;
		}

		$is_blog_front = $query->is_home() && $query->is_front_page();
		$is_posts_index = $query->is_home() && !$query->is_front_page();
		$is_tax_archive =
			$query->is_category()
			|| $query->is_tag()
			|| $query->is_tax([OTONASELECT_TAX_PERFORMER, OTONASELECT_TAX_SERIES]);

		if (!$is_blog_front && !$is_posts_index && !$is_tax_archive) {
			return;
		}

		$query->set('post_type', 'post');
		$query->set('post_status', 'publish');
		$query->set('posts_per_page', 12);
		$query->set('orderby', 'date');
		$query->set('order', 'DESC');
		$query->set('ignore_sticky_posts', true);
	},
	5
);

/**
 * Out-of-range /page/N/ on the posts stream → real 404 (not empty 200).
 */
add_action(
	'template_redirect',
	static function (): void {
		if (is_admin() || is_feed() || is_preview()) {
			return;
		}
		if (!(is_home() || is_front_page()) || !is_paged()) {
			return;
		}

		global $wp_query;
		if (!$wp_query instanceof WP_Query) {
			return;
		}

		$paged = max(
			(int) $wp_query->get('paged'),
			(int) get_query_var('paged'),
			(int) get_query_var('page')
		);
		$max = (int) $wp_query->max_num_pages;
		if ($paged > 1 && $max > 0 && $paged > $max) {
			$wp_query->set_404();
			status_header(404);
			nocache_headers();
		}
	},
	1
);
