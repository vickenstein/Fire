import { restClient } from "@polygon.io/client-js";
import type { MarketSession } from "./types";

const ET_TIMEZONE = "America/New_York";
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 30;
const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MINUTE = 0;

// ── Static fallback utilities (used when API is unreachable) ────────────

interface EasternTime {
  hours: number;
  minutes: number;
  /** 0=Sun, 1=Mon, ..., 6=Sat */
  weekday: number;
  year: number;
  month: number;
  day: number;
}

export function getEasternTime(date: Date = new Date()): EasternTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    hours: Number(get("hour")),
    minutes: Number(get("minute")),
    weekday: weekdayMap[get("weekday")] ?? 0,
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

/** Static check: is it a weekday between 9:30 AM and 4:00 PM ET? */
export function isLikelyMarketHours(now?: Date): boolean {
  const et = getEasternTime(now);

  // Weekend
  if (et.weekday === 0 || et.weekday === 6) return false;

  const minuteOfDay = et.hours * 60 + et.minutes;
  const openMinute = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE; // 570
  const closeMinute = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE; // 960

  return minuteOfDay >= openMinute && minuteOfDay < closeMinute;
}

/**
 * Get a Date for a specific ET hour:minute on a given ET date.
 * Handles DST by constructing via Intl round-trip.
 */
function easternToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // Create a rough guess in UTC, then measure the ET offset
  const guess = new Date(
    Date.UTC(year, month - 1, day, hour + 5, minute), // ET is UTC-5 or UTC-4
  );

  // Resolve actual ET offset for this moment
  const etStr = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(guess);

  // Parse the ET representation: "MM/DD/YYYY, HH:MM:SS"
  const match = etStr.match(/(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+):(\d+)/);
  if (!match) return guess;

  const etHour = Number(match[4]);
  const etMinute = Number(match[5]);

  // Calculate offset between our target and what ET shows
  const targetMinutes = hour * 60 + minute;
  const actualMinutes = etHour * 60 + etMinute;
  const diffMs = (targetMinutes - actualMinutes) * 60_000;

  return new Date(guess.getTime() + diffMs);
}

/** Returns the next market open as a Date (for idle sleep optimization). */
export function nextLikelyMarketOpen(from?: Date): Date {
  const now = from ?? new Date();
  const et = getEasternTime(now);

  let targetDay = et.day;
  let targetMonth = et.month;
  let targetYear = et.year;

  const minuteOfDay = et.hours * 60 + et.minutes;
  const openMinute = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;

  // If it's a weekday and we're before market open, open is today
  if (et.weekday >= 1 && et.weekday <= 5 && minuteOfDay < openMinute) {
    return easternToUTC(
      targetYear,
      targetMonth,
      targetDay,
      MARKET_OPEN_HOUR,
      MARKET_OPEN_MINUTE,
    );
  }

  // Otherwise, find the next weekday
  let daysToAdd = 1;
  let nextWeekday = et.weekday;

  do {
    nextWeekday = (nextWeekday + 1) % 7;
    if (nextWeekday >= 1 && nextWeekday <= 5) break;
    daysToAdd++;
  } while (true);

  const nextDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60_000);
  const nextEt = getEasternTime(nextDate);

  return easternToUTC(
    nextEt.year,
    nextEt.month,
    nextEt.day,
    MARKET_OPEN_HOUR,
    MARKET_OPEN_MINUTE,
  );
}

/** Milliseconds until next likely market open. Returns 0 if market is open. */
export function msUntilLikelyMarketOpen(from?: Date): number {
  const now = from ?? new Date();
  if (isLikelyMarketHours(now)) return 0;
  return Math.max(0, nextLikelyMarketOpen(now).getTime() - now.getTime());
}

// ── MarketStatusChecker (API-based with cache + fallback) ───────────────

export class MarketStatusChecker {
  private readonly rest: ReturnType<typeof restClient>;
  private cachedStatus: MarketSession | null = null;
  private lastCheckTime = 0;
  private readonly cacheTtlMs: number;

  constructor(apiKey: string, cacheTtlMs = 60_000) {
    this.rest = restClient(apiKey);
    this.cacheTtlMs = cacheTtlMs;
  }

  /** Check if the market is currently in session (cached with TTL). */
  async isMarketInSession(): Promise<boolean> {
    const status = await this.getStatus();
    return status.isOpen;
  }

  /** Get full market status (cached with TTL). */
  async getStatus(): Promise<MarketSession> {
    const now = Date.now();
    if (this.cachedStatus && now - this.lastCheckTime < this.cacheTtlMs) {
      return this.cachedStatus;
    }

    try {
      const raw = await this.rest.reference.marketStatus();

      this.cachedStatus = {
        isOpen: raw.market === "open",
        market: raw.market ?? "unknown",
        exchanges: {
          nyse: raw.exchanges?.nyse,
          nasdaq: raw.exchanges?.nasdaq,
          otc: raw.exchanges?.otc,
        },
        serverTime: raw.serverTime ?? new Date().toISOString(),
      };
      this.lastCheckTime = now;

      return this.cachedStatus;
    } catch (error) {
      console.warn(
        `Market status API failed, falling back to static hours check: ${error}`,
      );
      return this.staticFallback();
    }
  }

  /** Force-refresh the cached status. */
  async refresh(): Promise<MarketSession> {
    this.lastCheckTime = 0;
    return this.getStatus();
  }

  private staticFallback(): MarketSession {
    const open = isLikelyMarketHours();
    return {
      isOpen: open,
      market: open ? "open" : "closed",
      exchanges: {
        nyse: open ? "open" : "closed",
        nasdaq: open ? "open" : "closed",
      },
      serverTime: new Date().toISOString(),
    };
  }
}
