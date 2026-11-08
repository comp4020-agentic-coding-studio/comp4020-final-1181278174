import { describe, expect, it } from "vitest";
import { accountRules, signupRules } from "../src/lib/abuse.ts";
import { WindowLimiter } from "../src/lib/limits.ts";

describe("the action allowances with a clock", () => {
  it("allows twenty questions spread through an hour, then waits for the first to expire", () => {
    const limiter = new WindowLimiter();
    const rules = accountRules("one", "ask");
    for (let n = 0; n < 20; n++) expect(limiter.spend(rules, n * 60_000)).toBe(0);
    expect(limiter.spend(rules, 20 * 60_000)).toBe(2400);
    expect(limiter.spend(rules, 3_599_999)).toBe(1);
    expect(limiter.spend(rules, 3_600_000)).toBe(0);
  });

  it("admits a 300-student arrival with retries, then enforces both signup budgets atomically", () => {
    const limiter = new WindowLimiter();
    const campus = signupRules("192.0.2.1");
    for (let n = 0; n < 400; n++) expect(limiter.spend(campus, n * 500)).toBe(0);
    for (let n = 0; n < 20; n++) expect(limiter.spend(campus, 200_000)).toBe(400);
    const elsewhere = signupRules("192.0.2.2");
    for (let n = 0; n < 200; n++) expect(limiter.spend(elsewhere, 200_000)).toBe(0);
    expect(limiter.spend(elsewhere, 200_000)).toBe(400);
    expect(limiter.spend(campus, 600_000)).toBe(0);
  });

  it("still limits machine-wide signups on loopback", () => {
    const limiter = new WindowLimiter();
    const local = signupRules(null);
    for (let n = 0; n < 600; n++) expect(limiter.spend(local, 0)).toBe(0);
    expect(limiter.spend(local, 1)).toBe(600);
    expect(limiter.spend(local, 600_000)).toBe(0);
  });
});
