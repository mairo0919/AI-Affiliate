<?php
/**
 * Plugin Name: OtonaSelect Age Gate
 * Description: Site-wide 18+ age confirmation gate for オトナセレクト (SSOT). Do not add a parallel JS/CSS gate in the theme header.
 * Version: 1.0.1
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * Author: Otona Select
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Age Gate SSOT loader.
 * - Prefer embedded copy shipped with this plugin (stable on hosts where theme PHP lags).
 * - Skip entirely if another loader already registered the gate.
 */
add_action('plugins_loaded', static function (): void {
	if (defined('OTONASELECT_AGE_GATE_LOADED')) {
		return;
	}
	require_once __DIR__ . '/embedded-age-gate.php';
}, 5);
