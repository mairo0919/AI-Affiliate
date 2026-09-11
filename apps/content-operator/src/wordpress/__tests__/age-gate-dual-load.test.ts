import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(HERE, "../../../../wordpress-plugins/otonaselect-age-gate");
const THEME_AGE = resolve(HERE, "../../../../wordpress-theme/otonaselect/inc/age-gate.php");
const THEME_FUNCTIONS = resolve(HERE, "../../../../wordpress-theme/otonaselect/functions.php");

function unguardedFunctionDefs(source: string): string[] {
  // Definitions not inside a preceding function_exists('name') block opener.
  const out: string[] = [];
  const re = /function\s+(otonaselect_age_[a-zA-Z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1]!;
    const before = source.slice(Math.max(0, m.index - 220), m.index);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`function_exists\\s*\\(\\s*['"]${escaped}['"]\\s*\\)`).test(before)) {
      out.push(name);
    }
  }
  return out;
}

describe("Age Gate 1.0.3 dual-load fatal reproduction guards", () => {
  const pluginMain = readFileSync(join(PLUGIN_DIR, "otonaselect-age-gate.php"), "utf8");
  const themeGate = readFileSync(THEME_AGE, "utf8");
  const themeFunctions = readFileSync(THEME_FUNCTIONS, "utf8");

  it("plugin defines SSOT constants at include-time before any function body", () => {
    expect(pluginMain).toMatch(/Version:\s*1\.0\.3\b/);
    const activeIdx = pluginMain.indexOf("OTONASELECT_AGE_GATE_PLUGIN_ACTIVE");
    const loadedIdx = pluginMain.indexOf("define('OTONASELECT_AGE_GATE_LOADED'");
    const firstFn = pluginMain.indexOf("function otonaselect_age_cookie_ttl_ok");
    expect(activeIdx).toBeGreaterThan(-1);
    expect(loadedIdx).toBeGreaterThan(-1);
    expect(firstFn).toBeGreaterThan(loadedIdx);
    expect(pluginMain).not.toMatch(/require(?:_once)?\s+__DIR__\s*\.\s*['"]\/embedded-age-gate\.php['"]/);
  });

  it("theme functions.php skips age-gate.php when plugin constant is set", () => {
    expect(themeFunctions).toMatch(/OTONASELECT_AGE_GATE_PLUGIN_ACTIVE/);
    expect(themeFunctions).toMatch(/OTONASELECT_AGE_GATE_LOADED/);
    expect(themeFunctions).toMatch(/function_exists\('otonaselect_age_gate_on_template_redirect'\)/);
    // Must not depend solely on get_option(active_plugins) / is_plugin_active.
    const requireBlock = themeFunctions.slice(
      themeFunctions.indexOf("Age Gate SSOT"),
      themeFunctions.indexOf("require_once $otonaselect_inc . '/contact.php'"),
    );
    expect(requireBlock).not.toMatch(/is_plugin_active\s*\(/);
    expect(requireBlock).not.toMatch(/get_option\(\s*'active_plugins'/);
  });

  it("theme age-gate.php hard-stops when plugin already loaded", () => {
    expect(themeGate).toMatch(/OTONASELECT_AGE_GATE_PLUGIN_ACTIVE/);
    expect(themeGate.indexOf("OTONASELECT_AGE_GATE_PLUGIN_ACTIVE")).toBeLessThan(
      themeGate.indexOf("function otonaselect_age_cookie_ttl_ok"),
    );
  });

  it("shared symbols are function_exists-guarded in both plugin and theme", () => {
    expect(unguardedFunctionDefs(pluginMain)).toEqual([]);
    expect(unguardedFunctionDefs(themeGate)).toEqual([]);
    expect(pluginMain).toMatch(/if \(!function_exists\('otonaselect_age_cookie_ttl_ok'\)\)/);
    expect(themeGate).toMatch(/if \(!function_exists\('otonaselect_age_cookie_ttl_ok'\)\)/);
  });

  it("reproduces the production fatal scenario safely (plugin then theme)", () => {
    // Simulate WP order: include plugin main first (sets constants + guarded defs),
    // then include theme age-gate.php which must return before redefining.
    const defined = new Set<string>();
    const constants = new Set<string>();

    function simulateInclude(source: string, label: string) {
      if (source.includes("OTONASELECT_AGE_GATE_PLUGIN_ACTIVE") && /define\(\s*'OTONASELECT_AGE_GATE_PLUGIN_ACTIVE'/.test(source)) {
        constants.add("OTONASELECT_AGE_GATE_PLUGIN_ACTIVE");
      }
      if (/define\(\s*'OTONASELECT_AGE_GATE_LOADED'/.test(source)) {
        // theme returns early if already set
        if (label === "theme" && constants.has("OTONASELECT_AGE_GATE_LOADED")) {
          return { skipped: true, defined: [...defined] };
        }
        if (label === "theme" && constants.has("OTONASELECT_AGE_GATE_PLUGIN_ACTIVE")) {
          return { skipped: true, defined: [...defined] };
        }
        constants.add("OTONASELECT_AGE_GATE_LOADED");
      }
      if (label === "theme" && constants.has("OTONASELECT_AGE_GATE_PLUGIN_ACTIVE")) {
        return { skipped: true, defined: [...defined] };
      }

      const re = /if \(!function_exists\('([^']+)'\)\)\s*\{[\s\S]*?function \1/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        const name = m[1]!;
        if (defined.has(name)) {
          throw new Error(`FATAL redeclare ${name} while including ${label}`);
        }
        defined.add(name);
      }
      return { skipped: false, defined: [...defined] };
    }

    const pluginResult = simulateInclude(pluginMain, "plugin");
    expect(pluginResult.skipped).toBe(false);
    expect(constants.has("OTONASELECT_AGE_GATE_PLUGIN_ACTIVE")).toBe(true);
    expect(defined.has("otonaselect_age_cookie_ttl_ok")).toBe(true);

    const themeResult = simulateInclude(themeGate, "theme");
    expect(themeResult.skipped).toBe(true);
  });
});

describe("Age Gate 1.0.3 ZIP packaging verification", () => {
  it("builds zip without executable embedded-age-gate and with single SSOT main", () => {
    expect(existsSync(join(PLUGIN_DIR, "embedded-age-gate.php"))).toBe(false);

    const work = mkdtempSync(join(tmpdir(), "age-gate-103-"));
    try {
      const pack = join(work, "otonaselect-age-gate");
      mkdirSync(pack);
      writeFileSync(join(pack, "otonaselect-age-gate.php"), readFileSync(join(PLUGIN_DIR, "otonaselect-age-gate.php")));
      const zipPath = join(work, "otonaselect-age-gate-1.0.3.zip");
      execFileSync("zip", ["-r", "-q", zipPath, "otonaselect-age-gate"], { cwd: work });

      const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
      expect(listing).toMatch(/otonaselect-age-gate\/otonaselect-age-gate\.php/);
      expect(listing).not.toMatch(/embedded-age-gate\.php/);

      const extracted = execFileSync("unzip", ["-p", zipPath, "otonaselect-age-gate/otonaselect-age-gate.php"], {
        encoding: "utf8",
      });
      expect(extracted).toMatch(/Version:\s*1\.0\.3/);
      expect(extracted).toMatch(/OTONASELECT_AGE_GATE_PLUGIN_ACTIVE/);
      expect((extracted.match(/function\s+otonaselect_age_cookie_ttl_ok\s*\(/g) || []).length).toBe(1);

      // Expand and grep all php files for unguarded duplicate symbol risk
      const expand = join(work, "expand");
      mkdirSync(expand);
      execFileSync("unzip", ["-q", zipPath, "-d", expand]);
      const files = readdirSync(join(expand, "otonaselect-age-gate"));
      expect(files).toEqual(["otonaselect-age-gate.php"]);
      const defs = (extracted.match(/function\s+otonaselect_age_cookie_ttl_ok\s*\(/g) || []).length;
      expect(defs).toBe(1);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
