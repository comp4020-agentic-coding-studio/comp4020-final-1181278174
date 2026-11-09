import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The timeline keeps every sitting: a course that reuses one code all term
// must still show its first lectures after many short visits.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "hands-up-sittings-")), "sittings.db");
const { findSession, startSession } = await import("../src/lib/board.ts");
const { db } = await import("../src/lib/db.ts");
const { presence } = await import("../src/lib/schema.ts");
const { sittings } = await import("../src/lib/record.ts");

describe("the timeline's sittings", () => {
  it("keeps every sitting, newest first, not only the last few", () => {
    const session = findSession(startSession("A whole term", "host-account"))!;
    const now = Date.now();
    const first = Math.floor(now / 60_000) - 12 * 60;
    // twelve sittings an hour apart, three minutes each, the last ended long ago
    for (let s = 0; s < 12; s++) {
      for (let m = 0; m < 3; m++) {
        db.insert(presence).values({ sessionId: session.id, minute: first + s * 60 + m, most: 4, last: 4 }).run();
      }
    }
    const all = sittings(session.id, 0, now);
    expect(all).toHaveLength(12);
    expect(all[0].from.getTime()).toBeGreaterThan(all[11].from.getTime());
  });
});
