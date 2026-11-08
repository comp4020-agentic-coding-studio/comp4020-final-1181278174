import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A report can be taken back for a minute, and no longer. The minute can't be
// waited out over HTTP, so this runs the app's own action against a database
// of its own, with the clock moved on.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "hands-up-undo-")), "undo.db");
const { report, unreport, UNDO_MS } = await import("../src/lib/actions.ts");
const { askQuestion, findSession, startSession } = await import("../src/lib/board.ts");

const log = (): void => {};
const form = (id: number): FormData => {
  const data = new FormData();
  data.set("question", String(id));
  return data;
};

describe("taking a report back", () => {
  it("works within the minute and is refused after it", () => {
    const session = findSession(startSession("Undo window", "host-account"))!;
    const id = askQuestion(session, "asker-account", "Was this reported by mistake?");
    expect(report(session, "student-account", form(id), log).ok).toBe(true);
    const late = unreport(session, "student-account", form(id), log, Date.now() + UNDO_MS + 1000);
    expect(late).toEqual({ ok: false, status: 422 });
    expect(unreport(session, "student-account", form(id), log, Date.now() + UNDO_MS - 5000).ok).toBe(true);
  });
});
