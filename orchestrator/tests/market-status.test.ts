import { describe, test, expect } from "bun:test";
import {
  getEasternTime,
  isLikelyMarketHours,
  nextLikelyMarketOpen,
  msUntilLikelyMarketOpen,
} from "../src/market-status";

describe("getEasternTime", () => {
  test("parses a known UTC time correctly", () => {
    // 2024-01-15 15:00 UTC = 10:00 AM ET (EST, UTC-5)
    const date = new Date("2024-01-15T15:00:00Z");
    const et = getEasternTime(date);

    expect(et.hours).toBe(10);
    expect(et.minutes).toBe(0);
    expect(et.weekday).toBe(1); // Monday
    expect(et.year).toBe(2024);
    expect(et.month).toBe(1);
    expect(et.day).toBe(15);
  });

  test("handles DST (EDT, UTC-4)", () => {
    // 2024-07-15 14:00 UTC = 10:00 AM ET (EDT, UTC-4)
    const date = new Date("2024-07-15T14:00:00Z");
    const et = getEasternTime(date);

    expect(et.hours).toBe(10);
    expect(et.minutes).toBe(0);
    expect(et.weekday).toBe(1); // Monday
  });

  test("handles weekend (Saturday)", () => {
    // 2024-01-13 18:00 UTC = Saturday
    const date = new Date("2024-01-13T18:00:00Z");
    const et = getEasternTime(date);

    expect(et.weekday).toBe(6); // Saturday
  });
});

describe("isLikelyMarketHours", () => {
  test("returns true during market hours (10:00 AM ET on Monday)", () => {
    // Monday 10:00 AM ET = 15:00 UTC (EST)
    const date = new Date("2024-01-15T15:00:00Z");
    expect(isLikelyMarketHours(date)).toBe(true);
  });

  test("returns true at exactly 9:30 AM ET", () => {
    // Monday 9:30 AM ET = 14:30 UTC (EST)
    const date = new Date("2024-01-15T14:30:00Z");
    expect(isLikelyMarketHours(date)).toBe(true);
  });

  test("returns false at exactly 4:00 PM ET (market close)", () => {
    // Monday 4:00 PM ET = 21:00 UTC (EST)
    const date = new Date("2024-01-15T21:00:00Z");
    expect(isLikelyMarketHours(date)).toBe(false);
  });

  test("returns false before market open (9:00 AM ET)", () => {
    // Monday 9:00 AM ET = 14:00 UTC (EST)
    const date = new Date("2024-01-15T14:00:00Z");
    expect(isLikelyMarketHours(date)).toBe(false);
  });

  test("returns false on Saturday", () => {
    // Saturday 12:00 PM ET
    const date = new Date("2024-01-13T17:00:00Z");
    expect(isLikelyMarketHours(date)).toBe(false);
  });

  test("returns false on Sunday", () => {
    // Sunday 12:00 PM ET
    const date = new Date("2024-01-14T17:00:00Z");
    expect(isLikelyMarketHours(date)).toBe(false);
  });

  test("returns true at 3:59 PM ET (last minute)", () => {
    // Monday 3:59 PM ET = 20:59 UTC (EST)
    const date = new Date("2024-01-15T20:59:00Z");
    expect(isLikelyMarketHours(date)).toBe(true);
  });

  test("handles DST (EDT) correctly", () => {
    // Monday 10:00 AM ET during summer = 14:00 UTC (EDT, UTC-4)
    const date = new Date("2024-07-15T14:00:00Z");
    expect(isLikelyMarketHours(date)).toBe(true);
  });
});

describe("nextLikelyMarketOpen", () => {
  test("returns today's open if before 9:30 AM ET on weekday", () => {
    // Monday 8:00 AM ET = 13:00 UTC (EST)
    const from = new Date("2024-01-15T13:00:00Z");
    const next = nextLikelyMarketOpen(from);

    // Should be 9:30 AM ET today = 14:30 UTC
    expect(next.getUTCHours()).toBe(14);
    expect(next.getUTCMinutes()).toBe(30);
    expect(next.getUTCDate()).toBe(15);
  });

  test("returns next weekday open if after market close on Friday", () => {
    // Friday 5:00 PM ET = 22:00 UTC (EST)
    const from = new Date("2024-01-12T22:00:00Z");
    const next = nextLikelyMarketOpen(from);

    // Should be Monday 9:30 AM ET = Monday 14:30 UTC
    expect(next.getUTCDay()).toBe(1); // Monday
    expect(next.getUTCHours()).toBe(14);
    expect(next.getUTCMinutes()).toBe(30);
  });

  test("returns next weekday from Saturday", () => {
    // Saturday 12:00 PM ET
    const from = new Date("2024-01-13T17:00:00Z");
    const next = nextLikelyMarketOpen(from);

    // Should be Monday
    expect(next.getUTCDay()).toBe(1); // Monday
  });

  test("returns next day open if after close on weekday", () => {
    // Monday 5:00 PM ET = 22:00 UTC (EST)
    const from = new Date("2024-01-15T22:00:00Z");
    const next = nextLikelyMarketOpen(from);

    // Should be Tuesday
    expect(next.getUTCDay()).toBe(2); // Tuesday
  });
});

describe("msUntilLikelyMarketOpen", () => {
  test("returns 0 when market is open", () => {
    // Monday 10:00 AM ET
    const from = new Date("2024-01-15T15:00:00Z");
    expect(msUntilLikelyMarketOpen(from)).toBe(0);
  });

  test("returns positive number when market is closed", () => {
    // Monday 9:00 AM ET = 14:00 UTC (30 min to open)
    const from = new Date("2024-01-15T14:00:00Z");
    const ms = msUntilLikelyMarketOpen(from);

    // Should be approximately 30 minutes
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(31 * 60_000);
  });
});
