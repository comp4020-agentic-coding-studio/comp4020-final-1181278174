import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { startSession, Visitor } from "./visitor.ts";

// Your account, over plain HTTP: changing the password and signing out
// everywhere else, from one browser, while a second browser of the same
// account has a session page open.
const said = (html: string): string =>
  [...new JSDOM(html).window.document.querySelectorAll('[role="alert"], [role="status"]')].map((p) => p.textContent?.trim()).join("\n");

/** The same account, signed in on a second browser, with a session page open. */
async function secondBrowser(owner: Visitor) {
  const host = new Visitor();
  const hall = await startSession(host, `Account ${Date.now() % 100000}`);
  // the host watches: a host is never counted among those here
  const watcher = await host.listen(await host.open(hall.url.pathname));
  const other = new Visitor({ signedOut: true });
  expect((await other.signIn(owner.username, owner.password)).status).toBe(200);
  await other.listen(await other.open(hall.url.pathname));
  await watcher.until((board) => board.here === 1);
  return { other, watcher };
}

async function post(who: Visitor, fields: Record<string, string>): Promise<Response> {
  return who.post("/account", new URLSearchParams(fields));
}

describe("your account", () => {
  it("sends a signed-out browser to sign in first", async () => {
    const response = await new Visitor({ signedOut: true }).post("/account", new URLSearchParams({ intent: "elsewhere" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/signin?return=%2Faccount");
  });

  it("changes the password, signs out every other browser and keeps this one", async () => {
    const owner = new Visitor();
    await owner.open("/");
    const { other, watcher } = await secondBrowser(owner);
    watcher.forget();
    const next = `another long one ${Date.now()}`;
    const done = await post(owner, { intent: "password", current: owner.password, password: next });
    expect(done.status).toBe(303);
    await done.text();
    // the other browser's page stops counting, and its next page is signed out
    await watcher.until((board) => board.here === 0);
    expect((await other.open("/account")).url.pathname).toBe("/signin");
    const page = await owner.open(done.headers.get("location")!);
    expect(page.url.pathname).toBe("/account");
    expect(said(page.html)).toContain("Your password is changed. 1 other browser signed out.");
    // the old password no longer signs in; the new one does
    const old = await new Visitor({ signedOut: true }).signIn(owner.username, owner.password);
    expect(old.status).toBe(422);
    expect((await new Visitor({ signedOut: true }).signIn(owner.username, next)).status).toBe(200);
  });

  it("signs out everywhere else, and not here", async () => {
    const owner = new Visitor();
    await owner.open("/");
    const { other, watcher } = await secondBrowser(owner);
    watcher.forget();
    const done = await post(owner, { intent: "elsewhere" });
    expect(done.status).toBe(303);
    await done.text();
    await watcher.until((board) => board.here === 0);
    expect((await other.open("/account")).url.pathname).toBe("/signin");
    const page = await owner.open(done.headers.get("location")!);
    expect(page.url.pathname).toBe("/account");
    expect(said(page.html)).toContain("Signed out of 1 other browser.");
  });

  it("lets one of two changes made at once win, and keeps that browser signed in", async () => {
    const owner = new Visitor();
    await owner.open("/");
    const other = new Visitor({ signedOut: true });
    expect((await other.signIn(owner.username, owner.password)).status).toBe(200);
    const [mine, theirs] = [`mine is long enough ${Date.now()}`, `theirs is long enough ${Date.now()}`];
    const answers = await Promise.all([
      post(owner, { intent: "password", current: owner.password, password: mine }),
      post(other, { intent: "password", current: owner.password, password: theirs }),
    ]);
    for (const answer of answers) await answer.text();
    const statuses = answers.map((a) => a.status).sort();
    expect(statuses, "one change wins, the other is refused").toEqual([303, 422]);
    const [winner, winning] = answers[0].status === 303 ? [owner, mine] : [other, theirs];
    const losing = winning === mine ? theirs : mine;
    expect((await winner.open("/account")).url.pathname, "the winner stays signed in").toBe("/account");
    expect((await new Visitor({ signedOut: true }).signIn(owner.username, winning)).status).toBe(200);
    expect((await new Visitor({ signedOut: true }).signIn(owner.username, losing)).status).toBe(422);
  });

  it("refuses a wrong current password or a weak new one, and sends no password back", async () => {
    const owner = new Visitor();
    await owner.open("/");
    for (const [fields, message] of [
      [{ current: "not the password at all", password: "a brand new password" }, "Your current password is wrong."],
      [{ current: owner.password, password: "short" }, "Use at least 8 characters for your password."],
      [{ current: owner.password, password: "password123" }, "Choose a password that isn't a common one and doesn't contain your username."],
    ] as const) {
      const refused = await post(owner, { intent: "password", ...fields });
      expect(refused.status).toBe(422);
      const html = await refused.text();
      expect(said(html)).toContain(message);
      for (const value of Object.values(fields)) expect(html).not.toContain(value);
    }
    // still signed in, and the password is unchanged
    expect((await owner.open("/account")).url.pathname).toBe("/account");
    expect((await new Visitor({ signedOut: true }).signIn(owner.username, owner.password)).status).toBe(200);
  });
});
