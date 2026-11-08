import { describe, expect, it } from "vitest";
import { type Page, startSession, Visitor } from "./visitor.ts";

// The home page lists the sessions this browser started, so a lecturer can
// come back to a lecture's timeline. A host is the browser's cookie, so each
// browser sees only its own.
const tag = (): string => Math.random().toString(36).slice(2, 8);

/** The titles listed as sessions this browser started, top to bottom. */
const hosted = (p: Page): string[] =>
  [...p.doc.querySelectorAll('[aria-label="Sessions you started"] > li')].map((li) => li.querySelector(".hosted-title")?.textContent?.trim() ?? "");

describe("the home page", () => {
  it("lists the sessions this browser started, newest first, and nobody else's", async () => {
    const lecturer = new Visitor();
    const other = new Visitor();
    const t = tag();
    await startSession(lecturer, `Older ${t}`);
    await startSession(other, `Someone else's ${t}`);
    await startSession(lecturer, `Newer ${t}`);

    const mine = hosted(await lecturer.open("/")).filter((title) => title.includes(t));
    expect(mine).toEqual([`Newer ${t}`, `Older ${t}`]);
    expect(hosted(await other.open("/")).filter((title) => title.includes(t))).toEqual([`Someone else's ${t}`]);
    expect(hosted(await new Visitor().open("/"))).toEqual([]);
  });

  it("links each listed session to its hall and its timeline", async () => {
    const lecturer = new Visitor();
    const title = `Linked ${tag()}`;
    const hall = await startSession(lecturer, title);
    const home = await lecturer.open("/");
    const item = [...home.doc.querySelectorAll('[aria-label="Sessions you started"] > li')].find((li) => li.textContent?.includes(title))!;
    const links = [...item.querySelectorAll("a")].map((a) => new URL(a.getAttribute("href")!, home.url).pathname);
    expect(links).toEqual([hall.url.pathname, `${hall.url.pathname}/timeline`]);
    for (const path of links) expect((await lecturer.open(path)).status).toBe(200);
  });
});
