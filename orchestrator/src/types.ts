export enum OrchestratorState {
  INITIALIZING = "INITIALIZING",
  BACKFILLING = "BACKFILLING",
  LIVE = "LIVE",
  IDLE = "IDLE",
  ERROR = "ERROR",
}

export enum SchedulerEvent {
  MARKET_OPEN = "MARKET_OPEN",
  MARKET_CLOSE = "MARKET_CLOSE",
}

export interface MarketSession {
  /** NYSE is currently open for regular trading */
  isOpen: boolean;
  /** "open" | "closed" | "extended-hours" | "early-hours" */
  market: string;
  exchanges: {
    nyse?: string;
    nasdaq?: string;
    otc?: string;
  };
  serverTime: string;
}

export interface GapInfo {
  /** Latest timestamp found in QuestDB, or null if no data */
  latestTimestamp: Date | null;
  /** YYYY-MM-DD to start backfilling from */
  backfillStartDate: string;
  /** YYYY-MM-DD to backfill through (typically yesterday) */
  backfillEndDate: string;
  /** Whether there is missing data to fetch */
  hasGap: boolean;
  /** Whether backfill is current enough to start live streaming */
  isCaughtUp: boolean;
}

export interface OrchestratorConfig {
  /** Date to start backfill from if QuestDB is empty (YYYY-MM-DD) */
  backfillStartDate: string;
  /** WebSocket channels to subscribe to */
  wsChannels: string[];
  /** Market status polling interval (ms) */
  marketCheckIntervalMs: number;
  /** Cache TTL for market status API responses (ms) */
  marketStatusCacheTtlMs: number;
  /** Max wait for QuestDB to become healthy on startup (ms) */
  dbHealthTimeoutMs: number;
}
