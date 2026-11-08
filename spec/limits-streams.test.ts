import { afterEach, describe, expect, it } from "vitest";
import { startSession, Visitor } from "./visitor.ts";

type OpenStream = { response: Response; abort: AbortController };
const open: OpenStream[] = [];
afterEach(async () => {
  for (const stream of open.splice(0)) {
    stream.abort.abort();
    await stream.response.body?.cancel().catch(() => {});
  }
});

/** Read the stream's HTTP status and headers, keeping the visitor's identity. */
async function stream(who: Visitor, url: URL): Promise<OpenStream> {
  const cookie = ["hands_up_person", "hands_up_signin"]
    .flatMap((name) => who.cookie(name) ? [`${name}=${who.cookie(name)}`] : []).join("; ");
  const abort = new AbortController();
  const response = await fetch(url, { headers: { cookie, accept: "text/event-stream" }, signal: abort.signal });
  const opened = { response, abort };
  open.push(opened);
  return opened;
}

async function refused(who: Visitor, url: URL): Promise<void> {
  const { response } = await stream(who, url);
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(await response.text()).toContain("Too many live pages are open. Close one and try again in a minute.");
}

describe("limits on open streams", () => {
  it("shares ten slots across an account's browsers, sessions and projector tabs, then frees a closed slot", async () => {
    const host = new Visitor();
    const hall = await startSession(host, "Stream limits");
    const otherHall = await startSession(host, "Stream limits elsewhere");
    const first = new Visitor();
    await first.open(hall.url);
    const second = new Visitor({ signedOut: true });
    expect((await second.signIn(first.username, first.password)).status).toBe(200);
    const urls = [new URL(`${hall.url.pathname}/events`, hall.url), new URL(`${otherHall.url.pathname}/events?screen`, hall.url)];
    const admitted: OpenStream[] = [];
    for (let i = 0; i < 10; i++) {
      const opened = await stream(i % 2 ? second : first, urls[i % 2]);
      expect(opened.response.status).toBe(200);
      admitted.push(opened);
    }
    await refused(second, urls[1]);
    await refused(first, urls[0]);

    const independent = new Visitor();
    await independent.open(hall.url);
    expect((await stream(independent, urls[0])).response.status).toBe(200);

    admitted[0].abort.abort();
    // The socket's close is noticed asynchronously by the HTTP server.
    await expect.poll(async () => {
      const reopened = await stream(second, urls[1]);
      if (reopened.response.status !== 200) await reopened.response.text();
      return reopened.response.status;
    }, { timeout: 2000, interval: 100 }).toBe(200);
    await refused(first, urls[0]);
  });

  it("releases signed-in projector slots when that browser signs out", async () => {
    const owner = new Visitor();
    const hall = await startSession(owner, "Projector sign-out");
    const url = new URL(`${hall.url.pathname}/events?screen`, hall.url);
    const sibling = new Visitor({ signedOut: true });
    expect((await sibling.signIn(owner.username, owner.password)).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await stream(owner, url)).response.status).toBe(200);
    await refused(sibling, url);
    expect((await owner.signOut()).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await stream(sibling, url)).response.status).toBe(200);
  });

  it("allows twenty streams per signed-out browser, including on loopback", async () => {
    const hall = await startSession(new Visitor(), "Guest stream limits");
    const guest = new Visitor({ signedOut: true });
    await guest.open(hall.url);
    const url = new URL(`${hall.url.pathname}/events?screen`, hall.url);
    for (let i = 0; i < 20; i++) expect((await stream(guest, url)).response.status).toBe(200);
    await refused(guest, url);

    const another = new Visitor({ signedOut: true });
    await another.open(hall.url);
    expect((await stream(another, url)).response.status).toBe(200);
  });
});
