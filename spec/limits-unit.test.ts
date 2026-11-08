import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionLimiter, networkAddress, WindowLimiter } from "../src/lib/limits.ts";

describe("sliding allowances", () => {
  it("allows the maximum, rounds Retry-After up, and expires at the exact boundary", () => {
    const limiter = new WindowLimiter();
    const rules = [{ key: "ask", max: 3, windowMs: 60_000 }];
    for (let n = 0; n < 3; n++) expect(limiter.spend(rules, 0)).toBe(0);
    expect(limiter.spend(rules, 1)).toBe(60);
    expect(limiter.spend(rules, 59_999)).toBe(1);
    expect(limiter.spend(rules, 60_000)).toBe(0);
  });

  it("slides each accepted attempt separately without extending a refusal", () => {
    const limiter = new WindowLimiter();
    const rules = [{ key: "ask", max: 2, windowMs: 60_000 }];
    expect(limiter.spend(rules, 0)).toBe(0);
    expect(limiter.spend(rules, 30_000)).toBe(0);
    expect(limiter.spend(rules, 59_000)).toBe(1);
    expect(limiter.spend(rules, 60_000)).toBe(0);
    expect(limiter.spend(rules, 60_001)).toBe(30);
    expect(limiter.spend(rules, 90_000)).toBe(0);
  });

  it("checks all windows before spending any of them", () => {
    const limiter = new WindowLimiter();
    const minute = { key: "minute", max: 1, windowMs: 60_000 };
    const hour = { key: "hour", max: 2, windowMs: 3_600_000 };
    expect(limiter.spend([minute, hour], 0)).toBe(0);
    expect(limiter.spend([minute, hour], 1)).toBe(60);
    expect(limiter.spend([minute, hour], 60_000)).toBe(0);
    expect(limiter.spend([minute, hour], 120_000)).toBe(3480);
    // The hour refusal did not spend the now-empty minute.
    expect(limiter.spend([minute], 120_000)).toBe(0);
  });

  it("waits for the longest full window and keeps different accounts independent", () => {
    const limiter = new WindowLimiter();
    const rules = [
      { key: "a:minute", max: 1, windowMs: 60_000 },
      { key: "a:hour", max: 1, windowMs: 3_600_000 },
    ];
    expect(limiter.spend(rules, 0)).toBe(0);
    expect(limiter.spend(rules, 1000)).toBe(3599);
    expect(limiter.spend([{ key: "b:minute", max: 1, windowMs: 60_000 }], 1000)).toBe(0);
  });

  it("caps keys without evicting active allowances and prunes old keys", () => {
    const limiter = new WindowLimiter(2);
    const rule = (key: string) => [{ key, max: 1, windowMs: 1000 }];
    expect(limiter.spend(rule("a"), 0)).toBe(0);
    expect(limiter.spend(rule("b"), 500)).toBe(0);
    expect(limiter.spend(rule("c"), 501)).toBe(1);
    expect(limiter.spend(rule("a"), 502)).toBe(1);
    expect(limiter.spend(rule("c"), 1000)).toBe(0);
    expect(limiter.spend(rule("b"), 1000)).toBe(1);
    expect(limiter.spend(rule("d"), 1500)).toBe(0);
  });

  it("does not spend existing windows when the map has no space", () => {
    const limiter = new WindowLimiter(1);
    const first = { key: "first", max: 2, windowMs: 60_000 };
    expect(limiter.spend([first], 0)).toBe(0);
    expect(limiter.spend([first, { ...first, key: "second" }], 1)).toBe(60);
    expect(limiter.spend([first], 2)).toBe(0);
    expect(limiter.spend([first], 3)).toBe(60);
  });
});

describe("open connection allowances", () => {
  it("reserves all counts together and releases each connection only once", () => {
    const limiter = new ConnectionLimiter();
    const all = { key: "all", max: 3 };
    const a = { key: "a", max: 1 };
    const b = { key: "b", max: 2 };
    const releaseA = limiter.acquire([all, a]);
    expect(releaseA).not.toBeNull();
    expect(limiter.acquire([all, a])).toBeNull();
    const releaseB = limiter.acquire([all, b]);
    const releaseB2 = limiter.acquire([all, b]);
    expect(releaseB).not.toBeNull();
    expect(releaseB2).not.toBeNull();
    expect(limiter.acquire([all])).toBeNull();
    releaseA!();
    releaseA!();
    const releaseAgain = limiter.acquire([all, a]);
    expect(releaseAgain).not.toBeNull();
    expect(limiter.acquire([all])).toBeNull();
    releaseB!();
    releaseB2!();
    releaseAgain!();
    expect(limiter.acquire([all, a])).not.toBeNull();
  });
});

describe("network addresses", () => {
  afterEach(() => vi.unstubAllEnvs());

  const request = (ip?: string) => new Request("http://localhost", {
    headers: ip === undefined ? {} : { "fly-client-ip": ip },
  });

  it("exempts IPv4, IPv6 and mapped loopback locally", () => {
    vi.stubEnv("FLY_APP_NAME", "");
    for (const ip of ["127.0.0.1", "127.1.2.3", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
      expect(networkAddress(request(), () => ip)).toBeNull();
    }
  });

  it("normalizes mapped and expanded addresses into the same network key", () => {
    vi.stubEnv("FLY_APP_NAME", "");
    expect(networkAddress(request(), () => "::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(networkAddress(request(), () => "2001:0db8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(networkAddress(request("198.51.100.2"), () => "127.0.0.1")).toBe("198.51.100.2");
  });

  it("puts missing and invalid addresses in a shared bucket", () => {
    vi.stubEnv("FLY_APP_NAME", "");
    expect(networkAddress(request(), () => { throw new Error("unavailable"); })).toBe("unknown");
    expect(networkAddress(request("not an address"), () => "127.0.0.1")).toBe("unknown");
  });

  it("does not exempt missing or loopback proxy addresses on Fly", () => {
    vi.stubEnv("FLY_APP_NAME", "hands-up");
    expect(networkAddress(request(), () => "127.0.0.1")).toBe("unknown");
    expect(networkAddress(request("127.0.0.1"), () => "127.0.0.1")).toBe("unknown");
    expect(networkAddress(request("2001:db8::1"), () => "127.0.0.1")).toBe("2001:db8::1");
  });
});
