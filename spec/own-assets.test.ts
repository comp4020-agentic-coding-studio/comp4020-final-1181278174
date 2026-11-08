import { describe, expect, it } from "vitest";
import { ask, questionsPath, startSession, Visitor } from "./visitor.ts";

// Every page loads its scripts, styles, fonts and images from this app alone:
// a request to another site would tell that site who opened which page, when.
// Links people follow are not loads, so <a href> may point anywhere.
const tag = (): string => Math.random().toString(36).slice(2, 8);

describe("loading from this app alone", () => {
  it("loads nothing from another site, on any page or in any stylesheet", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Own assets ${tag()}`);
    const path = questionsPath(hall);
    await ask(new Visitor(), path, `Anything from elsewhere? ${tag()}`);
    const base = hall.url.origin;
    const pages = ["/", "/signin", "/signup", "/readme/", "/help", "/privacy", hall.url.pathname, path, `${hall.url.pathname}/timeline`, `${hall.url.pathname}/present`];
    const sheets = new Set<string>();
    for (const who of [host, new Visitor({ signedOut: true })]) {
      for (const pagePath of pages) {
        const page = await who.open(pagePath);
        const loaded = [
          ...[...page.doc.querySelectorAll("link[href]")].map((el) => el.getAttribute("href")!),
          ...[...page.doc.querySelectorAll("script[src], img[src], source[src], iframe[src], video[src], audio[src]")].map((el) => el.getAttribute("src")!),
        ];
        for (const ref of loaded) {
          const url = new URL(ref, page.url);
          expect(url.origin, `${pagePath} loads ${url.href}`).toBe(base);
        }
        for (const el of page.doc.querySelectorAll('link[rel="stylesheet"][href]')) sheets.add(new URL(el.getAttribute("href")!, page.url).href);
        for (const style of page.doc.querySelectorAll("style")) {
          expect(style.textContent, `${pagePath} has an inline style that loads from elsewhere`).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
        }
      }
    }
    for (const sheet of sheets) {
      const css = await (await fetch(sheet)).text();
      expect(css, `${sheet} loads from elsewhere`).not.toMatch(/url\(\s*["']?(https?:)?\/\/|@import\s+(url\()?\s*["']?(https?:)?\/\//);
    }
  });
});
