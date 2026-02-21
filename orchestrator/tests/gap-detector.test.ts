import { describe, test, expect, mock, beforeEach } from "bun:test";
import { GapDetector } from "../src/gap-detector";
import type { QuestDBClient } from "@fire/questdb";

function createMockClient(
  latestTimestamp?: Date | null,
  error?: Error,
): QuestDBClient {
  const client = {
    getLatestTimestamp: mock(async () => {
      if (error) throw error;
      return latestTimestamp ?? null;
    }),
  } as unknown as QuestDBClient;
  return client;
}

describe("GapDetector", () => {
  describe("getLatestTimestamp", () => {
    test("returns Date when data exists", async () => {
      const ts = new Date("2024-06-15T20:00:00Z");
      const client = createMockClient(ts);
      const detector = new GapDetector(client);

      const result = await detector.getLatestTimestamp();

      expect(result).toBeInstanceOf(Date);
      expect(result!.getTime()).toBe(ts.getTime());
    });

    test("returns null when no data exists", async () => {
      const client = createMockClient(null);
      const detector = new GapDetector(client);

      const result = await detector.getLatestTimestamp();

      expect(result).toBeNull();
    });

    test("returns null when table does not exist", async () => {
      // QuestDBClient.getLatestTimestamp() handles "table not found" internally
      // and returns null, so the mock should also return null
      const client = createMockClient(null);
      const detector = new GapDetector(client);

      const result = await detector.getLatestTimestamp();

      expect(result).toBeNull();
    });

    test("throws on unexpected errors", async () => {
      const client = createMockClient(
        undefined,
        new Error("connection refused"),
      );
      const detector = new GapDetector(client);

      await expect(detector.getLatestTimestamp()).rejects.toThrow(
        "connection refused",
      );
    });
  });

  describe("computeGap", () => {
    test("cold start: returns full backfill range", () => {
      const client = createMockClient();
      const detector = new GapDetector(client);

      // Use a date within 5 years so it doesn't get capped
      const twoYearsAgo = new Date();
      twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);
      const startDate = `${twoYearsAgo.getUTCFullYear()}-01-02`;

      const gap = detector.computeGap(null, startDate);

      expect(gap.latestTimestamp).toBeNull();
      expect(gap.backfillStartDate).toBe(startDate);
      expect(gap.hasGap).toBe(true);
      expect(gap.isCaughtUp).toBe(false);
    });

    test("partial data: returns gap from next day", () => {
      const client = createMockClient();
      const detector = new GapDetector(client);

      // Latest data is from June 15, so gap starts June 16
      const latestTs = new Date("2024-06-15T20:00:00Z");
      const gap = detector.computeGap(latestTs, "2020-01-02");

      expect(gap.backfillStartDate).toBe("2024-06-16");
      expect(gap.hasGap).toBe(true);
      expect(gap.isCaughtUp).toBe(false);
    });

    test("caught up: returns isCaughtUp true when data is recent", () => {
      const client = createMockClient();
      const detector = new GapDetector(client);

      // Simulate data from yesterday
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      yesterday.setUTCHours(20, 0, 0, 0); // 8 PM UTC yesterday

      const gap = detector.computeGap(yesterday, "2020-01-02");

      expect(gap.isCaughtUp).toBe(true);
    });

    test("no gap: hasGap is false when fully caught up", () => {
      const client = createMockClient();
      const detector = new GapDetector(client);

      // Latest data is today — no gap
      const today = new Date();
      today.setUTCHours(20, 0, 0, 0);

      const gap = detector.computeGap(today, "2020-01-02");

      expect(gap.hasGap).toBe(false);
      expect(gap.isCaughtUp).toBe(true);
    });
  });
});
