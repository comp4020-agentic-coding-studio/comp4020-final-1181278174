import { JSDOM } from "jsdom";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ask, formWithButton, type Page, question, questions, questionsPath, startSession, type Stream, Visitor } from "./visitor.ts";

const tag = (): string => randomBytes(6).toString("hex");
const credentials = (): { username: string; password: string } => ({ username: `t${tag()}`, password: `password-${tag()}` });
const words = (p: Page): string => p.doc.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
const streams: Stream[] = [];
afterEach(() => {
  for (const stream of streams.splice(0)) stream.close();
});

async function watch(who: Visitor, path: string): Promise<Stream> {
  const stream = await who.listen(await who.open(path));
  streams.push(stream);
  expect(stream.status).toBe(200);
  return stream;
}

async function refused(response: Response, path: string): Promise<void> {
  expect(response.status).toBe(401);
  const doc = new JSDOM(await response.text()).window.document;
  expect([...doc.querySelectorAll('[role="alert"]')].some((alert) => alert.textContent?.includes("Sign in to do that."))).toBe(true);
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')];
  expect(links.some((link) => {
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    return url.pathname === "/signin" && url.searchParams.get("return") === path;
  })).toBe(true);
}

describe("accounts over plain HTTP", () => {
  it("counts wrong passwords per browser, so someone else's guesses don't keep the owner out", async () => {
    const owner = new Visitor();
    await owner.open("/");
    const guesser = new Visitor({ signedOut: true });
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const response = await guesser.post("/signin", new URLSearchParams({ username: owner.username, password: `wrong-guess-${i}`, return: "/" }));
      if ((await response.text()).includes("Too many tries")) limited = true;
    }
    expect(limited, "twelve wrong guesses from one browser were never limited").toBe(true);
    const page = await new Visitor({ signedOut: true }).signIn(owner.username, owner.password);
    expect(words(page)).toContain(`Signed in as ${owner.username}`);
  });

  it("ends a page's live stream when its browser signs out, so it no longer counts as here", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Signed out stream ${tag()}`);
    // the host watches: a host is never counted among those here
    const watcher = await host.listen(await host.open(hall.url.pathname));
    streams.push(watcher);
    await watcher.until((board) => board.here === 0);
    const student = new Visitor();
    const theirs = await student.listen(await student.open(hall.url.pathname));
    streams.push(theirs);
    await watcher.until((board) => board.here === 1);
    // only what the stream sends from now on counts
    watcher.forget();
    await student.signOut();
    await watcher.until((board) => board.here === 0);
  });

  it("refuses a common password, and one that contains the username", async () => {
    for (const password of ["password1", "12345678", "Qwerty123"]) {
      const response = await new Visitor({ signedOut: true }).post("/signup", new URLSearchParams({ username: `t${tag()}`, password, return: "/" }));
      expect(response.status, password).toBe(422);
      await response.text();
    }
    const username = `t${tag()}`;
    const response = await new Visitor({ signedOut: true }).post("/signup", new URLSearchParams({ username, password: `my-${username}-pass`, return: "/" }));
    expect(response.status).toBe(422);
    await response.text();
  });

  it("refuses a password longer than 200 characters", async () => {
    const response = await new Visitor({ signedOut: true }).post("/signup", new URLSearchParams({ username: `t${tag()}`, password: "x".repeat(201), return: "/" }));
    expect(response.status).toBe(422);
    await response.text();
  });

  it("signs up, signs out, and signs in again with a plain form and a safe return path", async () => {
    const who = new Visitor({ signedOut: true });
    const account = credentials();
    const formPage = await who.open("/signup?return=%2Fs%2FHAND");
    expect(formPage.status).toBe(200);
    const form = formWithButton(formPage, /create account/i);
    expect(form.querySelector('input[name="username"]')).not.toBeNull();
    expect(form.querySelector('input[name="password"][type="password"]')).not.toBeNull();
    const response = await who.post("/signup", new URLSearchParams({ ...account, return: "/s/HAND" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/s/HAND");
    const cookie = response.headers.getSetCookie().find((line) => line.startsWith("hands_up_signin="));
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Path=\//i);
    expect(cookie).toMatch(/;\s*Max-Age=2592000(?:;|$)/i);
    await response.text();
    expect(who.cookie("hands_up_signin")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(words(await who.open("/s/HAND"))).toContain(`Signed in as ${account.username}`);

    const signout = await who.post("/signout", new URLSearchParams());
    expect(signout.status).toBe(303);
    expect(signout.headers.get("location")).toBe("/");
    await signout.text();
    expect(who.cookie("hands_up_signin")).toBeUndefined();
    expect(words(await who.open("/"))).not.toContain("Signed in as");

    const signin = await who.open("/signin?return=%2Fs%2FHAND");
    const signinForm = formWithButton(signin, /^sign in$/i);
    signinForm.querySelector<HTMLInputElement>('input[name="username"]')!.value = account.username.toUpperCase();
    signinForm.querySelector<HTMLInputElement>('input[name="password"]')!.value = account.password;
    const back = await who.submit(signin, signinForm);
    expect(back.status).toBe(200);
    expect(back.url.pathname).toBe("/s/HAND");
    expect(words(back)).toContain(`Signed in as ${account.username}`);
  });

  it("refuses a wrong password with 422, keeps the username, and never returns the password", async () => {
    const owner = new Visitor();
    await owner.open("/");
    const who = new Visitor({ signedOut: true });
    const wrong = `wrong-${tag()}`;
    const response = await who.post("/signin", new URLSearchParams({ username: owner.username, password: wrong }));
    expect(response.status).toBe(422);
    const html = await response.text();
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector<HTMLInputElement>('input[name="username"]')?.value).toBe(owner.username);
    expect(doc.querySelector<HTMLInputElement>('input[name="password"]')?.value).toBe("");
    expect(html).not.toContain(wrong);
    expect(html).not.toContain(owner.password);
    expect(who.cookie("hands_up_signin")).toBeUndefined();
  });

  it("refuses a taken username in another case and rejects invalid account details", async () => {
    const owner = new Visitor();
    await owner.open("/");
    const who = new Visitor({ signedOut: true });
    for (const [username, password] of [
      [owner.username.toUpperCase(), `different-${tag()}`],
      ["ab", "long-enough"],
      ["a".repeat(31), "long-enough"],
      ["has space", "long-enough"],
      ["has/slash", "long-enough"],
      [`t${tag()}`, "short"],
    ]) {
      const response = await who.post("/signup", new URLSearchParams({ username, password }));
      expect(response.status, username).toBe(422);
      const html = await response.text();
      const doc = new JSDOM(html).window.document;
      expect(doc.querySelector<HTMLInputElement>('input[name="username"]')?.value).toBe(username);
      expect(doc.querySelector<HTMLInputElement>('input[name="password"]')?.value).toBe("");
      expect(html).not.toContain(password);
      expect(who.cookie("hands_up_signin")).toBeUndefined();
    }
    const valid = await who.post("/signup", new URLSearchParams({ username: `T.${tag()}_-`, password: "eight888" }));
    expect(valid.status).toBe(303);
    await valid.text();
  });

  it("only redirects to a path on this site after signup or signin", async () => {
    const account = credentials();
    const who = new Visitor({ signedOut: true });
    const signup = await who.post("/signup", new URLSearchParams({ ...account, return: "//example.com/away" }));
    expect(signup.status).toBe(303);
    expect(signup.headers.get("location")).toBe("/");
    await signup.text();
    for (const path of ["https://example.com/away", "//example.com/away", "/\\example.com/away", "/..//example.com", "/%2e%2e//example.com", "elsewhere", ""]) {
      const signin = await who.post("/signin", new URLSearchParams({ ...account, return: path }));
      expect(signin.status).toBe(303);
      expect(signin.headers.get("location"), path).toBe("/");
      await signin.text();
    }
    for (const path of ["/s/HAND/questions?sort=recent", "/s/HAND?note=你好"]) {
      const signin = await who.post("/signin", new URLSearchParams({ ...account, return: path }));
      expect(signin.status).toBe(303);
      const expected = new URL(path, "http://localhost");
      expect(signin.headers.get("location")).toBe(`${expected.pathname}${expected.search}`);
      await signin.text();
    }
  });

  it("stops further signins for a username after ten failed passwords", async () => {
    const owner = new Visitor();
    await owner.open("/");
    const who = new Visitor({ signedOut: true });
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await who.post("/signin", new URLSearchParams({ username: owner.username, password: `wrong-${attempt}` }));
      expect(response.status).toBe(422);
      await response.text();
    }
    const blocked = await who.post("/signin", new URLSearchParams({ username: owner.username.toUpperCase(), password: owner.password }));
    expect(blocked.status).toBe(422);
    const doc = new JSDOM(await blocked.text()).window.document;
    expect(doc.querySelector('[role="alert"]')?.textContent).toMatch(/try again|wait|too many/i);
    expect(who.cookie("hands_up_signin")).toBeUndefined();
  });

  it("signout is POST only and an ended token cannot be used again", async () => {
    const owner = new Visitor();
    await owner.open("/");
    const oldToken = owner.cookie("hands_up_signin")!;
    const browser = owner.cookie("hands_up_person")!;
    expect((await owner.open("/signout")).status).toBe(405);
    expect(words(await owner.open("/"))).toContain(`Signed in as ${owner.username}`);
    expect((await owner.signOut()).status).toBe(200);
    expect(owner.cookie("hands_up_person")).toBe(browser);
    expect(owner.cookie("hands_up_signin")).toBeUndefined();
    expect(words(await owner.open("/"))).not.toContain("Signed in as");

    const replay = new Visitor({ signedOut: true, cookies: { hands_up_person: browser, hands_up_signin: oldToken } });
    const hall = await replay.open("/s/HAND");
    expect(words(hall)).not.toContain("Signed in as");
    expect(() => formWithButton(hall, /i'm lost/i)).toThrow();
    await refused(await replay.post("/s/HAND", new URLSearchParams({ intent: "hand", up: "1" })), "/s/HAND");
  });

  it("keeps pages public, hides write forms when signed out, and refuses every write without changing the session", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Public ${tag()}`);
    const path = hall.url.pathname;
    const asking = questionsPath(hall);
    const body = `Keep this question ${tag()}`;
    const asker = new Visitor();
    await ask(asker, asking, body);
    const before = await host.open(asking);
    const id = question(before, body)!.id;
    const stranger = new Visitor({ signedOut: true });
    for (const route of ["/", path, asking, `${path}/timeline`, `${path}/present`]) {
      const page = await stranger.open(route);
      expect(page.status).toBe(200);
      expect(words(page)).not.toContain(host.username);
      expect(words(page)).not.toContain(asker.username);
      for (const name of [/i'm lost/i, /^ask/i, /me too/i, /^start a session$/i, /^going over it$/i, /^mark$/i, /^answered$/i, /^hide$/i, /^save$/i]) {
        expect(() => formWithButton(page, name), `${route} shows a ${name} form`).toThrow();
      }
    }
    const publicHall = await stranger.open(path);
    expect(words(publicHall)).toContain("Sign in to raise your hand");
    for (const destination of ["/signin", "/signup"]) {
      expect([...publicHall.doc.querySelectorAll<HTMLAnchorElement>("a[href]")].some((link) => {
        const url = new URL(link.getAttribute("href")!, publicHall.url);
        return url.pathname === destination && url.searchParams.get("return") === path;
      })).toBe(true);
    }
    const publicQuestions = await stranger.open(asking);
    expect(words(publicQuestions)).toContain(body);
    expect(publicQuestions.doc.querySelector('[aria-label="Questions"]')?.textContent).toMatch(/0\s*Me too|Me too\s*0/i);
    const stream = await watch(stranger, path);
    await stream.until((board) => board.here === 0 && board.hands.length === 0 && board.questions.length === 1);

    const writes: [string, Record<string, string>][] = [
      ["/", { title: `Cannot start ${tag()}` }],
      [path, { intent: "hand", up: "1" }],
      [path, { intent: "hand", up: "0" }],
      [path, { intent: "vote", question: String(id), want: "1" }],
      [path, { intent: "going-over" }],
      [path, { intent: "timeline_mark", label: "Must not be marked" }],
      [path, { intent: "state", question: String(id), to: "answered" }],
      [path, { intent: "state", question: String(id), to: "hidden" }],
      [`${asking}?sort=recent`, { intent: "ask", body: "Must not be asked" }],
      [asking, { intent: "vote", question: String(id), want: "1" }],
      [asking, { intent: "state", question: String(id), to: "answered" }],
      [asking, { intent: "state", question: String(id), to: "hidden" }],
      [asking, { intent: "report", question: String(id) }],
      [`${path}/timeline`, { intent: "timeline_mark", label: "Must not be marked" }],
      [`${path}/timeline`, { intent: "recording", at: "10:00" }],
    ];
    for (const [route, data] of writes) await refused(await stranger.post(route, new URLSearchParams(data)), route);
    const after = await host.open(asking);
    expect(questions(after).map((q) => [q.id, q.votes])).toEqual([[id, 0]]);
    expect(question(after, body)?.button(/^answered/i)).toBeDefined();
    expect(question(after, body)?.button(/^hide/i)).toBeDefined();
    expect(words(await host.open(path))).not.toContain("Must not be marked");
    const timeline = await host.open(`${path}/timeline`);
    expect(timeline.doc.querySelector<HTMLInputElement>('input[name="at"]')?.value).toBe("");
    expect(words(timeline)).not.toContain("Must not be marked");
    const fresh = await watch(stranger, path);
    const unchanged = await fresh.until(() => true);
    expect(unchanged.board).toEqual({ here: 0, hands: [], questions: [[id, 0, "open"]], goingOver: null });
  });

  it("the same account has its host controls and sessions in a second browser", async () => {
    const host = new Visitor();
    const title = `Across browsers ${tag()}`;
    const hall = await startSession(host, title);
    const path = hall.url.pathname;
    const asking = questionsPath(hall);
    const body = `For the host ${tag()}`;
    await ask(new Visitor(), asking, body);
    const other = new Visitor();
    expect((await other.signIn(host.username, host.password)).status).toBe(200);
    expect(other.cookie("hands_up_person")).not.toBe(host.cookie("hands_up_person"));
    expect(other.cookie("hands_up_signin")).not.toBe(host.cookie("hands_up_signin"));
    for (const who of [host, other]) {
      expect(words(await who.open("/"))).toContain(title);
      const page = await who.open(path);
      expect(formWithButton(page, /^going over it$/i)).toBeDefined();
      expect(formWithButton(page, /^mark$/i)).toBeDefined();
      const posted = question(await who.open(asking), body)!;
      expect(posted.button(/^answered/i)).toBeDefined();
      expect(posted.button(/^hide/i)).toBeDefined();
      expect(formWithButton(await who.open(`${path}/timeline`), /^save$/i)).toBeDefined();
      const stream = await watch(who, path);
      await stream.until((board) => board.here === 0);
    }
    await other.signOut();
    const signedOut = await other.open(path);
    expect(() => formWithButton(signedOut, /^going over it$/i)).toThrow();
    const stillHost = await host.open(path);
    expect(formWithButton(stillHost, /^going over it$/i)).toBeDefined();
  });

  it("counts one hand and one person for the same account in two browsers", async () => {
    const hall = await startSession(new Visitor(), `One hand ${tag()}`);
    const path = hall.url.pathname;
    const first = new Visitor();
    const firstPage = await first.open(path);
    const second = new Visitor();
    expect((await second.signIn(first.username, first.password)).status).toBe(200);
    const secondPage = await second.open(path);
    const firstStream = await watch(first, path);
    const secondStream = await watch(second, path);
    await secondStream.until((board) => board.here === 1 && board.hands.length === 0);
    // Both forms were read before either press, so both request a raised hand.
    const results = await Promise.all([
      first.submit(firstPage, formWithButton(firstPage, /i'm lost/i)),
      second.submit(secondPage, formWithButton(secondPage, /i'm lost/i)),
    ]);
    for (const page of results) expect(page.status).toBe(200);
    for (const stream of [firstStream, secondStream]) await stream.until((board) => board.here === 1 && board.hands.length === 1);
    for (const who of [first, second]) {
      const page = await who.open(path);
      expect(words(page)).toContain("1 of 1 here says they're lost");
      expect(formWithButton(page, /i'm lost/i).querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("a signed-out page watching the stream never adds to here", async () => {
    const hall = await startSession(new Visitor(), `Watching ${tag()}`);
    const path = hall.url.pathname;
    const anonymous = new Visitor({ signedOut: true });
    const publicStream = await watch(anonymous, path);
    await publicStream.until((board) => board.here === 0);
    const studentStream = await watch(new Visitor(), path);
    await studentStream.until((board) => board.here === 1);
    const another = await watch(new Visitor({ signedOut: true }), path);
    await another.until((board) => board.here === 1);
    publicStream.forget();
    studentStream.close();
    await publicStream.until((board) => board.here === 0, 2000);
  });
});
