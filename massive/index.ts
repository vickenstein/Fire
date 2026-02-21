// @fire/massive barrel export

// Types
export type {
  MinuteBar,
  TradeEvent,
  QuoteEvent,
  MinuteAggEvent,
  StockEvent,
  FetchBarsOptions,
  FlatFileInfo,
} from "./src/types";
export { ConnectionState } from "./src/types";

// Config
export { loadMassiveConfig } from "./src/config";
export type { MassiveConfig } from "./src/config";

// Date utilities
export { getTradingDays, formatDate } from "./src/utils/date";

// S3Fetcher — streams historical data from Massive S3 flat files
export { S3Fetcher } from "./src/s3-fetcher";

// WSClient — streams real-time data from Massive WebSocket
export { WSClient } from "./src/ws-client";
export type { WSClientOptions } from "./src/ws-client";
