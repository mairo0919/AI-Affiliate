<?php
/**
 * Taxonomy reading (かな) helpers + gojuon grouping.
 * Reading is SSOT for sort; never invent readings with AI.
 *
 * @package OtonaSelect
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

const OTONASELECT_TERM_META_READING = 'otonaselect_reading_kana';

/** @var array<string, string> Policy category display name → reading (not AI). */
const OTONASELECT_CATEGORY_READING_MAP = [
	'企画' => 'きかく',
	'単体作品' => 'たんたいさくひん',
	'ベスト・総集編' => 'べすとそうしゅうへん',
	'VR' => 'vr',
];

/**
 * @return list<array{key:string,label:string}>
 */
function otonaselect_gojuon_groups(): array {
	return [
		['key' => 'a', 'label' => 'あ'],
		['key' => 'ka', 'label' => 'か'],
		['key' => 'sa', 'label' => 'さ'],
		['key' => 'ta', 'label' => 'た'],
		['key' => 'na', 'label' => 'な'],
		['key' => 'ha', 'label' => 'は'],
		['key' => 'ma', 'label' => 'ま'],
		['key' => 'ya', 'label' => 'や'],
		['key' => 'ra', 'label' => 'ら'],
		['key' => 'wa', 'label' => 'わ'],
		['key' => 'other', 'label' => 'その他'],
	];
}

function otonaselect_normalize_kana(string $raw): string {
	$t = trim($raw);
	if ($t === '') {
		return '';
	}
	if (function_exists('mb_convert_kana')) {
		$t = mb_convert_kana($t, 'cHVas', 'UTF-8');
	}
	$t = preg_replace('/\s+/u', '', $t) ?? $t;
	return mb_strtolower($t, 'UTF-8');
}

/**
 * Resolve reading for a term. Empty when unknown (sort into その他).
 */
function otonaselect_term_reading(WP_Term $term): string {
	$meta = get_term_meta((int) $term->term_id, OTONASELECT_TERM_META_READING, true);
	if (is_string($meta) && trim($meta) !== '') {
		return otonaselect_normalize_kana($meta);
	}
	if ($term->taxonomy === 'category') {
		$map = OTONASELECT_CATEGORY_READING_MAP;
		if (isset($map[$term->name])) {
			return otonaselect_normalize_kana($map[$term->name]);
		}
	}
	return '';
}

function otonaselect_set_term_reading(int $term_id, string $reading): void {
	$normalized = otonaselect_normalize_kana($reading);
	if ($normalized === '') {
		delete_term_meta($term_id, OTONASELECT_TERM_META_READING);
		return;
	}
	update_term_meta($term_id, OTONASELECT_TERM_META_READING, $normalized);
}

/**
 * Map first kana / latin char to gojuon group key.
 */
function otonaselect_gojuon_group_key(string $reading): string {
	$reading = otonaselect_normalize_kana($reading);
	if ($reading === '') {
		return 'other';
	}
	$ch = mb_substr($reading, 0, 1, 'UTF-8');
	$ord = function_exists('mb_ord') ? mb_ord($ch, 'UTF-8') : null;

	// Hiragana rows (あ〜ん) including dakuten/handakuten by base row.
	$map = [
		'あ' => 'a', 'い' => 'a', 'う' => 'a', 'え' => 'a', 'お' => 'a',
		'ぁ' => 'a', 'ぃ' => 'a', 'ぅ' => 'a', 'ぇ' => 'a', 'ぉ' => 'a', 'ゔ' => 'a',
		'か' => 'ka', 'き' => 'ka', 'く' => 'ka', 'け' => 'ka', 'こ' => 'ka',
		'が' => 'ka', 'ぎ' => 'ka', 'ぐ' => 'ka', 'げ' => 'ka', 'ご' => 'ka',
		'さ' => 'sa', 'し' => 'sa', 'す' => 'sa', 'せ' => 'sa', 'そ' => 'sa',
		'ざ' => 'sa', 'じ' => 'sa', 'ず' => 'sa', 'ぜ' => 'sa', 'ぞ' => 'sa',
		'た' => 'ta', 'ち' => 'ta', 'つ' => 'ta', 'て' => 'ta', 'と' => 'ta',
		'だ' => 'ta', 'ぢ' => 'ta', 'づ' => 'ta', 'で' => 'ta', 'ど' => 'ta', 'っ' => 'ta',
		'な' => 'na', 'に' => 'na', 'ぬ' => 'na', 'ね' => 'na', 'の' => 'na',
		'は' => 'ha', 'ひ' => 'ha', 'ふ' => 'ha', 'へ' => 'ha', 'ほ' => 'ha',
		'ば' => 'ha', 'び' => 'ha', 'ぶ' => 'ha', 'べ' => 'ha', 'ぼ' => 'ha',
		'ぱ' => 'ha', 'ぴ' => 'ha', 'ぷ' => 'ha', 'ぺ' => 'ha', 'ぽ' => 'ha',
		'ま' => 'ma', 'み' => 'ma', 'む' => 'ma', 'め' => 'ma', 'も' => 'ma',
		'や' => 'ya', 'ゆ' => 'ya', 'よ' => 'ya', 'ゃ' => 'ya', 'ゅ' => 'ya', 'ょ' => 'ya',
		'ら' => 'ra', 'り' => 'ra', 'る' => 'ra', 'れ' => 'ra', 'ろ' => 'ra',
		'わ' => 'wa', 'を' => 'wa', 'ん' => 'wa', 'ゎ' => 'wa',
	];
	if (isset($map[$ch])) {
		return $map[$ch];
	}
	if (preg_match('/^[a-z0-9]/i', $ch)) {
		return 'other';
	}
	if (is_int($ord) && $ord >= 0x30A1 && $ord <= 0x30F6) {
		// Katakana should already be converted; fallback to other.
		return 'other';
	}
	return 'other';
}

/**
 * @param list<WP_Term> $terms
 * @return array<string, list<WP_Term>>
 */
function otonaselect_group_terms_by_gojuon(array $terms): array {
	$groups = [];
	foreach (otonaselect_gojuon_groups() as $g) {
		$groups[$g['key']] = [];
	}
	foreach ($terms as $term) {
		if (!$term instanceof WP_Term) {
			continue;
		}
		$reading = otonaselect_term_reading($term);
		$key = otonaselect_gojuon_group_key($reading);
		if (!isset($groups[$key])) {
			$key = 'other';
		}
		$groups[$key][] = $term;
	}
	foreach ($groups as $key => $list) {
		usort(
			$list,
			static function (WP_Term $a, WP_Term $b): int {
				$ra = otonaselect_term_reading($a);
				$rb = otonaselect_term_reading($b);
				if ($ra !== '' && $rb !== '') {
					$cmp = strcmp($ra, $rb);
					if ($cmp !== 0) {
						return $cmp;
					}
				} elseif ($ra !== '' && $rb === '') {
					return -1;
				} elseif ($ra === '' && $rb !== '') {
					return 1;
				}
				return strcasecmp($a->name, $b->name);
			}
		);
		$groups[$key] = $list;
	}
	return $groups;
}
