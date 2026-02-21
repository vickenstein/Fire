# Phase 1-a — Massive Data Integration

## Overview

Phase 1-a builds the data ingestion layer for Fire: two stream-producing wrapper classes that connect to Massive (formerly Polygon.io) and buffer market data in memory. These are **producers only** — they fetch data and make it available to downstream consumers. No storage or persistence happens in this story.

### Scope

| Component | Data Source | Output |
|---|---|---|
| **S3Fetcher** | Massive S3 flat files (historical) | `ReadableStream<MinuteBar>` |
| **WSClient** | Massive WebSocket (real-time) | `ReadableStream<StockEvent>` |

### What This Story Does NOT Do

- Persist data to any database
- Transform or enrich data (no technical indicators, no derived metrics)
- Write data to QuestDB (or any database)
- Build a consumer/handler — that is the next story

### Provider

**Massive** (formerly Polygon.io, rebranded October 30, 2025). All APIs, SDKs, and endpoints are unchanged — `api.polygon.io` redirects to `api.massive.com`. Starter plan at $29/mo includes REST, S3 flat file access, and WebSocket streaming.

### Credentials

From `.env`:

```
MASSIVE_API_KEY          # REST + WebSocket authentication
MASSIVE_API_ID           # Account identifier
MASSIVE_S3_END_POINT     # https://files.massive.com
MASSIVE_S3_BUCKET        # flatfiles
```

### SDK

`@polygon.io/client-js` — the official JavaScript/TypeScript SDK. Provides:
- `restClient(apiKey)` — REST API access
- `websocketClient(apiKey)` — WebSocket streaming

### Runtime

Bun + TypeScript. Bun provides built-in S3 client, native WebSocket support, gzip decompression (`Bun.gunzipSync`), and sub-second script startup.

---

## Streaming Architecture

Both classes follow the same pattern: **fetch → parse → buffer in memory**.

```
┌─────────────────────────────────────────────────────────────┐
│                        Phase 1-a                            │
│                                                             │
│  S3 Flat Files ──→ S3Fetcher ──→ ReadableStream<MinuteBar>  │──→ (consumer, next story)
│                                                             │
│  WS Feed ──→ WSClient ──→ ReadableStream<StockEvent>        │──→ (consumer, next story)
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

The buffer is a `ReadableStream` (Web Streams API, native in Bun). This provides:
- **Backpressure** — if the consumer is slow, the producer pauses automatically
- **Composability** — streams can be piped, transformed, teed, or consumed with `for await`
- **Standard API** — no custom buffer implementation to maintain

When no consumer is attached, the stream queues data internally up to a configurable high-water mark. S3Fetcher pauses downloading when the queue is full. WSClient logs warnings and drops oldest events if the buffer overflows (real-time data cannot be paused).

---

## File Structure

```
massive/
  package.json                     # @fire/massive, deps: @polygon.io/client-js, @aws-sdk/client-s3
  tsconfig.json                    # ESNext, strict, bun-types
  index.ts                         # Barrel export
  src/
    config.ts                      # Env var loading + validation
    types.ts                       # Shared types (MinuteBar, WS events, etc.)
    s3-fetcher.ts                  # S3Fetcher — streams historical data
    ws-client.ts                   # WSClient — streams real-time data
    utils/
      csv-parser.ts                # Gzip decompress + CSV parse helpers
      date.ts                      # Trading day generation
  tests/
    s3-fetcher.test.ts
    ws-client.test.ts
```

### Dependencies

| Package | Type | Purpose |
|---|---|---|
| `@polygon.io/client-js` | runtime | Official SDK — `websocketClient` for WSClient |
| `@aws-sdk/client-s3` | runtime | S3 access for Massive flat file endpoint |
| `@types/bun` | dev | Bun type definitions |
| `typescript` | dev | Type checking via `bun x tsc --noEmit` |

S3 access uses `@aws-sdk/client-s3` v3 for compatibility with Massive's S3-compatible endpoint.

---

## S3Fetcher

### Purpose

Streams historical 1-minute OHLCV bars from Massive's S3-compatible flat file endpoint into an in-memory `ReadableStream`. Handles downloading, caching, decompressing, and parsing daily CSV files.

### Data Source

Massive exposes historical market data as S3-compatible flat files:

- **Endpoint**: `https://files.massive.com`
- **Bucket**: `flatfiles`
- **Path convention**: `us_stocks_sip/minute_aggs_v1/{YYYY}/{MM}/{YYYY-MM-DD}.csv.gz`

