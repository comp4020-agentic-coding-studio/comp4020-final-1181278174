import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db.ts";
import { secrets } from "./schema.ts";

// A tag stands in for an account where the app must know the same account
// again but has no need to keep it in the clear: who asked a question (for
// "Yours") and who reported one (one report each). It is an HMAC of the
// account with a secret the server makes at its first boot and keeps on the
// volume, so the questions and reports tables alone don't say who. Each use has
// its own tag, so an asker's tag and a reporter's tag can't be matched up.
// Whoever runs the server holds the secret and could work the tags out again:
// that is one of the limits the README states.

let secret: Buffer | undefined;

function serverSecret(): Buffer {
  if (secret) return secret;
  const read = () => db.select().from(secrets).where(eq(secrets.name, "tags")).get();
  if (!read()) db.insert(secrets).values({ name: "tags", value: randomBytes(32).toString("base64") }).onConflictDoNothing().run();
  secret = Buffer.from(read()!.value, "base64");
  return secret;
}

/** The tag for an account in one use. Starts with the use's letter, so the two kinds can't be mixed up. */
export const tagFor = (use: "asker" | "reporter", account: string): string =>
  `${use[0]}.${createHmac("sha256", serverSecret()).update(`${use}:${account}`).digest("base64url").slice(0, 32)}`;
