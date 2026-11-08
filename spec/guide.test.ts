import { describe, expect, it } from "vitest";
import { formWithButton, type Page, startSession, Visitor } from "./visitor.ts";

// These visitors execute no script: the guide and every way to dismiss or
// reopen it must work using the server's HTML and ordinary forms alone.
const words = (element: Element | null): string => element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const tag = (): string => Math.random().toString(36).slice(2, 8);
const firstVisitLine = "Seats and hands are placed at random on each screen.";

function guide(page: Page, role: "Student" | "Host" = "Student"): Element | undefined {
  return [...page.doc.querySelectorAll("section")].find((section) => {
    const label = section.getAttribute("aria-label");
    const labelledBy = section.getAttribute("aria-labelledby");
    return label === `${role} guide` || words(labelledBy ? page.doc.getElementById(labelledBy) : null) === `${role} guide`;
  });
}

/** Send exactly what the selected ordinary form submits, retaining the 303. */
async function postForm(who: Visitor, page: Page, buttonName: RegExp): Promise<Response> {
  const form = formWithButton(page, buttonName);
  expect(form.method.toLowerCase()).toBe("post");
  const button = [...form.querySelectorAll("button")].find((candidate) => buttonName.test(words(candidate)))!;
  const fields = new URLSearchParams();
  for (const input of form.querySelectorAll<HTMLInputElement>("input")) {
    if (input.name && !input.disabled) fields.append(input.name, input.value);
  }
  if (button.name) fields.append(button.name, button.value);
  const action = new URL(form.getAttribute("action") ?? "", page.url);
  expect(action.pathname).toBe(page.url.pathname);
  return who.post(action, fields);
}

async function dismiss(who: Visitor, page: Page, buttonName = /^Got it$/i): Promise<Page> {
  const response = await postForm(who, page, buttonName);
  expect(response.status).toBe(303);
  const destination = new URL(response.headers.get("location")!, page.url);
  expect(destination.pathname).toBe(page.url.pathname);
  expect(destination.search).toBe(page.url.search);
  await response.text();
  return who.open(destination);
}

function promises(page: Page): void {
  const main = words(page.doc.querySelector("main"));
  expect(main).toMatch(/No one, the host included, is shown whose hand is up\./);
  expect(main).toContain("doesn't mean everyone follows");
  expect(page.doc.querySelector("[data-lost]")?.closest("[hidden]")).toBeNull();
}

