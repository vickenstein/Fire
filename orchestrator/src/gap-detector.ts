import type { QuestDBClient } from "@fire/questdb";
import { formatDate } from "@fire/massive";
import type { GapInfo } from "./types";

export class GapDetector {
  constructor(private readonly client: QuestDBClient) {}

  /** Get the latest timestamp across all tickers in minute_bars. */
  async getLatestTimestamp(): Promise<Date | null> {
    return this.client.getLatestTimestamp();
  }

  /**
   * Compute the backfill gap based on the latest QuestDB timestamp.
   *
   * - Cold start (no data): backfill from backfillStartDate through yesterday
   * - Warm resume: backfill from the day after the latest timestamp through yesterday
   * - Caught up: no gap, safe to start live streaming
   */
  computeGap(latestTimestamp: Date | null, backfillStartDate: string): GapInfo {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const endDate = formatDate(yesterday);

    // Cap start date to 5 years ago (Massive flat file lookback limit)
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setUTCFullYear(fiveYearsAgo.getUTCFullYear() - 5);
    const earliestAllowed = formatDate(fiveYearsAgo);
    const effectiveStart = backfillStartDate < earliestAllowed
      ? earliestAllowed
      : backfillStartDate;

    if (!latestTimestamp) {
      return {
        latestTimestamp: null,
        backfillStartDate: effectiveStart,
        backfillEndDate: endDate,
        hasGap: effectiveStart <= endDate,
        isCaughtUp: false,
      };
    }

    // Start from the day after the latest timestamp
    const nextDay = new Date(latestTimestamp);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const startDate = formatDate(nextDay);

    const hasGap = startDate <= endDate;

    // "Caught up" means we have data through at least the previous trading day.
    // S3 flat files for day T are published on T+1, so the latest available
    // S3 data is for yesterday. If our QuestDB data is from yesterday or later,
    // we're caught up and can start the live stream.
    const latestDateStr = formatDate(latestTimestamp);
    const previousTradingDay = this.getPreviousTradingDay();
    const isCaughtUp = latestDateStr >= previousTradingDay;

    return {
      latestTimestamp,
      backfillStartDate: startDate,
      backfillEndDate: endDate,
      hasGap,
      isCaughtUp,
    };
  }

  /**
   * Get the previous trading day (most recent weekday before today).
   * Returns YYYY-MM-DD string.
   */
  private getPreviousTradingDay(from?: Date): string {
    const now = from ?? new Date();
    const candidate = new Date(now);
    candidate.setUTCDate(candidate.getUTCDate() - 1);

    // Walk backwards until we hit a weekday
    while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
      candidate.setUTCDate(candidate.getUTCDate() - 1);
    }

    return formatDate(candidate);
  }
}
