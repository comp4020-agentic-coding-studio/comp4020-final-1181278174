import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AUDIT_PUBLIC_KEY, newAuditKeys, open, seal } from "../src/lib/escrow.ts";

// Who asked a question is sealed to the auditor's public key: the app can
// write it and cannot read it back. These run the sealing itself, with a key
// pair made for the test; the real private key is never in the repo.
const asked = { account: "acct-test-1", question: 41, session: "AB2C", body: "Why is δ less than 1?", at: 1_762_650_000_000 };

describe("a sealed author", () => {
  it("opens with the auditor's private key, for that question and those words", () => {
    const keys = newAuditKeys();
    const envelope = seal(asked, keys.publicKey);
    const author = open(envelope, asked.question, keys.privateKeyPem, asked.body);
    expect(author.account).toBe(asked.account);
    expect(author.session).toBe(asked.session);
    expect(author.at).toBe(asked.at);
  });

  it("holds neither the account nor the words in a form anyone can read", () => {
    const envelope = seal(asked, newAuditKeys().publicKey);
    expect(envelope).not.toContain(asked.account);
    expect(envelope).not.toContain("less than");
  });

  it("does not open with another key, for another question, with other words, or after a change", () => {
    const keys = newAuditKeys();
    const envelope = seal(asked, keys.publicKey);
    expect(() => open(envelope, asked.question, newAuditKeys().privateKeyPem)).toThrow();
    expect(() => open(envelope, asked.question + 1, keys.privateKeyPem)).toThrow();
    expect(() => open(envelope, asked.question, keys.privateKeyPem, "Some other question?")).toThrow();
    const sealed = JSON.parse(envelope) as { ct: string };
    const changed = Buffer.from(sealed.ct, "base64");
    changed[0] ^= 1;
    expect(() => open(JSON.stringify({ ...sealed, ct: changed.toString("base64") }), asked.question, keys.privateKeyPem)).toThrow();
  });

  it("is sealed to the auditor's real public key, whose private key is in no file the repo tracks", () => {
    expect(() => seal(asked)).not.toThrow();
    let tracked = "";
    try {
      tracked = execFileSync("git", ["grep", "-l", "-e", "BEGIN PRIVATE KEY", "--", "."], { encoding: "utf8" }).trim();
    } catch (error) {
      // git grep exits with 1 when nothing matches
      if ((error as { status?: number }).status !== 1) throw error;
    }
    // only this check names the marker it looks for
    expect(tracked.split("\n").filter((file) => file && file !== "spec/escrow.test.ts")).toEqual([]);
    expect(AUDIT_PUBLIC_KEY).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
