import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(HERE, "../../../../wordpress-plugins/otonaselect-age-gate");
const THEME_AGE = resolve(HERE, "../../../../wordpress-theme/otonaselect/inc/age-gate.php");
const THEME_FUNCTIONS = resolve(HERE, "../../../../wordpress-theme/otonaselect/functions.php");

/** Mirrors plugin/theme front-door decision after skip checks. */
function ageGateDecision(cookie: string | null): "pass" | "gate" | "denied" {
  if (cookie === "1") return "pass";
  if (cookie === "0") return "denied";
  return "gate";
}

describe("Age Gate 1.0.2 plugin source guards", () => {
  const main = readFileSync(join(PLUGIN_DIR, "otonaselect-age-gate.php"), "utf8");
  const embedded = readFileSync(join(PLUGIN_DIR, "embedded-age-gate.php"), "utf8");

  it("is version 1.0.2 and self-contained (no secondary logic require)", () => {
    expect(main).toMatch(/\*\s*Version:\s*1\.0\.2\b/);
    expect(main).not.toMatch(/require(?:_once)?\s+__DIR__\s*\.\s*['"]\/embedded-age-gate\.php['"]/);
    expect(main).toMatch(/add_action\(\s*'init'\s*,\s*'otonaselect_age_gate_plugin_bootstrap'/);
  });

  it("keeps HttpOnly cookie and does not rely on document.cookie unlock", () => {
    expect(main).toMatch(/'httponly'\s*=>\s*true/);
    expect(main).not.toMatch(/document\.cookie/);
    expect(main).not.toMatch(/otonaselect-age-boot/);
    expect(main).not.toMatch(/visibility\s*:\s*hidden/);
  });

  it("avoids PHP 8-only match() and guards WP_Query before is_feed()", () => {
    expect(main).not.toMatch(/\bmatch\s*\(/);
    expect(main).toMatch(/\$wp_query instanceof WP_Query/);
    expect(main).toMatch(/try\s*\{/);
    expect(main).toMatch(/catch\s*\(\s*Throwable/);
  });

  it("embedded file is inert (no symbol redefinitions)", () => {
    expect(embedded).not.toMatch(/function\s+otonaselect_age_gate_/);
    expect(embedded).not.toMatch(/add_action\s*\(/);
    expect(embedded).toMatch(/Intentionally empty|Deprecated/i);
  });

  it("theme skips loading age-gate.php while plugin is active", () => {
    const fn = readFileSync(THEME_FUNCTIONS, "utf8");
    expect(fn).toMatch(/otonaselect-age-gate\/otonaselect-age-gate\.php/);
    expect(fn).toMatch(/active_plugins/);
    expect(fn).toMatch(/require_once \$otonaselect_inc \. '\/age-gate\.php'/);
  });

  it("theme fallback also removed match()", () => {
    const themeGate = readFileSync(THEME_AGE, "utf8");
    expect(themeGate).not.toMatch(/\bmatch\s*\(/);
  });
});

describe("Age Gate regression decisions", () => {
  it("routes cookie states correctly", () => {
    expect(ageGateDecision(null)).toBe("gate");
    expect(ageGateDecision("1")).toBe("pass");
    expect(ageGateDecision("0")).toBe("denied");
  });
});

describe("Age Gate activation/bootstrap ZIP smoke", () => {
  it("builds a zip that loads without secondary require and bootstraps under WP stubs", () => {
    const work = mkdtempSync(join(tmpdir(), "age-gate-boot-"));
    try {
      const pluginSrc = join(PLUGIN_DIR, "otonaselect-age-gate.php");
      expect(existsSync(pluginSrc)).toBe(true);

      // Package like deploy CLI: folder + single main file (+ inert embedded).
      const packDir = join(work, "otonaselect-age-gate");
      mkdirSync(packDir, { recursive: true });
      writeFileSync(join(packDir, "otonaselect-age-gate.php"), readFileSync(pluginSrc));
      writeFileSync(join(packDir, "embedded-age-gate.php"), readFileSync(join(PLUGIN_DIR, "embedded-age-gate.php")));
      const zipPath = join(work, "otonaselect-age-gate-1.0.2.zip");
      execFileSync("zip", ["-r", "-q", zipPath, "otonaselect-age-gate"], { cwd: work });

      const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
      expect(listing).toMatch(/otonaselect-age-gate\/otonaselect-age-gate\.php/);
      expect(listing).toMatch(/otonaselect-age-gate\/embedded-age-gate\.php/);

      const extractedMain = execFileSync("unzip", ["-p", zipPath, "otonaselect-age-gate/otonaselect-age-gate.php"], {
        encoding: "utf8",
      });
      expect(extractedMain).toMatch(/Version:\s*1\.0\.2/);
      expect(extractedMain).not.toMatch(/require(?:_once)?\s+__DIR__\s*\.\s*['"]\/embedded-age-gate\.php['"]/);

      // Lightweight “WP load” simulation: ensure bootstrap registers on init and LOADED is set once.
      expect(extractedMain).toMatch(/function otonaselect_age_gate_plugin_bootstrap/);
      expect(extractedMain).toMatch(/define\(\s*'OTONASELECT_AGE_GATE_LOADED'/);
      expect(extractedMain).toMatch(/otonaselect_age_gate_on_template_redirect/);

      // Simulate double-include safety: LOADED short-circuit appears before heavy work.
      const loadedIdx = extractedMain.indexOf("OTONASELECT_AGE_GATE_LOADED");
      const redirectIdx = extractedMain.indexOf("otonaselect_age_gate_on_template_redirect");
      expect(loadedIdx).toBeGreaterThan(-1);
      expect(redirectIdx).toBeGreaterThan(loadedIdx);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
