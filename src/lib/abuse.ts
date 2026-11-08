import { networkAddress, rates, type WindowRule } from "./limits.ts";
import type { Fields } from "./log.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export type Refused = { ok: false; status: number; retryAfter?: number };
type Action = "ask" | "start" | "hand" | "vote" | "report" | "unreport" | "mark" | "going_over" | "timeline_mark" | "recording" | "class";

/** Every browser and session of an account spends the same allowance. */
export function accountRules(person: string, action: Action): WindowRule[] {
  const key = `account:${person}:`;
  if (action === "ask") return [
    { key: key + "ask:minute", max: 3, windowMs: MINUTE },
    { key: key + "ask:hour", max: 20, windowMs: HOUR },
  ];
  if (action === "start") return [{ key: key + "start", max: 10, windowMs: HOUR }];
  if (action === "hand") return [{ key: key + "hand", max: 20, windowMs: MINUTE }];
  // starting and ending a class: a few a minute is plenty, apart from the host's other controls
  if (action === "class") return [{ key: key + "class", max: 10, windowMs: MINUTE }];
  if (action === "vote" || action === "report" || action === "unreport") {
    return [{ key: key + "feedback", max: 60, windowMs: MINUTE }];
  }
  // Question states, timeline marks, recording time and Going over it share a budget.
  return [{ key: key + "host", max: 20, windowMs: MINUTE }];
}

export function accountRefusal(
  person: string,
  action: Action,
  log: (what: string, fields?: Fields) => void,
  session?: string,
): Refused | undefined {
  const retryAfter = rates.spend(accountRules(person, action));
  if (!retryAfter) return;
  log("refused", { action, session, reason: "rate" });
  return { ok: false, status: 429, retryAfter };
}

/** Loopback skips the address budget, but still spends the machine's budget. */
export function signupRules(network: string | null): WindowRule[] {
  return [
    { key: "signup:anywhere", max: 600, windowMs: 10 * MINUTE },
    ...(network === null ? [] : [{ key: `signup:network:${network}`, max: 400, windowMs: 10 * MINUTE }]),
  ];
}

export function signupRetryAfter(request: Request, address: () => string): number {
  return rates.spend(signupRules(networkAddress(request, address)));
}