Each daily file is a gzip-compressed CSV containing 1-minute bars for **all** US equity tickers on that trading day. CSV columns (header-driven, parsed dynamically):

```
ticker,volume,open,close,high,low,window_start,transactions
```

`window_start` is epoch nanoseconds.

### Interface

```typescript
class S3Fetcher {
  constructor(options?: {
    endpoint?: string;          // default: env MASSIVE_S3_END_POINT
    bucket?: string;            // default: env MASSIVE_S3_BUCKET
    accessKeyId?: string;       // default: env resolution (see Config)
    secretAccessKey?: string;
    cachePath?: string;         // default: massive/.cache/
  })

  /**
   * Primary streaming interface.
   * Yields MinuteBar objects as each day's file is downloaded, decompressed,
   * and parsed. Iterates over trading days in the date range sequentially,
   * with up to 5 concurrent prefetch downloads.
   */
  stream(options: {
    symbol: string;
    startDate: string;  // YYYY-MM-DD, inclusive
    endDate: string;    // YYYY-MM-DD, inclusive
  }): ReadableStream<MinuteBar>

  /**
   * Single-day convenience method.
   * Downloads one day's file, parses, and returns all bars.
   */
  async fetchDay(date: string, filterSymbol?: string): Promise<MinuteBar[]>

  /**
   * List available flat files under a prefix.
   * Useful for discovering available date ranges.
   */
  async listFiles(prefix: string): Promise<FlatFileInfo[]>
}
```

### Implementation Details

**S3 Client**: `@aws-sdk/client-s3` with custom endpoint:
```typescript
import { S3Client } from "@aws-sdk/client-s3";

new S3Client({
  endpoint: "https://files.massive.com",
  region: "us-east-1",  // required by S3 protocol, Massive ignores it
  credentials: {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
  },
  forcePathStyle: true,
});
```

**Download + cache**: Each `.csv.gz` file is downloaded once and cached locally in `massive/.cache/` (mirroring the S3 key path). Historical data is immutable — cache hits avoid redundant network calls. Cache check uses `Bun.file(path).exists()`.

**Decompression + parsing**: `Bun.gunzipSync(buffer)` → UTF-8 decode → split on newlines → read header row for column indices → filter rows by ticker → map to `MinuteBar` objects. No CSV parsing library needed for this flat schema.

**Streaming**: The `stream()` method creates a `ReadableStream` using `new ReadableStream({ pull })`. Each `pull` call processes the next trading day. Up to 5 days are prefetched concurrently to overlap download with parsing. When the stream's internal queue reaches its high-water mark, `pull` is not called until the consumer drains the buffer.

**Concurrency**: A semaphore (simple counter + promise queue) limits concurrent S3 downloads to 5. Prevents overwhelming the connection on large date range requests.

**Trading days**: The `date.ts` utility generates dates between start and end, excluding weekends. Market holidays are not excluded initially — missing files (holidays) return empty arrays and log a debug message.

### Error Handling

- **Missing credentials**: Constructor throws immediately with message listing unset env vars
- **S3 file not found**: `fetchDay` returns empty array (expected for holidays/weekends), logs debug
- **Network errors**: Wrapped in `S3FetchError` with context (key, date), re-thrown
- **Parse errors**: Malformed CSV rows are skipped with a warning log; does not abort the file
- **Stream errors**: Errors during streaming are forwarded to the stream's error channel (`controller.error()`)

---

## WSClient

### Purpose

