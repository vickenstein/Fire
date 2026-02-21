// Re-export types from @fire/massive (single source of truth)
export type {
  MinuteBar,
  MinuteAggEvent,
  StockEvent,
} from "@fire/massive";

// ─── QuestDB config types ───

export interface QuestDBConfig {
  ilp: {
    host: string;
    port: number;
  };
  pg: {
    host: string;
    port: number;
    user: string;
    password: string;
  };
}

export interface ILPWriterConfig {
  /** Auto-flush after this many rows */
  autoFlushRows: number;
  /** Auto-flush after this interval (ms). 0 = disabled (flush on row count only) */
  autoFlushIntervalMs: number;
}

export interface PipelineConfig {
  questdb: QuestDBConfig;
  ilp: {
    backfill: ILPWriterConfig;
    live: ILPWriterConfig;
  };
  massive: {
    apiKey: string;
  };
}

// ─── Metadata types ───

export interface TickerMetadata {
  ticker: string;
  name: string;
  sic_code: string;
  sic_desc: string;
  exchange: string;
  market_cap: number;
  shares_out: number;
  cik: string;
  locale: string;
  currency: string;
  active: boolean;
  updated_at: string;
}
