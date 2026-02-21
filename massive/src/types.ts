/** A single 1-minute OHLCV bar */
export interface MinuteBar {
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  windowStart: number; // epoch nanoseconds
  timestamp: Date;
  transactions: number;
}

/** Real-time trade event */
export interface TradeEvent {
  ev: "T";
  sym: string;
  p: number; // price
  s: number; // size
  t: number; // timestamp (ms)
  c: number[]; // conditions
}

/** Real-time quote event */
export interface QuoteEvent {
  ev: "Q";
  sym: string;
  bp: number; // bid price
  bs: number; // bid size
  ap: number; // ask price
  as: number; // ask size
  t: number; // timestamp (ms)
}

/** Real-time minute aggregate event */
export interface MinuteAggEvent {
  ev: "AM";
  sym: string;
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
  s: number; // start timestamp (ms)
  e: number; // end timestamp (ms)
}

/** Union of all WebSocket events */
export type StockEvent = TradeEvent | QuoteEvent | MinuteAggEvent;

/** Options for S3Fetcher.stream() */
export interface FetchBarsOptions {
  symbol?: string; // undefined = all tickers
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

/** S3 file metadata */
export interface FlatFileInfo {
  key: string;
  size: number;
  lastModified: Date;
}

/** Connection states for WSClient */
export enum ConnectionState {
  DISCONNECTED = "DISCONNECTED",
  CONNECTING = "CONNECTING",
  AUTHENTICATED = "AUTHENTICATED",
  RECONNECTING = "RECONNECTING",
}
