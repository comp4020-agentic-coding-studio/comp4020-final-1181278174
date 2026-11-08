import { afterEach, describe, expect, it } from "vitest";
import { ask, hostPress, type Page, question, questionsPath, startSession, type Stream, Visitor } from "./visitor.ts";

// Reporting through the forms a browser receives, without running the page's script.
const tag = (): string => Math.random().toString(36).slice(2, 8);
const streams: Stream[] = [];
afterEach(() => {
  for (const stream of streams.splice(0)) stream.close();
});

function card(page: Page, id: number): Element {
  const found = page.doc.getElementById(`q-${id}`);
  expect(found, `question ${id} is missing from ${page.url.pathname}`).not.toBeNull();
  return found!;
}

/** The small triangle that opens "Report to the host?", if this card offers it. */
function reportFlag(page: Page, id: number): Element | undefined {
  return card(page, id).querySelector('details[data-report] > summary[aria-label="Report this question to the host"]') ?? undefined;
}

/** The confirming "Report" button inside the triangle's question. */
function reportButton(page: Page, id: number): HTMLButtonElement | undefined {
  return [...card(page, id).querySelectorAll("details[data-report] form button")].find((button) => button.textContent?.trim() === "Report") as HTMLButtonElement | undefined;
}

/** The host's count on a card, as its label says it, or undefined. */
function hostCount(page: Page, id: number): string | undefined {
  return card(page, id).querySelector('[role="img"][aria-label^="Reported "]')?.getAttribute("aria-label") ?? undefined;
}

function reportData(id: number | string): URLSearchParams {
  return new URLSearchParams({ intent: "report", question: String(id) });
}

/** Send the actual Report form, checking the plain POST redirect before following it. */
async function report(who: Visitor, page: Page, id: number): Promise<Page> {
  // a second step: the triangle opens "Report to the host?", whose button sends it
  expect(reportFlag(page, id), "no triangle to report with").toBeDefined();
  const button = reportButton(page, id);
  expect(button, "no confirming Report button").toBeDefined();
  const form = button!.closest("form")!;
  expect(form.getAttribute("method")?.toLowerCase()).toBe("post");
  const data = new URLSearchParams();
  for (const input of form.querySelectorAll<HTMLInputElement>("input[name]")) data.append(input.name, input.value);
  if (button!.name) data.append(button!.name, button!.value);
  expect(data.get("intent")).toBe("report");
  expect(data.get("question")).toBe(String(id));
  const action = new URL(form.getAttribute("action") ?? "", page.url);
  const response = await who.post(action, data);
  expect(response.status).toBe(303);
  const location = new URL(response.headers.get("location")!, action);
  expect(location.pathname + location.search + location.hash).toBe(`${page.url.pathname}${page.url.search}#q-${id}`);
  await response.text();
  return who.open(location);
}

function isReported(page: Page, id: number): void {
  expect(card(page, id).querySelector('[aria-label="You reported this question"]'), "the card doesn't say it was reported").not.toBeNull();
  // nothing left to report with, and for a minute a way to take it back
  expect(reportButton(page, id)).toBeUndefined();
  const undo = [...card(page, id).querySelectorAll("button")].find((button) => button.textContent?.trim() === "Undo");
  expect(undo?.closest("form")?.querySelector('input[name="intent"]')?.getAttribute("value")).toBe("unreport");
}

function noCount(page: Page): void {
  expect(page.html).not.toMatch(/aria-label="Reported \d+ times?"/);
}

async function watch(who: Visitor, path: string): Promise<Stream> {
  const stream = await who.listen(await who.open(path));
  streams.push(stream);
  expect(stream.status).toBe(200);
  return stream;
}

