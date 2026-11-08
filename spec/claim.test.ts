import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Sessions started before sign-in existed belong to a browser id; signing in on
// that browser hands them to the account. An account's own sessions never move:
// copying an account's id into a browser cookie must give nobody its sessions.
// This runs the app's own code against a database of its own.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "hands-up-claim-")), "claim.db");
const { createAccount, claimSessions } = await import("../src/lib/accounts.ts");
const { startSession, findSession } = await import("../src/lib/board.ts");

describe("claiming sessions at sign-in", () => {
  it("moves a browser's old sessions to the account, and never an account's", async () => {
    const lecturer = await createAccount(`lecturer${Date.now() % 100000}`, "a long enough password");
    const thief = await createAccount(`thief${Date.now() % 100000}`, "another long password");
    if (!lecturer.ok || !thief.ok) throw new Error("could not make the accounts");
    const theirs = startSession("The lecturer's own", lecturer.account.id);
    claimSessions(lecturer.account.id, thief.account.id);
    expect(findSession(theirs)?.host, "an account's session moved to someone who copied its id").toBe(lecturer.account.id);

    const oldBrowser = "B".repeat(22);
    const old = startSession("Started before sign-in", oldBrowser);
    claimSessions(oldBrowser, lecturer.account.id);
    expect(findSession(old)?.host).toBe(lecturer.account.id);
  });
});
