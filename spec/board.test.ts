import { describe, expect, it } from "vitest";
import {
  ask,
  fill,
  formWithButton,
  meToo,
  question,
  questions,
  startSession,
  Visitor,
} from "./visitor.ts";

// The promises PLAN.md makes for the board, checked over HTTP against the
// running app. Each test starts its own session and never writes to HAND,
// so they can run against a fresh container or a local server. They are not
// for the live app: they write.
const CODE = /^[2-9A-HJKMNP-Z]{4}$/;
const tag = (): string => Math.random().toString(36).slice(2, 8);

const codeOf = (url: URL): string => url.pathname.split("/").filter(Boolean).pop() ?? "";

describe("a session", () => {
  it("starts with a four-character code, and anyone can join with it in any case", async () => {
    const host = new Visitor();
    const title = `Week 9 lecture ${tag()}`;
    const session = await startSession(host, title);
    expect(session.status).toBe(200);
    const code = codeOf(session.url);
    expect(code).toMatch(CODE);
    expect(session.doc.body.textContent).toContain(code);
    expect(session.doc.body.textContent).toContain(title);

    const guest = new Visitor();
    const home = await guest.open("/");
    const join = formWithButton(home, /join/i);
    fill(join, code.toLowerCase());
    const joined = await guest.submit(home, join);
    expect(joined.status).toBe(200);
    expect(joined.url.pathname).toBe(session.url.pathname);
    expect(joined.doc.body.textContent).toContain(title);
  });

  it("an unknown code is a 404 that offers the join box again", async () => {
    const guest = new Visitor();
    const home = await guest.open("/");
    const join = formWithButton(home, /join/i);
    fill(join, "zzzz");
    const missed = await guest.submit(home, join);
    expect(missed.status).toBe(404);
    expect(() => formWithButton(missed, /join/i)).not.toThrow();
  });

  it("the home page links to HAND, and HAND is open for questions", async () => {
    const guest = new Visitor();
    const home = await guest.open("/");
    const link = [...home.doc.querySelectorAll("a")].find((a) => a.textContent?.includes("HAND"));
    expect(link, "no link to HAND on the home page").toBeDefined();
    const hand = await guest.open(new URL(link!.getAttribute("href")!, home.url));
    expect(hand.status).toBe(200);
    expect(codeOf(hand.url)).toBe("HAND");
    expect(() => formWithButton(hand, /^ask/i)).not.toThrow();
  });
});

describe("asking", () => {
  it("a question stays: a stranger sees it, and the asker finds it marked theirs on coming back", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Crit ${tag()}`)).url.pathname;
    const asker = new Visitor();
    const body = `Why server-sent events and not WebSockets? ${tag()}`;
    await ask(asker, path, body);

    const stranger = await new Visitor().open(path);
    expect(question(stranger, body), "a stranger can't see the question").toBeDefined();
    expect(question(stranger, body)!.yours).toBe(false);
    expect(question(await host.open(path), body)!.yours).toBe(false);

    const back = await asker.open(path);
    expect(question(back, body), "the asker can't find their question").toBeDefined();
    expect(question(back, body)!.yours).toBe(true);
  });

  it("nothing sent to anyone else carries who asked, the host included", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Crit ${tag()}`)).url.pathname;
    const asker = new Visitor();
    await asker.open("/");
    expect(asker.secrets, "the app gave the asker no id to tell them apart").not.toEqual([]);
    await ask(asker, path, `Who is this for? ${tag()}`);

    for (const viewer of [host, new Visitor()]) {
      const html = (await viewer.open(path)).html;
      for (const secret of asker.secrets) expect(html).not.toContain(secret);
    }
  });

  it("refuses an empty question and one over 240 characters, and takes 240 Chinese characters", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Limits ${tag()}`)).url.pathname;
    const asker = new Visitor();

    const empty = await ask(asker, path, "   ");
    expect(empty.status).toBe(422);
    expect(questions(empty)).toEqual([]);

    const t = tag();
    const long = `${t}${"x".repeat(241 - t.length)}`;
    const tooLong = await ask(asker, path, long);
    expect(tooLong.status).toBe(422);
    expect(tooLong.doc.querySelector("textarea")?.value, "the text typed was thrown away").toBe(long);
    expect(question(tooLong, long)).toBeUndefined();

    const full = `${"问".repeat(240 - t.length)}${t}`;
    expect([...full].length).toBe(240);
    const taken = await ask(asker, path, full);
    expect(taken.status).toBe(200);
    expect(question(taken, full)).toBeDefined();
  });
});

describe("voting", () => {
  it("counts one vote per person, even sent twice at once, and can take it back", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Votes ${tag()}`)).url.pathname;
    const body = `Can it run a whole lecture theatre? ${tag()}`;
    await ask(new Visitor(), path, body);

    const first = new Visitor();
    const page = await first.open(path);
    const q = question(page, body)!;
    expect(q.votes).toBe(0);
    expect(q.pressed).toBe(false);
    await Promise.all([
      first.submit(page, q.meToo.closest("form")!, q.meToo),
      first.submit(page, q.meToo.closest("form")!, q.meToo),
    ]);
    const once = question(await first.open(path), body)!;
    expect(once.votes).toBe(1);
    expect(once.pressed).toBe(true);

    const second = new Visitor();
    expect(question(await meToo(second, path, body), body)!.votes).toBe(2);

    const back = question(await meToo(first, path, body), body)!;
    expect(back.votes).toBe(1);
    expect(back.pressed).toBe(false);
  });

  it("Popular puts the most votes first; Recent puts the newest first", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Order ${tag()}`)).url.pathname;
    const [a, b, c] = ["first", "second", "third"].map((n) => `The ${n} question ${tag()}`);
    const asker = new Visitor();
    for (const body of [a, b, c]) await ask(asker, path, body);
    await meToo(new Visitor(), path, b);
    await meToo(new Visitor(), path, b);
    await meToo(new Visitor(), path, c);

    const order = (texts: string[]) =>
      texts.map((t) => [a, b, c].find((body) => t.includes(body)));

    const popular = await host.open(path);
    expect(order(questions(popular).map((q) => q.text))).toEqual([b, c, a]);

    const recentLink = [...popular.doc.querySelectorAll("a")].find((l) => l.textContent?.trim() === "Recent");
    expect(recentLink, "no Recent link").toBeDefined();
    const recent = await host.open(new URL(recentLink!.getAttribute("href")!, popular.url));
    expect(order(questions(recent).map((q) => q.text))).toEqual([c, b, a]);
  });
});
