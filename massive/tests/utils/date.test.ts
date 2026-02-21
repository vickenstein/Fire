import { describe, it, expect } from "bun:test";
import { getTradingDays, formatDate } from "../../src/utils/date";

describe("getTradingDays", () => {
  it("returns weekdays only", () => {
    // 2024-01-08 (Mon) to 2024-01-14 (Sun) = Mon-Fri
    const days = getTradingDays("2024-01-08", "2024-01-14");
    expect(days).toEqual([
      "2024-01-08",
      "2024-01-09",
      "2024-01-10",
      "2024-01-11",
      "2024-01-12",
    ]);
  });

  it("handles single day (weekday)", () => {
    const days = getTradingDays("2024-01-10", "2024-01-10");
    expect(days).toEqual(["2024-01-10"]);
  });

  it("handles single day (weekend)", () => {
    const days = getTradingDays("2024-01-13", "2024-01-13");
    expect(days).toEqual([]);
  });

  it("handles start > end", () => {
    const days = getTradingDays("2024-01-10", "2024-01-08");
    expect(days).toEqual([]);
  });

  it("spans multiple weeks", () => {
    const days = getTradingDays("2024-01-08", "2024-01-19");
    expect(days).toHaveLength(10); // 2 full weeks of weekdays
  });
});

describe("formatDate", () => {
  it("formats date as YYYY-MM-DD", () => {
    const date = new Date("2024-03-04T12:00:00Z");
    expect(formatDate(date)).toBe("2024-03-04");
  });

  it("pads single-digit months and days", () => {
    const date = new Date("2024-01-05T12:00:00Z");
    expect(formatDate(date)).toBe("2024-01-05");
  });
});
