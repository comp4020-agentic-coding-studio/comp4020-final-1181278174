import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A sign-in with the old password, checked just before the password changed
// elsewhere, must not get a token once the change is made: changing a password
// that someone else knows has to keep them out. This runs the app's own code
// against a database of its own.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "hands-up-race-")), "race.db");
const { changePassword, createAccount, findAccount, startSignIn, verifyPassword } = await import("../src/lib/accounts.ts");

describe("a sign-in checked before a password change", () => {
  it("gets no token after the change, and a sign-in with the new password does", async () => {
    const username = `race${Date.now() % 100000}`;
    const created = await createAccount(username, "the first long password");
    if (!created.ok) throw new Error("could not make the account");
    const from = { browser: "B".repeat(22), network: "192.0.2.7" };
    // someone with the old password has been checked, but has no token yet
    const checked = await verifyPassword(username, "the first long password", from);
    expect(checked.ok).toBe(true);
    // meanwhile the owner changes the password
    const changed = await changePassword(created.account, "the first long password", "the second long password", { browser: "A".repeat(22), network: "192.0.2.8" });
    expect(changed.ok).toBe(true);
    // the earlier check no longer gets in
    expect(checked.ok && startSignIn(checked.account.id, checked.verifiedHash), "a token for the old password").toBeNull();
    // the new password does
    const again = await verifyPassword(username, "the second long password", from);
    expect(again.ok).toBe(true);
    const token = again.ok ? startSignIn(again.account.id, again.verifiedHash) : null;
    expect(token).not.toBeNull();
    expect(findAccount(token!)?.username).toBe(username);
  });
});
