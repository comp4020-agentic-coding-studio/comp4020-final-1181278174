import { isIP } from "node:net";

export type WindowRule = { key: string; max: number; windowMs: number };
type Window = { at: number[]; windowMs: number };

/** A process-local allowance. Each key always uses the same window and maximum. */
export class WindowLimiter {
  private entries = new Map<string, Window>();
  private sweepAt = 0;

  constructor(private maxKeys = 10_000) {}

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      entry.at = entry.at.filter((at) => at > now - entry.windowMs);
      if (entry.at.length === 0) this.entries.delete(key);
    }
    this.sweepAt = now + 60_000;
  }

  /** Return zero when allowed, otherwise the seconds to wait before trying again. */
  spend(rules: readonly WindowRule[], now = Date.now()): number {
    if (now >= this.sweepAt) this.prune(now);
    for (const rule of rules) {
      const entry = this.entries.get(rule.key);
      if (!entry) continue;
      entry.at = entry.at.filter((at) => at > now - entry.windowMs);
      if (entry.at.length === 0) this.entries.delete(rule.key);
    }

    let wait = 0;
    for (const rule of rules) {
      const entry = this.entries.get(rule.key);
      if (entry && entry.at.length >= rule.max) {
        wait = Math.max(wait, entry.at[0] + rule.windowMs - now);
      }
    }
    if (wait > 0) return Math.max(1, Math.ceil(wait / 1000));

    const missing = new Set(rules.filter((rule) => !this.entries.has(rule.key)).map((rule) => rule.key)).size;
    if (this.entries.size + missing > this.maxKeys) {
      // A burst of new keys cannot evict somebody else's active allowance.
      this.prune(now);
      const needed = this.entries.size + missing - this.maxKeys;
      if (needed > 0) {
        const expiry = [...this.entries.values()]
          .map((entry) => entry.at[entry.at.length - 1] + entry.windowMs)
          .sort((a, b) => a - b);
        return Math.max(1, Math.ceil(((expiry[needed - 1] ?? now + 60_000) - now) / 1000));
      }
    }

    // Reserve every window together, before an action can await any work.
    for (const rule of rules) {
      let entry = this.entries.get(rule.key);
      if (!entry) {
        entry = { at: [], windowMs: rule.windowMs };
        this.entries.set(rule.key, entry);
      }
      entry.at.push(now);
    }
    return 0;
  }
}

export const rates = new WindowLimiter();

/** Open connections hold a place until their owner releases it. */
export class ConnectionLimiter {
  private entries = new Map<string, number>();

  acquire(rules: readonly { key: string; max: number }[]): (() => void) | null {
    if (rules.some(({ key, max }) => (this.entries.get(key) ?? 0) >= max)) return null;
    for (const { key } of rules) this.entries.set(key, (this.entries.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const { key } of rules) {
        const left = (this.entries.get(key) ?? 1) - 1;
        if (left === 0) this.entries.delete(key);
        else this.entries.set(key, left);
      }
    };
  }
}

export const connections = new ConnectionLimiter();

/** The proxy's address is kept only in memory. Null exempts local network counts. */
export function networkAddress(request: Request, address: () => string): string | null {
  const onFly = Boolean(process.env.FLY_APP_NAME);
  let given = request.headers.get("fly-client-ip") ?? "";
  if (!given && !onFly) {
    try {
      given = address();
    } catch {
      given = "";
    }
  }
  if (!isIP(given)) return "unknown";
  if (isIP(given) === 6) {
    try {
      given = new URL(`http://[${given}]/`).hostname.slice(1, -1);
    } catch {
      return "unknown";
    }
    const mapped = /^::ffff:([a-f\d]+):([a-f\d]+)$/.exec(given);
    if (mapped) {
      const high = parseInt(mapped[1], 16);
      const low = parseInt(mapped[2], 16);
      given = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
  }
  if (given === "::1" || given.startsWith("127.")) return onFly ? "unknown" : null;
  // Off Fly, a private address is this machine's own network too: the checks run
  // the app in a Docker container, whose requests come from the container's bridge.
  if (!onFly && (PRIVATE_V4.test(given) || /^f[cd][0-9a-f]{0,2}:/i.test(given))) return null;
  return given;
}

/** 10/8, 172.16/12 and 192.168/16. */
const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
