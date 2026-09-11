import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(HERE, "../../../../wordpress-plugins/otonaselect-age-gate");
const THEME_FUNCTIONS = resolve(HERE, "../../../../wordpress-theme/otonaselect/functions.php");
const THEME_AGE = resolve(HERE, "../../../../wordpress-theme/otonaselect/inc/age-gate.php");

describe("Age Gate 1.0.3 plugin source guards", () => {
  const main = readFileSync(join(PLUGIN_DIR, "otonaselect-age-gate.php"), "utf8");

  it("is version 1.0.3 and self-contained", () => {
    expect(main).toMatch(/\*\s*Version:\s*1\.0\.3\b/);
    expect(main).not.toMatch(/require(?:_once)?\s+__DIR__\s*\.\s*['"]\/embedded-age-gate\.php['"]/);
    expect(existsSync(join(PLUGIN_DIR, "embedded-age-gate.php"))).toBe(false);
    expect(main).toMatch(/add_action\(\s*'init'\s*,\s*'otonaselect_age_gate_plugin_bootstrap'/);
  });

  it("keeps HttpOnly cookie and early SSOT constants", () => {
    expect(main).toMatch(/'httponly'\s*=>\s*true/);
    expect(main).toMatch(/OTONASELECT_AGE_GATE_PLUGIN_ACTIVE/);
    expect(main.indexOf("OTONASELECT_AGE_GATE_PLUGIN_ACTIVE")).toBeLessThan(
      main.indexOf("function otonaselect_age_cookie_ttl_ok"),
    );
  });

  it("avoids PHP 8-only match() and guards WP_Query", () => {
    expect(main).not.toMatch(/\bmatch\s*\(/);
    expect(main).toMatch(/\$wp_query instanceof WP_Query/);
  });

  it("theme skips loading age-gate.php via plugin constant", () => {
    const fn = readFileSync(THEME_FUNCTIONS, "utf8");
    expect(fn).toMatch(/OTONASELECT_AGE_GATE_PLUGIN_ACTIVE/);
    expect(readFileSync(THEME_AGE, "utf8")).toMatch(/OTONASELECT_AGE_GATE_PLUGIN_ACTIVE/);
  });
});

describe("Age Gate regression decisions", () => {
  function ageGateDecision(cookie: string | null): "pass" | "gate" | "denied" {
    if (cookie === "1") return "pass";
    if (cookie === "0") return "denied";
    return "gate";
  }

  it("routes cookie states correctly", () => {
    expect(ageGateDecision(null)).toBe("gate");
    expect(ageGateDecision("1")).toBe("pass");
    expect(ageGateDecision("0")).toBe("denied");
  });
});

describe("Age Gate activation/bootstrap ZIP smoke", () => {
  it("builds a 1.0.3 zip with only the main SSOT file", () => {
    const work = mkdtempSync(join(tmpdir(), "age-gate-boot-"));
    try {
      const pluginSrc = join(PLUGIN_DIR, "otonaselect-age-gate.php");
      const packDir = join(work, "otonaselect-age-gate");
      mkdirSync(packDir, { recursive: true });
      writeFileSync(join(packDir, "otonaselect-age-gate.php"), readFileSync(pluginSrc));
      const zipPath = join(work, "otonaselect-age-gate-1.0.3.zip");
      execFileSync("zip", ["-r", "-q", zipPath, "otonaselect-age-gate"], { cwd: work });
      const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
      expect(listing).toMatch(/otonaselect-age-gate\/otonaselect-age-gate\.php/);
      expect(listing).not.toMatch(/embedded-age-gate/);
      const extractedMain = execFileSync("unzip", ["-p", zipPath, "otonaselect-age-gate/otonaselect-age-gate.php"], {
        encoding: "utf8",
      });
      expect(extractedMain).toMatch(/Version:\s*1\.0\.3/);
      expect(extractedMain).toMatch(/OTONASELECT_AGE_GATE_PLUGIN_ACTIVE/);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
