import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "./db.ts";
import { accounts, sessions, signIns } from "./schema.ts";

export const SIGNIN_COOKIE = "hands_up_signin";
export const SIGNIN_SECONDS = 60 * 60 * 24 * 30;

export type Account = { id: string; username: string };
export type AccountResult = { ok: true; account: Account } | { ok: false; reason: string; message: string };

const USERNAME = /^[A-Za-z0-9._-]{3,30}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const N = 16384;
const R = 8;
const P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const MAX_MEMORY = 32 * 1024 * 1024;
const TEN_MINUTES = 10 * 60 * 1000;
const MAX_PASSWORD = 200;
// The passwords a guesser tries first, against every username in turn.
const COMMON = new Set([
  "12345678", "123456789", "1234567890", "12341234", "87654321", "11111111", "00000000",
  "password", "password1", "password123", "passw0rd", "qwertyui", "qwerty123", "abcdefgh",
  "abc12345", "iloveyou", "sunshine", "football", "baseball", "welcome1", "letmein1",
  "admin123", "trustno1", "starwars", "whatever", "princess",
]);
// Wrong passwords for one username are counted three ways, so someone else's
// guesses can't keep the owner out: from one browser, from one network address,
// and from anywhere. The address is kept in memory only, never logged.
const LIMITS = { browser: 10, network: 30, anywhere: 100 } as const;

// Pending checks reserve a place too, so concurrent requests cannot all pass
// the limit before their password checks finish. No names go into the logs.
type Attempts = { failed: number[]; pending: number };
const attempts = new Map<string, Attempts>();
let sweepAt = 0;

function recentAttempts(key: string, now: number): Attempts {
  if (now >= sweepAt) {
    for (const [username, entry] of attempts) {
      entry.failed = entry.failed.filter((at) => at > now - TEN_MINUTES);
      if (entry.failed.length === 0 && entry.pending === 0) attempts.delete(username);
    }
    sweepAt = now + 60_000;
  }
  let entry = attempts.get(key);
  if (!entry) {
    entry = { failed: [], pending: 0 };
    attempts.set(key, entry);
  }
  entry.failed = entry.failed.filter((at) => at > now - TEN_MINUTES);
  return entry;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return ["scrypt", N, R, P, KEY_BYTES, salt.toString("base64url"), key.toString("base64url")].join("$");
}

// An unknown account still costs a password check, with no useful hash to
// compare against. This keeps a sign-in failure's timing from naming accounts.
const dummySalt = randomBytes(SALT_BYTES);
const dummyKey = randomBytes(KEY_BYTES);

async function matches(password: string, stored?: string): Promise<boolean> {
  const parts = stored?.split("$");
  const valid = parts?.length === 7
    && parts[0] === "scrypt" && parts[1] === String(N) && parts[2] === String(R)
    && parts[3] === String(P) && parts[4] === String(KEY_BYTES)
    && /^[A-Za-z0-9_-]{22}$/.test(parts[5]) && /^[A-Za-z0-9_-]{86}$/.test(parts[6]);
  const salt = valid ? Buffer.from(parts[5], "base64url") : dummySalt;
  const expected = valid ? Buffer.from(parts[6], "base64url") : dummyKey;
  const actual = await derive(password, salt);
  const equal = timingSafeEqual(actual, expected);
  return Boolean(valid && equal);
}

/** Create a private account; the display spelling stays as its owner typed it. */
export async function createAccount(username: string, password: string): Promise<AccountResult> {
  if (!USERNAME.test(username)) {
    return { ok: false, reason: "username-shape", message: "Use 3 to 30 letters, digits, dots, dashes or underscores." };
  }
  if ([...password].length < 8) {
    return { ok: false, reason: "password-short", message: "Use at least 8 characters for your password." };
  }
  if ([...password].length > MAX_PASSWORD) {
    return { ok: false, reason: "password-long", message: `Use at most ${MAX_PASSWORD} characters for your password.` };
  }
  if (COMMON.has(password.toLowerCase()) || password.toLowerCase().includes(username.toLowerCase())) {
    return { ok: false, reason: "password-weak", message: "Choose a password that isn't a common one and doesn't contain your username." };
  }
  const usernameKey = username.toLowerCase();
  const passwordHash = await hashPassword(password);
  const account = db.insert(accounts)
    .values({ id: randomBytes(16).toString("base64url"), username, usernameKey, passwordHash, createdAt: new Date() })
    .onConflictDoNothing({ target: accounts.usernameKey })
    .returning({ id: accounts.id, username: accounts.username })
    .get();
  return account
    ? { ok: true, account }
    : { ok: false, reason: "username-taken", message: "That username is taken." };
}

/**
 * Check credentials without revealing which part was wrong. `from` is the
 * browser's id and the network address the request came from.
 */
export async function verifyPassword(
  username: string,
  password: string,
  from: { browser: string; network: string } = { browser: "", network: "" },
): Promise<AccountResult> {
  const key = username.toLowerCase();
  const now = Date.now();
  const counted = [
    { key: `browser|${key}|${from.network}|${from.browser}`, max: LIMITS.browser },
    { key: `network|${key}|${from.network}`, max: LIMITS.network },
    { key: `anywhere|${key}`, max: LIMITS.anywhere },
  ].map((c) => ({ ...c, entry: recentAttempts(c.key, now) }));
  if (counted.some((c) => c.entry.failed.length + c.entry.pending >= c.max)) {
    return { ok: false, reason: "sign-in-limit", message: "Too many tries. Try again in 10 minutes." };
  }
  for (const c of counted) c.entry.pending += 1;
  try {
    const account = db.select().from(accounts).where(eq(accounts.usernameKey, key)).get();
    // an over-long password is wrong without being hashed
    const valid = [...password].length <= MAX_PASSWORD && (await matches(password, account?.passwordHash));
    if (valid && account) return { ok: true, account: { id: account.id, username: account.username } };
    for (const c of counted) c.entry.failed.push(Date.now());
    return { ok: false, reason: "wrong-credentials", message: "The username or password is wrong." };
  } finally {
    for (const c of counted) {
      c.entry.pending -= 1;
      if (c.entry.pending === 0 && c.entry.failed.length === 0) attempts.delete(c.key);
    }
  }
}

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Only the browser receives this token. The database holds its digest. */
export function startSignIn(accountId: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  db.insert(signIns).values({
    tokenHash: tokenHash(token),
    accountId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SIGNIN_SECONDS * 1000),
  }).run();
  return token;
}

/** Expired and ended tokens confer no account, even when their cookie remains. */
export function findAccount(token?: string): Account | null {
  if (!token || !TOKEN.test(token)) return null;
  return db.select({ id: accounts.id, username: accounts.username })
    .from(signIns)
    .innerJoin(accounts, eq(signIns.accountId, accounts.id))
    .where(and(eq(signIns.tokenHash, tokenHash(token)), isNull(signIns.endedAt), gt(signIns.expiresAt, new Date())))
    .get() ?? null;
}

/** End this browser's sign-in; other browsers stay signed in. */
export function endSignIn(token?: string): void {
  if (!token || !TOKEN.test(token)) return;
  db.update(signIns).set({ endedAt: new Date() })
    .where(and(eq(signIns.tokenHash, tokenHash(token)), isNull(signIns.endedAt))).run();
}

/** Keep sessions hosted before accounts existed attached to their lecturer. */
export function claimSessions(browserId: string, accountId: string): void {
  db.update(sessions).set({ host: accountId }).where(eq(sessions.host, browserId)).run();
}
