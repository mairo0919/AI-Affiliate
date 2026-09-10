import { describe, expect, it } from "vitest";

/** Mirrors theme/CLI max-variant preference for TOP card URLs. */
function preferMaxOfficialVariant(url: string): string {
  try {
    const u = new URL(url);
    const file = u.pathname.split("/").pop() || "";
    let next = file;
    if (/^[a-z0-9_]+(ps|pt)\.(jpe?g|webp|png)$/i.test(file)) {
      next = file.replace(/(ps|pt)\./i, "pl.");
    } else if (/^[a-z0-9_]+js-\d+\.(jpe?g|webp|png)$/i.test(file)) {
      next = file.replace(/js-/i, "jp-");
    } else if (/^[a-z0-9_]+-\d+\.(jpe?g|webp|png)$/i.test(file) && !/j[ps]-\d+\./i.test(file)) {
      next = file.replace(/^([a-z0-9_]+)-(\d+)\./i, "$1jp-$2.");
    }
    if (next === file) return url;
    u.pathname = u.pathname.replace(
      new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
      next,
    );
    return u.toString();
  } catch {
    return url;
  }
}

function pickBestCardImage(html: string): string | null {
  const urls = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]!);
  let best: string | null = null;
  let bestScore = -1;
  for (const raw of urls) {
    let url = raw;
    try {
      url = preferMaxOfficialVariant(raw);
      const host = new URL(url).hostname.toLowerCase();
      if (!/(^|\.)dmm\.co\.jp$|(^|\.)dmm\.com$/i.test(host)) continue;
    } catch {
      continue;
    }
    const file = (url.split("?")[0] || "").split("/").pop() || "";
    let score = 10;
    if (/pl\./i.test(file)) score = 100;
    else if (/jp-\d+\./i.test(file)) score = 80;
    else if (/ps\.|pt\./i.test(file)) score = 50;
    else if (/-\d+\./i.test(file)) score = 30;
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
  }
  return best;
}

describe("TOP card image selection", () => {
  it("prefers pl over strip and ps", () => {
    const html = `
      <img src="https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/mizd00317/mizd00317-1.jpg" />
      <img src="https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/mizd00317/mizd00317ps.jpg" />
      <img src="https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/mizd00317/mizd00317pl.jpg" />
    `;
    expect(pickBestCardImage(html)).toBe(
      "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/mizd00317/mizd00317pl.jpg",
    );
  });

  it("upgrades strip to jp when only strip exists", () => {
    expect(
      preferMaxOfficialVariant(
        "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084-10.jpg",
      ),
    ).toBe(
      "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1711mgtd00084/h_1711mgtd00084jp-10.jpg",
    );
  });
});
