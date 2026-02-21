import type { OrchestratorConfig } from "./types";

export function loadOrchestratorConfig(): OrchestratorConfig {
  return {
    backfillStartDate: process.env.BACKFILL_START_DATE ?? "2020-01-02",
    wsChannels: process.env.WS_CHANNELS
      ? process.env.WS_CHANNELS.split(",").map((c) => c.trim())
      : ["AM.*"],
    marketCheckIntervalMs:
      Number(process.env.MARKET_CHECK_INTERVAL_MS) || 30_000,
    marketStatusCacheTtlMs:
      Number(process.env.MARKET_STATUS_CACHE_TTL_MS) || 60_000,
    dbHealthTimeoutMs: Number(process.env.DB_HEALTH_TIMEOUT_MS) || 60_000,
  };
}