Streams real-time market events from Massive's WebSocket API into an in-memory `ReadableStream`. Handles connection lifecycle, authentication, subscriptions, and automatic reconnection.

### Data Source

Massive/Polygon WebSocket API via the `@polygon.io/client-js` SDK:
- `websocketClient(apiKey)` → `.stocks()` for US equity streams
- Authentication is handled automatically by the SDK on connect
- Channel format: `AM.AAPL` (minute aggs), `T.MSFT` (trades), `Q.GOOG` (quotes), `AM.*` (all)

### Interface

```typescript
class WSClient {
  constructor(options?: {
    apiKey?: string;                 // default: env MASSIVE_API_KEY
    baseUrl?: string;               // default: wss://delayed.massive.com
    maxReconnectAttempts?: number;   // default: 10
    reconnectBaseDelay?: number;     // default: 1000 (ms)
  })

  /** Current connection state */
  get connectionState(): ConnectionState

  /** Currently active subscriptions */
  get activeSubscriptions(): ReadonlySet<string>

  /**
   * Primary streaming interface.
   * Connects, subscribes to channels, and returns a stream of events.
   * Stream stays open until disconnect() is called.
   */
  stream(channels: string | string[]): ReadableStream<StockEvent>

  /**
   * Connect to Massive WebSocket. Resolves when authenticated.
   */
  async connect(): Promise<void>

  /**
   * Gracefully disconnect. Closes socket, clears subscriptions.
   */
  async disconnect(): Promise<void>

  /**
   * Subscribe to channels. Can be called before or after connect.
   */
  subscribe(channels: string | string[]): void

  /**
   * Unsubscribe from channels.
   */
  unsubscribe(channels: string | string[]): void

  /**
   * Register typed event handler (alternative to stream interface).
   * Returns unsubscribe function.
   */
  on(eventType: 'AM' | 'T' | 'Q', handler: (event: StockEvent) => void): () => void

  /** Register handler for all events */
  onAny(handler: (event: StockEvent) => void): () => void

  /** Register error handler */
  onError(handler: (error: Error) => void): () => void

  /** Register connection state change handler */
  onStateChange(handler: (state: ConnectionState) => void): () => void
}
```

### Implementation Details

**Connection**: Uses `websocketClient(apiKey).stocks()` from the SDK. The SDK sends the auth message automatically on connect. The `connect()` method returns a Promise that resolves on `auth_success` status or rejects on `auth_failed` / timeout (10s).

**Event dispatch**: Incoming messages are JSON-parsed. Each message has an `ev` field discriminating the event type (`T`, `Q`, `AM`, `A`, `status`). Messages are dispatched to:
1. The `ReadableStream` controller (if `stream()` was called)
2. Typed event handlers registered via `on()`
3. The firehose handler registered via `onAny()`

**Reconnection**: On unexpected close, exponential backoff kicks in:
- Base delay: 1 second
- Multiplier: 2x per attempt
- Jitter: 20% random
- Max attempts: 10 (configurable)
- After reconnect: all subscriptions in `activeSubscriptions` are replayed automatically

**State machine**:
```
DISCONNECTED ──connect()──→ CONNECTING ──auth_success──→ AUTHENTICATED
                                                              │
                                                     onclose (unexpected)
                                                              │
                                                              ▼
                                                        RECONNECTING
                                                              │
                                                     success ──→ AUTHENTICATED
                                                     max attempts ──→ DISCONNECTED
```

**Buffer overflow**: If the consumer is slow, the `ReadableStream` queues events up to the high-water mark. Beyond that, oldest events are dropped and a warning is logged with the count of dropped events. Real-time data cannot be paused — the WebSocket will keep sending regardless.

### Error Handling

- **Auth failure**: Clear error message on `connect()` rejection
- **Connection loss**: Automatic reconnection with backoff; `onStateChange` fires on each transition
- **Handler errors**: Each handler is wrapped in try/catch; errors are routed to `onError` handlers
- **Parse errors**: Malformed WebSocket messages are logged and skipped
- **Max reconnect exceeded**: Emits error, transitions to DISCONNECTED, stream closes