describe("reports over plain HTTP", () => {
  it.each(["hall", "questions"] as const)("reports from the %s, once per account, with a count only for the host", async (from) => {
    const host = new Visitor();
    const hall = await startSession(host, `Reports ${tag()}`);
    const path = questionsPath(hall);
    const route = from === "hall" ? hall.url.pathname : `${path}?sort=recent`;
    const asker = new Visitor();
    const body = `Can this be reported? ${tag()}`;
    const id = question(await ask(asker, path, body), body)!.id;
    const first = new Visitor();
    const second = new Visitor();
    const anonymous = new Visitor({ signedOut: true });

    expect(reportFlag(await asker.open(route), id)).toBeUndefined();
    expect(reportFlag(await host.open(route), id)).toBeUndefined();
    expect(reportFlag(await anonymous.open(route), id)).toBeUndefined();

    const reported = await report(first, await first.open(route), id);
    isReported(reported, id);
    noCount(reported);
    expect(hostCount(await host.open(path), id)).toBe("Reported 1 time");

    // Retrying the original form, even in another browser for this account,
    // cannot create a second report or take the first one back.
    const again = new Visitor();
    expect((await again.signIn(first.username, first.password)).status).toBe(200);
    const repeated = await again.post(route, reportData(id));
    expect(repeated.status).toBe(303);
    await repeated.text();
    isReported(await again.open(route), id);
    expect(hostCount(await host.open(path), id)).toBe("Reported 1 time");

    const secondReported = await report(second, await second.open(route), id);
    isReported(secondReported, id);
    noCount(secondReported);
    for (const hostPath of [hall.url.pathname, path]) {
      expect(hostCount(await host.open(hostPath), id)).toBe("Reported 2 times");
    }

    const refused = await anonymous.post(route, reportData(id));
    expect(refused.status).toBe(401);
    expect(await refused.text()).toContain("Sign in to do that.");
    expect(hostCount(await host.open(path), id)).toBe("Reported 2 times");

    for (const who of [asker, first, second, anonymous, new Visitor()]) {
      for (const studentPath of [hall.url.pathname, path]) noCount(await who.open(studentPath));
    }
    expect(question(await host.open(path), body)!.votes).toBe(0);
  });

  it("takes a report back within a minute, and the host's count with it", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Undo ${tag()}`);
    const path = questionsPath(hall);
    const body = `Reported by mistake ${tag()}`;
    const id = question(await ask(new Visitor(), path, body), body)!.id;
    const student = new Visitor();
    const reported = await report(student, await student.open(path), id);
    expect(hostCount(await host.open(path), id)).toBe("Reported 1 time");
    const undo = [...card(reported, id).querySelectorAll("button")].find((button) => button.textContent?.trim() === "Undo")!;
    const back = await student.submit(reported, undo.closest("form")!, undo);
    expect(back.status).toBe(200);
    expect(reportFlag(back, id), "the triangle didn't come back").toBeDefined();
    expect(hostCount(await host.open(path), id)).toBeUndefined();
    // taking back what is no longer there is refused
    const again = await student.post(path, new URLSearchParams({ intent: "unreport", question: String(id) }));
    expect(again.status).toBe(404);
    await again.text();
  });

  it("refuses a stale Report form for a hidden question, including one sent by the host", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Hidden report ${tag()}`);
    const path = questionsPath(hall);
    const body = `Hidden before reporting ${tag()}`;
    const id = question(await ask(new Visitor(), path, body), body)!.id;
    const first = new Visitor();
    await report(first, await first.open(path), id);
    const stale = new Visitor();
    const before = await stale.open(path);
    const button = reportButton(before, id)!;
    await hostPress(host, path, body, /^hide/i);

    const refused = await stale.submit(before, button.closest("form")!, button);
    expect(refused.status).toBe(404);
    for (const who of [stale, host]) {
      for (const route of [hall.url.pathname, path]) {
        const response = await who.post(route, reportData(id));
        expect(response.status).toBe(404);
        await response.text();
      }
    }
    const kept = question(await host.open(path), body)!;
    expect(hostCount(await host.open(path), id)).toBe("Reported 1 time");
    expect(kept.text).toContain("Hidden");
    expect(question(await stale.open(path), body)).toBeUndefined();
  });

  it("refuses missing questions and questions from another session on both pages", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Report target ${tag()}`);
    const path = questionsPath(hall);
    const otherHall = await startSession(host, `Other report target ${tag()}`);
    const otherPath = questionsPath(otherHall);
    const body = `Only in the other session ${tag()}`;
    const id = question(await ask(new Visitor(), otherPath, body), body)!.id;
    const student = new Visitor();
    for (const route of [hall.url.pathname, path]) {
      for (const target of [id, 0, "not-a-number"]) {
        const response = await student.post(route, reportData(target));
        expect(response.status).toBe(404);
        await response.text();
      }
    }
    noCount(await host.open(otherPath));
    expect(reportButton(await student.open(otherPath), id)).toBeDefined();
  });

  it("never sends the asker's or reporters' identities to the host or another student", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Private reports ${tag()}`);
    const path = questionsPath(hall);
    const watcher = new Visitor();
    const hostStream = await watch(host, path);
    const studentStream = await watch(watcher, path);
    const asker = new Visitor();
    const first = new Visitor();
    const second = new Visitor();
    const body = `A private report ${tag()}`;
    const id = question(await ask(asker, path, body), body)!.id;
    for (const stream of [hostStream, studentStream]) {
      await stream.untilAdded((added) => added.id === id);
      await stream.until((board) => board.questions.some(([question]) => question === id));
    }
    for (const reporter of [first, second]) {
      for (const stream of [hostStream, studentStream]) stream.forget();
      await report(reporter, await reporter.open(path), id);
      for (const stream of [hostStream, studentStream]) {
        const sent = await stream.until(() => true);
        // The shared stream has no report counts or reporter-specific state.
        expect(sent.board.questions).toEqual([[id, 0, "open"]]);
        expect(sent.board).not.toHaveProperty("reports");
      }
    }

    const privateValues = [asker, first, second].flatMap((who) => [who.username, ...who.secrets]);
    for (const stream of [hostStream, studentStream]) {
      for (const value of privateValues) expect(stream.raw).not.toContain(value);
      expect(stream.raw).not.toMatch(/"(?:asker|reporter|reports|reported)"\s*:/);
    }
    for (const who of [host, watcher]) {
      for (const pagePath of [hall.url.pathname, path, `${hall.url.pathname}/timeline`, `${hall.url.pathname}/present`]) {
        const page = await who.open(pagePath);
        for (const value of privateValues) expect(page.html).not.toContain(value);
        if (who === watcher) noCount(page);
      }
    }
    expect(hostCount(await host.open(path), id)).toBe("Reported 2 times");
  });
});
