import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

// On the live app the key the tags are made with is a Fly secret: a copy of
// the database alone must not hold it. This runs the app's own code against a
// database of its own, with the key given the way Fly gives it.
const path = join(mkdtempSync(join(tmpdir(), "hands-up-tags-")), "tags.db");
process.env.DATABASE_PATH = path;
process.env.TAGS_SECRET = Buffer.alloc(32, 7).toString("base64");
const { tagFor } = await import("../src/lib/tags.ts");

describe("the key the tags are made with", () => {
  it("stays out of the database when it is given from outside", () => {
    const tag = tagFor("asker", "some-account");
    expect(tag).toMatch(/^a\./);
    const rows = new Database(path, { readonly: true }).prepare("SELECT name FROM secrets").all();
    expect(rows).toEqual([]);
  });
});
