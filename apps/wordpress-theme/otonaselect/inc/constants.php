<?php
/**
 * Theme constants — production host only.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/** Production public origin (canonical / sitemap / OG). Never mixh.jp. */
const OTONASELECT_PRODUCTION_ORIGIN = 'https://otonaselect.net';

/** Legacy hosts that must never appear in canonical / sitemap / OG. */
const OTONASELECT_LEGACY_HOSTS = [
	'otonaselect.mixh.jp',
	'www.otonaselect.mixh.jp',
];

const OTONASELECT_META_SEO_TITLE = 'otonaselect_seo_title';
const OTONASELECT_META_SEO_DESCRIPTION = 'otonaselect_seo_description';
const OTONASELECT_META_PRODUCT_CID = 'otonaselect_product_cid';
const OTONASELECT_META_SAFE_OG_IMAGE = 'otonaselect_safe_og_image';
const OTONASELECT_META_SERIES_NAME = 'otonaselect_series_name';

const OTONASELECT_TAX_PERFORMER = 'performer';
const OTONASELECT_TAX_SERIES = 'series';
