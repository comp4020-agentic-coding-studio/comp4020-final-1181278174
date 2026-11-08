import { afterEach, describe, expect, it } from "vitest";
import { ask, formWithButton, questionsPath, startSession, type Stream, Visitor } from "./visitor.ts";

const tag = (): string => Math.random().toString(36).slice(2, 8);
const open: Stream[] = [];
afterEach(() => {
  for (const stream of open.splice(0)) stream.close();
});

describe("no person behind a hand or a question", () => {
  it("neither the host nor a guest is sent who raised a hand or asked a question on any session page or stream", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `No names ${tag()}`);
    const path = hall.url.pathname;
    const asking = questionsPath(hall);
    const guest = new Visitor();
    const readers = [{ name: "host", who: host }, { name: "guest", who: guest }];
    const streams: Stream[] = [];
    for (const { who } of readers) {
      const stream = await who.listen(await who.open(path));
      open.push(stream);
      streams.push(stream);
      expect(stream.status).toBe(200);
    }

    const holder = new Visitor();
    const handPage = await holder.open(path);
    const raised = await holder.submit(handPage, formWithButton(handPage, /i'm lost/i));
    expect(raised.status).toBe(200);
    const asker = new Visitor();
    const body = `A question without a name ${tag()}`;
    expect((await ask(asker, asking, body)).status).toBe(200);

    // The cookie is also the person id used for hands and questions on the server.
    expect(holder.secrets.length).toBeGreaterThan(0);
    expect(asker.secrets.length).toBeGreaterThan(0);
    const secrets = [...holder.secrets, ...asker.secrets];
    for (const [index, { name, who }] of readers.entries()) {
      const stream = streams[index];
      await stream.until((board) => board.hands.length === 1 && board.questions.length === 1);
      await stream.untilAdded((question) => question.body === body);
      for (const secret of secrets) expect(stream.raw, `${name}'s events stream`).not.toContain(secret);

      for (const route of [path, asking, `${path}/present`, `${path}/timeline`]) {
        const page = await who.open(route);
        expect(page.status, `${name}'s ${route}`).toBe(200);
        for (const secret of secrets) expect(page.html, `${name}'s ${route}`).not.toContain(secret);
      }
    }
  });
});

describe("the visitor's cookie", () => {
  it("gives a fresh visitor a hands_up_person cookie", async () => {
    const visitor = new Visitor();
    expect(visitor.cookie("hands_up_person")).toBeUndefined();
    expect((await visitor.open("/")).status).toBe(200);
    expect(visitor.cookie("hands_up_person")).toBeTruthy();
  });

  it("keeps the same cookie on the visitor's next request", async () => {
    const visitor = new Visitor();
    await visitor.open("/");
    const before = visitor.cookie("hands_up_person");
    expect(before).toBeTruthy();
    expect((await visitor.open("/")).status).toBe(200);
    expect(visitor.cookie("hands_up_person")).toBe(before);
  });

  it("gives two fresh visitors different cookies", async () => {
    const first = new Visitor();
    const second = new Visitor();
    await first.open("/");
    await second.open("/");
    expect(first.cookie("hands_up_person")).toBeTruthy();
    expect(second.cookie("hands_up_person")).toBeTruthy();
    expect(second.cookie("hands_up_person")).not.toBe(first.cookie("hands_up_person"));
  });

  it("replaces a malformed cookie value", async () => {
    const malformed = "not-a-person";
    const visitor = new Visitor({ hands_up_person: malformed });
    expect((await visitor.open("/")).status).toBe(200);
    const replacement = visitor.cookie("hands_up_person");
    expect(replacement).toBeTruthy();
    expect(replacement).not.toBe(malformed);
    await visitor.open("/");
    expect(visitor.cookie("hands_up_person")).toBe(replacement);
  });
});
