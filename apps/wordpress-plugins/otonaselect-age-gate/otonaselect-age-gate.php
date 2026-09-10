<?php
/**
 * Plugin Name: OtonaSelect Age Gate
 * Description: Site-wide 18+ age confirmation gate for オトナセレクト. Safe alongside the otonaselect theme.
 * Version: 1.0.0
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * Author: Otona Select
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Load theme implementation when available; otherwise use embedded fallback.
 * Theme functions.php also require_once's age-gate.php — OTONASELECT_AGE_GATE_LOADED prevents double hook registration.
 */
add_action('after_setup_theme', static function (): void {
	if (defined('OTONASELECT_AGE_GATE_LOADED')) {
		return;
	}
	$theme_gate = get_template_directory() . '/inc/age-gate.php';
	if (is_readable($theme_gate)) {
		require_once $theme_gate;
		return;
	}
	require_once __DIR__ . '/embedded-age-gate.php';
}, 1);
