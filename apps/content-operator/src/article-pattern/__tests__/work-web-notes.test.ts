import { describe, expect, it } from "vitest";
import {
  buildWorkWebQuery,
  collectWorkWebNotes,
  corroboratedWebNotes,
  htmlToSentences,
  isUsableWebNoteHost,
} from "../work-web-notes.js";
import type { AppConfig } from "@ai-affiliate/config";

describe("work web notes", () => {
  it("skips store, official, and piracy hosts", () => {
    expect(isUsableWebNoteHost("https://eroism.jp/sone00638/")).toBe(true);
    expect(isUsableWebNoteHost("https://video.dmm.co.jp/av/content/?id=x")).toBe(false);
    expect(isUsableWebNoteHost("https://sukebei.nyaa.si/view/1")).toBe(false);
    expect(isUsableWebNoteHost("https://javfree.me/1/x")).toBe(false);
    expect(isUsableWebNoteHost("https://s1s1s1.com/works/detail/sone638/")).toBe(false);
  });

  it("queries the performer with the product code as blogs write it", () => {
    expect(buildWorkWebQuery({ contentId: "sone00638", performers: ["瀬戸環奈"] })).toBe("瀬戸環奈 SONE-638");
    expect(buildWorkWebQuery({ contentId: "1namh00045", performers: ["泉りおん"] })).toBe("泉りおん NAMH-045");
  });

  it("keeps only sentences whose new word another site also uses, and drops copies of the official text", () => {
    const official = "2泊3日のデートを敢行。遊園地ではしゃいで楽しそう。";
    const notes = corroboratedWebNotes({
      officialText: official,
      pages: [
        { url: "https://a.jp/1", sentences: ["二日目は五つ星ホテルで朝までハメ撮りが続く。", "遊園地ではしゃいで楽しそうにしている。", "この女優は宇宙一かわいいと思う。", "ハメ撮りのカメラが回る。"] },
        { url: "https://b.jp/2", sentences: ["最後は五つ星ホテルの部屋でハメ撮りしながら口内射精を受け止める。"] },
      ],
    });
    expect(notes).toEqual([
      "a.jp: 二日目は五つ星ホテルで朝までハメ撮りが続く。",
      "b.jp: 最後は五つ星ホテルの部屋でハメ撮りしながら口内射精を受け止める。",
    ]);
  });

  it("reads sentences from HTML without page furniture", () => {
    const s = htmlToSentences("<nav>メニュー</nav><p>二人は温泉旅館で朝まで求め合う展開になる。</p><p>価格は1980円です。</p><p>濃密なキスシーンは特に必見の内容だ。</p>");
    expect(s).toEqual(["二人は温泉旅館で朝まで求め合う展開になる。"]);
  });

  it("returns nothing without a search key and never throws on fetch errors", async () => {
    const search = { providerKey: "t", search: async () => [{ url: "https://a.jp/1" }] };
    expect(
      await collectWorkWebNotes({ config: {} as AppConfig, search, contentId: "abc00001", productTitle: "t", performers: ["p"], officialText: "" }),
    ).toEqual([]);
    expect(
      await collectWorkWebNotes({
        config: { articlePatternSearchApiKey: "k" } as AppConfig,
        search,
        contentId: "abc00001",
        productTitle: "t",
        performers: ["p"],
        officialText: "",
        fetchHtml: async () => {
          throw new Error("down");
        },
      }),
    ).toEqual([]);
  });
});