describe("the first-visit guide", () => {
  it("renders five student steps on the server, with a working hand outside the guide", async () => {
    const hall = await startSession(new Visitor(), `Student guide ${tag()}`);
    const student = new Visitor();
    const page = await student.open(hall.url.pathname);
    const card = guide(page);
    expect(card).toBeDefined();
    expect(card!.querySelectorAll("ol > li")).toHaveLength(5);
    const copy = words(card!);
    for (const phrase of ["I'm lost", "No words", "no name", "never whose", "comes down", "Me too", "Pop out"]) {
      expect(copy.toLowerCase()).toContain(phrase.toLowerCase());
    }
    expect(card!.closest('dialog, [role="dialog"], [aria-modal="true"], [hidden], [inert]')).toBeNull();
    expect(words(page.doc.querySelector("main"))).toContain(firstVisitLine);
    const hand = formWithButton(page, /^I'm lost$/i);
    const button = hand.querySelector<HTMLButtonElement>("button")!;
    expect(button.disabled).toBe(false);
    expect(hand.closest('dialog, [role="dialog"], [inert], [hidden]')).toBeNull();
    expect(card!.contains(hand)).toBe(false);
    expect(hand.compareDocumentPosition(card!) & 4, "the hand comes before the guide").toBeTruthy();
    expect((await student.submit(page, hand)).status).toBe(200);
    expect(formWithButton(await student.open(hall.url.pathname), /^I'm lost$/i).querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("gives a host their own five steps without a student hand", async () => {
    const host = new Visitor();
    const page = await startSession(host, `Host guide ${tag()}`, { started: false });
    const card = guide(page, "Host");
    expect(card).toBeDefined();
    expect(guide(page)).toBeUndefined();
    expect(card!.querySelectorAll("ol > li")).toHaveLength(5);
    const copy = words(card!);
    for (const phrase of ["Start class", "projector", "Going over it", "mark", "timeline", "after class", "End class"]) {
      expect(copy.toLowerCase()).toContain(phrase.toLowerCase());
    }
    expect(() => formWithButton(page, /^I'm lost$/i)).toThrow();
    expect(formWithButton(page, /^Start class$/i).querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
    await dismiss(host, page, /^Skip$/i);
    expect(guide(await host.open(page.url.pathname), "Host")).toBeUndefined();
    // Teaching once does not skip the different guide when this person joins a class.
    const otherHall = await startSession(new Visitor(), `A different host ${tag()}`);
    expect(guide(await host.open(otherHall.url.pathname))).toBeDefined();
  });

  it("Got it remembers an account across browsers and removes first-visit text", async () => {
    const hall = await startSession(new Visitor(), `Remember account ${tag()}`);
    const student = new Visitor();
    const first = await student.open(`${hall.url.pathname}?from=class`);
    expect(guide(first)).toBeDefined();
    await dismiss(student, first);
    const again = await student.open(hall.url.pathname);
    expect(guide(again)).toBeUndefined();
    expect(words(again.doc.querySelector("main"))).not.toContain(firstVisitLine);
    const otherBrowser = new Visitor({ signedOut: true });
    expect((await otherBrowser.signIn(student.username, student.password)).status).toBe(200);
    const elsewhere = await otherBrowser.open(hall.url.pathname);
    expect(guide(elsewhere)).toBeUndefined();
    expect(words(elsewhere.doc.querySelector("main"))).not.toContain(firstVisitLine);
    expect(guide(await new Visitor().open(hall.url.pathname))).toBeDefined();
  });

  it.each(["Got it", "Skip"])("%s remembers a signed-out browser, without affecting another browser or its later account", async (label) => {
    const hall = await startSession(new Visitor(), `Remember browser ${tag()}`);
    const browser = new Visitor({ signedOut: true });
    const page = await browser.open(hall.url.pathname);
    expect(guide(page)).toBeDefined();
    expect(words(page.doc.querySelector("main"))).toContain("Sign in to raise your hand");
    await dismiss(browser, page, new RegExp(`^${label}$`, "i"));
    const again = await browser.open(hall.url.pathname);
    expect(guide(again)).toBeUndefined();
    expect(words(again.doc.querySelector("main"))).not.toContain(firstVisitLine);
    expect(guide(await new Visitor({ signedOut: true }).open(hall.url.pathname))).toBeDefined();
    const account = new Visitor();
    await account.open("/");
    await browser.signIn(account.username, account.password);
    expect(guide(await browser.open(hall.url.pathname))).toBeDefined();
  });

  it.each([false, true])("How it works can show the guide again and restore it to the hall (signed out: %s)", async (signedOut) => {
    const hall = await startSession(new Visitor(), `Replay ${tag()}`);
    const who = new Visitor({ signedOut });
    await dismiss(who, await who.open(hall.url.pathname));
    const help = await who.open("/help");
    const link = [...help.doc.querySelectorAll<HTMLAnchorElement>("a[href]")].find((a) => words(a) === "Show the guide again");
    expect(link).toBeDefined();
    const reopened = await who.open(new URL(link!.getAttribute("href")!, help.url));
    expect(guide(reopened)).toBeDefined();
    // Following a link displays the guide but does not change saved preferences.
    expect(guide(await who.open(hall.url.pathname))).toBeUndefined();
    await dismiss(who, reopened, /^Show on my next visit$/i);
    const nextVisit = await who.open(hall.url.pathname);
    expect(guide(nextVisit)).toBeDefined();
    expect(words(nextVisit.doc.querySelector("main"))).toContain(firstVisitLine);
  });

  it("keeps privacy, silence and counts with their denominator after every guide is done", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Promises after guide ${tag()}`);
    await dismiss(host, hall);
    const student = new Visitor();
    const guest = new Visitor({ signedOut: true });
    for (const who of [student, guest]) await dismiss(who, await who.open(hall.url.pathname));
    for (const who of [student, host, guest]) promises(await who.open(hall.url.pathname));
    const before = await student.open(hall.url.pathname);
    expect(words(before.doc.querySelector("[data-lost]"))).toBe("1 here. No hands up right now.");
    const raised = await student.submit(before, formWithButton(before, /^I'm lost$/i));
    for (const who of [student, host, guest]) {
      const after = who === student ? raised : await who.open(hall.url.pathname);
      promises(after);
      expect(words(after.doc.querySelector("[data-lost]"))).toBe("1 of 1 here says they're lost");
      expect(guide(after, who === host ? "Host" : "Student")).toBeUndefined();
    }
    expect(words(raised.doc.querySelector("[data-hand-note]"))).toMatch(/comes down by itself at \d\d:\d\d/);
  });

  it("refuses a malformed guide action and leaves the guide visible", async () => {
    const hall = await startSession(new Visitor(), `Invalid guide action ${tag()}`);
    for (const who of [new Visitor(), new Visitor({ signedOut: true })]) {
      const response = await who.post(hall.url.pathname, new URLSearchParams({ intent: "guide", guide_action: "not-an-action" }));
      expect(response.status).toBe(422);
      await response.text();
      expect(guide(await who.open(hall.url.pathname))).toBeDefined();
    }
  });

  it("does not finish a guide for a session that does not exist", async () => {
    const who = new Visitor({ signedOut: true });
    const response = await who.post("/s/0000", new URLSearchParams({ intent: "guide", guide_action: "finish" }));
    expect(response.status).toBe(404);
    await response.text();
    expect(guide(await who.open("/s/HAND"))).toBeDefined();
  });

  it("removes the host's first-visit notes from the hall, header, questions and home", async () => {
    const host = new Visitor();
    const page = await startSession(host, `Host notes ${tag()}`);
    const notes = [firstVisitLine, "You teach: you have no hand here, and you aren't counted.", "Shows on every screen for 2 minutes."];
    for (const note of notes) expect(words(page.doc.querySelector("main"))).toContain(note);
    expect(words(page.doc.querySelector("header"))).toContain("projector page");
    expect(words((await host.open("/")).doc.querySelector("main"))).toContain("Sign in on any device to find your sessions here.");
    await dismiss(host, page);
    const again = await host.open(page.url.pathname);
    for (const note of notes) expect(words(again.doc.querySelector("main"))).not.toContain(note);
    expect(words(again.doc.querySelector("header"))).toContain("You're hosting.");
    for (const pageAfter of [again, await host.open(`${page.url.pathname}/questions`)]) {
      const header = pageAfter.doc.querySelector("header")!;
      expect(words(header)).not.toContain("Open the projector page.");
      expect(header.querySelector(`a[href="${page.url.pathname}/present"]`), "the host keeps the projector link").not.toBeNull();
    }
    expect(words((await host.open("/")).doc.querySelector("main"))).not.toContain("Sign in on any device to find your sessions here.");
    // Useful controls remain labelled after their first-use explanation goes.
    expect(formWithButton(again, /^Going over it$/i)).toBeDefined();
    expect(formWithButton(again, /^Mark$/i)).toBeDefined();
    expect(formWithButton(again, /^End class$/i)).toBeDefined();
    expect([...again.doc.querySelectorAll("a")].some((link) => words(link) === "Open projector page")).toBe(true);
  });

  it("removes the student's repeated projector explanation from both session pages", async () => {
    const hall = await startSession(new Visitor(), `Student notes ${tag()}`);
    const student = new Visitor();
    const paths = [hall.url.pathname, `${hall.url.pathname}/questions`];
    for (const path of paths) expect(words((await student.open(path)).doc.querySelector("main"))).toContain("For the screen at the front.");
    await dismiss(student, await student.open(hall.url.pathname));
    for (const path of paths) {
      const page = await student.open(path);
      expect(words(page.doc.querySelector("main"))).not.toContain("For the screen at the front.");
      expect([...page.doc.querySelectorAll("main a")].some((link) => words(link) === "Projector page")).toBe(true);
    }
  });

  it("reopens the host guide without resetting this account's student guide", async () => {
    const host = new Visitor();
    const own = await startSession(host, `Host replay ${tag()}`);
    const other = await startSession(new Visitor(), `Student guide stays done ${tag()}`);
    await dismiss(host, await host.open(other.url.pathname));
    await dismiss(host, own);
    const help = await host.open("/help");
    const link = [...help.doc.querySelectorAll<HTMLAnchorElement>("a[href]")].find((a) => words(a) === "Show the host guide again");
    expect(link).toBeDefined();
    const preview = await host.open(new URL(link!.getAttribute("href")!, help.url));
    expect(guide(preview, "Host")).toBeDefined();
    expect(guide(await host.open(own.url.pathname), "Host")).toBeUndefined();
    await dismiss(host, preview, /^Show on my next visit$/i);
    expect(guide(await host.open(own.url.pathname), "Host")).toBeDefined();
    expect(guide(await host.open(other.url.pathname))).toBeUndefined();
    // Finishing a preview also remembers it, and leaves the replay view.
    const response = await postForm(host, await host.open(preview.url), /^Got it$/i);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/help");
    await response.text();
    expect(guide(await host.open(own.url.pathname), "Host")).toBeUndefined();
  });

  it("uses a plain preference cookie only for signed-out completion, as Privacy and rules says", async () => {
    const hall = await startSession(new Visitor(), `Guide cookie ${tag()}`);
    const guest = new Visitor({ signedOut: true });
    const first = await guest.open(hall.url.pathname);
    expect(guest.cookie("hands_up_guide")).toBeUndefined();
    const finished = await postForm(guest, first, /^Got it$/i);
    expect(finished.status).toBe(303);
    const cookie = finished.headers.getSetCookie().find((line) => line.startsWith("hands_up_guide="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/^hands_up_guide=student;/);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Path=\/(?:;|$)/i);
    expect(cookie).toMatch(/;\s*Max-Age=31536000(?:;|$)/i);
    await finished.text();

    const account = new Visitor();
    const saved = await postForm(account, await account.open(hall.url.pathname), /^Skip$/i);
    expect(saved.status).toBe(303);
    expect(saved.headers.getSetCookie().some((line) => line.startsWith("hands_up_guide="))).toBe(false);
    expect(account.cookie("hands_up_guide")).toBeUndefined();
    await saved.text();
    const privacy = words((await guest.open("/privacy")).doc.querySelector("main"));
    expect(privacy).toContain("your account remembers when you finish or skip the student and host guides");
    expect(privacy).toContain("while signed out adds a cookie for a year");
    expect(privacy).toContain("with no account details");
  });

  it.each([
    { label: "Got it", signedOut: false },
    { label: "Skip", signedOut: true },
  ])("$label on How it works closes the preview and remembers the student guide", async ({ label, signedOut }) => {
    const hall = await startSession(new Visitor(), `Finish preview ${tag()}`);
    const who = new Visitor({ signedOut });
    expect(guide(await who.open(hall.url.pathname))).toBeDefined();
    const preview = await who.open("/help?guide=student#guide");
    expect(guide(preview)).toBeDefined();
    const response = await postForm(who, preview, new RegExp(`^${label}$`, "i"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/help");
    await response.text();
    expect(guide(await who.open("/help"))).toBeUndefined();
    expect(guide(await who.open(hall.url.pathname))).toBeUndefined();
  });

  it("refuses unknown help guide roles and actions without finishing either guide", async () => {
    const hall = await startSession(new Visitor(), `Invalid help guide ${tag()}`);
    for (const who of [new Visitor(), new Visitor({ signedOut: true })]) {
      for (const [path, data] of [
        ["/help?guide=unknown", { intent: "guide", guide_action: "finish" }],
        ["/help", { intent: "guide", guide_action: "finish" }],
        ["/help?guide=student", { intent: "unknown", guide_action: "finish" }],
        ["/help?guide=student", { intent: "guide", guide_action: "unknown" }],
      ] as const) {
        const response = await who.post(path, new URLSearchParams(data));
        expect(response.status, path).toBe(422);
        expect(await response.text()).toContain('role="alert"');
      }
      expect(guide(await who.open(hall.url.pathname))).toBeDefined();
    }
  });

  it("takes the hall guide's role from the session, ignoring a forged host role", async () => {
    const hall = await startSession(new Visitor(), `Guide role ${tag()}`);
    const student = new Visitor();
    const response = await student.post(`${hall.url.pathname}?guide=host`, new URLSearchParams({
      intent: "guide", guide_action: "finish", role: "host", guide_role: "host",
    }));
    expect(response.status).toBe(303);
    await response.text();
    expect(guide(await student.open(hall.url.pathname))).toBeUndefined();
    const own = await startSession(student, `First time hosting ${tag()}`);
    expect(guide(own, "Host")).toBeDefined();
  });
});