---

## Shared Types

```typescript
/** A single 1-minute OHLCV bar */
interface MinuteBar {
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  windowStart: number;     // epoch nanoseconds
  timestamp: Date;         // parsed from windowStart
  transactions: number;
}

/** Options for S3Fetcher.stream() and fetchBars() */
interface FetchBarsOptions {
  symbol?: string;         // optional — omit for full-universe (all tickers in each daily file)
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
}

/** S3 file metadata */
interface FlatFileInfo {
  key: string;
  size: number;
  lastModified: Date;
}

/** Real-time trade event */
interface TradeEvent {
  ev: 'T';
  sym: string;
  p: number;    // price
  s: number;    // size
  t: number;    // timestamp (ms)
  c: number[];  // conditions
}

/** Real-time quote event */
interface QuoteEvent {
  ev: 'Q';
  sym: string;
  bp: number;   // bid price
  bs: number;   // bid size
  ap: number;   // ask price
  as: number;   // ask size
  t: number;    // timestamp (ms)
}

/** Real-time minute aggregate event */
interface MinuteAggEvent {
  ev: 'AM';
  sym: string;
  o: number;    // open
  h: number;    // high
  l: number;    // low
  c: number;    // close
  v: number;    // volume
  s: number;    // start timestamp (ms)
  e: number;    // end timestamp (ms)
}

/** Union of all WebSocket stock events */
type StockEvent = TradeEvent | QuoteEvent | MinuteAggEvent;

/** Connection states */
enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  AUTHENTICATED = 'AUTHENTICATED',
  RECONNECTING = 'RECONNECTING',
}
```

---

## Configuration

```typescript
/** Load and validate all Massive env vars */
function loadConfig(): MassiveConfig

/** Resolve S3 credentials with fallback chain:
 *  1. MASSIVE_S3_ACCESS_KEY_ID + MASSIVE_S3_SECRET_ACCESS_KEY (explicit)
 *  2. MASSIVE_API_KEY + MASSIVE_API_ID (fallback — needs validation)
 */
function loadS3Credentials(): S3Credentials
```

---

## Implementation Sequence

| Step | What | Validates |
|---|---|---|
| 1 | Scaffold: `package.json`, `tsconfig.json`, `bun install`, directory structure | Bun project compiles |
| 2 | `types.ts` + `config.ts` + config tests | Env loading works |
| 3 | S3Fetcher: `stream()`, `fetchDay()`, cache, CSV parsing | S3 credentials work, data parses correctly |
| 4 | WSClient: `stream()`, `connect()`, subscribe, events | WebSocket auth + streaming works |
| 5 | WSClient resilience: reconnection, state machine | Reconnection logic |
| 6 | Unit + integration tests | All paths covered |

---

## Boundary with Next Story

This story delivers **stream producers with in-memory buffers**. The next story attaches a consumer that:
- Drains the `ReadableStream<MinuteBar>` and `ReadableStream<StockEvent>`
- Writes to QuestDB via ILP protocol

The interface contract between stories:
```typescript
// Consumer receives these streams from Phase 1-a
const historicalStream: ReadableStream<MinuteBar> = s3Fetcher.stream({ ... });
const realtimeStream: ReadableStream<StockEvent> = wsClient.stream(['AM.*']);
```

---

## Open Questions

1. **S3 credential mapping**: Does `MASSIVE_API_KEY` work as the S3 Access Key ID, or does Massive require separate S3 credentials from the dashboard? Validated during Step 3.

2. **CSV column order**: The assumed order (`ticker,volume,open,close,high,low,window_start,transactions`) for `minute_aggs_v1` is based on `day_aggs_v1` examples. The parser reads the header row dynamically to handle deviations.

3. **Daily file size**: Each day's file contains all US equity tickers (~8000+). Compressed size is estimated at 50–100 MB. For a 500-symbol universe, ~95% of data is filtered out client-side. This is acceptable for bulk backfill with caching. For incremental daily updates, the REST API may be more efficient.
