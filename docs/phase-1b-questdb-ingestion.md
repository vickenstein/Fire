# Phase 1b: QuestDB Ingestion

## Context

Phase 1a produces two `ReadableStream` producers (`S3Fetcher` → `ReadableStream<MinuteBar>`, `WSClient` → `ReadableStream<StockEvent>`) but does not persist, transform, or index any data. Phase 1b builds the consumer layer: QuestDB tables with dedup-safe schemas, an ILP-based writer that drains phase-1a streams, and a daily aggregator that rolls minute bars into daily bars during ingestion.

---

## Indicator Strategy: Client-Side Computation

The original design pre-computed 5 indicators (RSI, MACD, ATR) at ingestion and stored them alongside OHLCV data. This was reversed during implementation — indicator columns were added to `minute_bars` then dropped (see `dropIndicatorColumns` migration in `tables.ts`).

**Current approach**: ALL indicators are computed client-side in the web UI using `trading-signals`:
- **RSI (14)** — `FasterRSI(14)`
- **MACD (12, 26, 9)** — `FasterMACD(EMA(12), EMA(26), EMA(9))` → line, signal, histogram
- **ATR (14)** — `FasterATR(14)`
- **Warmup**: 40 bars (MACD bottleneck: 26 + 9 - 1 = 34, rounded up)

**Rationale**: QuestDB lacks Elasticsearch's `moving_fn` pipeline aggregations, making the original "some stored / some query-time" split irrelevant. Computing in the browser is simpler, eliminates storage overhead, and the `trading-signals` streaming API with `isStable()` guards makes client-side computation clean.

**Impact**: Zero indicator fields in QuestDB. Only raw OHLCV data is stored.

---

## Ticker Metadata Strategy

### Source: Polygon REST API (via Massive subscription)

Ticker Details endpoint (`/v3/reference/tickers/{ticker}`) provides:
- Company name, SIC code/description (sector/industry proxy)
- Exchange, market cap, outstanding shares
- CIK number, locale, currency, active status

### Storage: Separate `ticker_metadata` table

**NOT denormalized into time series tables.** Rationale:
- Metadata is static (changes rarely — corporate renames, sector reclassifications)
- Denormalizing adds ~100 bytes per minute bar x millions of bars = significant bloat
- Updates would require rewriting all historical bars for that ticker
- The web UI does application-side joins trivially

### MetadataFetcher + MetadataSync

```typescript
class MetadataFetcher {
  /** Fetch metadata for a single ticker from Polygon REST API */
  async fetchOne(ticker: string): Promise<TickerMetadata>
  /** Fetch metadata for multiple tickers, sequentially with rate limiting */
  async fetchMany(tickers: string[]): Promise<TickerMetadata[]>
}

class MetadataSync {
  /** Fetch tickers from Polygon REST and write to QuestDB via ILP */
  async sync(tickers: string[]): Promise<void>
  /** Read all metadata from QuestDB */
  async getAll(): Promise<TickerMetadata[]>
}
```
- Rate-limited (250ms delay between requests)
- Writes via ILP to `ticker_metadata` table
- Run via CLI: `bun run --cwd questdb sync-metadata` with `--tickers AAPL,MSFT,...`

---

## QuestDB Architecture

### Tables

**`minute_bars`** — Raw 1-minute OHLCV data
```sql
CREATE TABLE IF NOT EXISTS minute_bars (
  ticker SYMBOL CAPACITY 8192,
  timestamp TIMESTAMP,
  open DOUBLE,
  high DOUBLE,
  low DOUBLE,
  close DOUBLE,
  volume LONG,
  transactions INT
) TIMESTAMP(timestamp) PARTITION BY MONTH
DEDUP UPSERT KEYS(timestamp, ticker);
```

**`daily_bars`** — Pre-aggregated daily OHLCV
```sql
CREATE TABLE IF NOT EXISTS daily_bars (
  ticker SYMBOL CAPACITY 8192,
  timestamp TIMESTAMP,
  open DOUBLE,
  high DOUBLE,
  low DOUBLE,
  close DOUBLE,
  volume LONG
) TIMESTAMP(timestamp) PARTITION BY YEAR
DEDUP UPSERT KEYS(timestamp, ticker);
```
Populated two ways:
1. **During backfill**: `DailyAggregator` accumulates minute bars in memory, flushes completed days via ILP
2. **One-time migration**: `INSERT INTO daily_bars SELECT ... FROM minute_bars SAMPLE BY 1d ALIGN TO CALENDAR`

**`ticker_metadata`** — Company/sector information
```sql
CREATE TABLE IF NOT EXISTS ticker_metadata (
  ticker SYMBOL CAPACITY 8192,
  name STRING,
  sic_code STRING,
  sic_description STRING,
  exchange STRING,
  market_cap LONG,
  shares_outstanding LONG,
  cik STRING,
  locale STRING,
  currency STRING,
  active BOOLEAN,
  updated_at TIMESTAMP
) TIMESTAMP(updated_at) PARTITION BY YEAR
DEDUP UPSERT KEYS(updated_at, ticker);
```

### QuestDB Client (PgWire)

Uses `Bun.sql` (built-in PostgreSQL client, imported as `SQL` from `"bun"`) connecting to QuestDB's PgWire endpoint on port 8812.

```typescript
class QuestDBClient {
  async health(): Promise<{ status: string }>         // SELECT 1
  async getLatestTimestamp(): Promise<Date | null>     // SELECT max(timestamp) FROM minute_bars
  async execute(query: string): Promise<void>          // DDL / DML
  async query<T>(query: string): Promise<T[]>          // SELECT queries
  async close(): Promise<void>
}
```

---

## ILPWriter

Replaces the Elasticsearch BulkWriter. Uses `@questdb/nodejs-client` `Sender` class with TCP ILP protocol for high-throughput ingestion.

### Connection
```typescript
const sender = await Sender.fromConfig(
  `tcp::addr=${host}:${port};init_buf_size=4194304;`
);
```
4MB initial buffer. Lazy initialization — TCP connection created on first write.

### Batching Configuration
| Config | Backfill (S3) | Live (WS) |
|--------|--------------|-----------|
| `autoFlushRows` | 10,000 | 500 |
| `autoFlushIntervalMs` | 0 (batch-full only) | 500 |

### Error Handling
- **Flush timeout**: 30s max wait per flush
- **On flush error**: Tears down broken sender, creates fresh TCP connection on next write
- **Tracking**: `rowsWritten` and `rowsErrored` counters
- **Event loop yield**: 1ms `setTimeout` after each flush to let TCP drain events process, preventing unbounded socket write buffer growth

---

## Handler Architecture

```
Phase 1a                       Phase 1b (questdb/)
┌──────────────┐    pipeTo    ┌──────────────────┐    ILP    ┌────────────┐
│  S3Fetcher   │─────────────>│ MinuteBarHandler  │─────────>│  ILPWriter │──> QuestDB
│  .stream()   │              │  (WritableStream)  │          └────────────┘
└──────────────┘              │  + DailyAggregator │
                              └──────────────────┘

┌──────────────┐  TransformStream ┌──────────────────┐
│  WSClient    │  MinuteAggEvent  │ MinuteBarHandler  │──> ILPWriter ──> QuestDB
│  .stream()   │──> MinuteBar ───>│  (WritableStream)  │
└──────────────┘                  └──────────────────┘

┌──────────────┐              ┌──────────────────┐
│ Polygon REST │─────────────>│  MetadataSync     │──> ILPWriter ──> QuestDB
│  /v3/ref/... │              │  + MetadataFetcher│
└──────────────┘              └──────────────────┘
```

**Backpressure**: `ReadableStream.pipeTo(WritableStream)` — when ILPWriter's flush blocks, handler blocks, stream pauses producer automatically.

### MinuteBarHandler

A `WritableStream<MinuteBar>` consumer. For each bar:
1. Writes directly to ILP Sender's internal buffer (zero intermediate objects): table, symbol, float/int columns, timestamp
2. Updates `DailyAggregator` with the bar
3. Calls `flushCompleted()` to write any completed daily bars
4. Calls `maybeFlush()` to trigger ILP flush if batch threshold reached

On stream close: flushes all remaining daily accumulators (including in-progress day).

### DailyAggregator

Maintains a `Map<string, DailyAccum>` keyed by `${ticker}:${date}`:
- **First bar of day**: Sets open, high, low, close, volume
- **Subsequent bars**: Updates high (max), low (min), close (last), volume (sum)
- **Date advances**: Completed days (date < currentDate) flushed to `daily_bars` via ILP
- **Stream close**: All accumulators flushed (including partial in-progress day)

### Live Path: MinuteAggEvent → MinuteBar Transform

The live path uses a `TransformStream` to convert WSClient's `MinuteAggEvent` to `MinuteBar`:
```typescript
const transform = new TransformStream<MinuteAggEvent, MinuteBar>({
  transform(event, controller) {
    controller.enqueue({
      ticker: event.sym,
      open: event.o, high: event.h, low: event.l, close: event.c,
      volume: event.v,
      windowStart: event.s * 1_000_000,  // ms → ns
      timestamp: new Date(event.s),
      transactions: 0,
    });
  },
});
await stream.pipeThrough(transform).pipeTo(handler.writable());
```

No separate `StockEventHandler` for trades/quotes — only minute aggregate events (`AM.*`) are consumed.

---

## Pipeline

Top-level orchestration class with four methods:

```typescript
class Pipeline {
  async setup(): Promise<void>
  // Health check + CREATE TABLE IF NOT EXISTS for all 3 tables

  async runBackfill(stream: ReadableStream<MinuteBar>): Promise<Stats>
  // S3Fetcher stream → MinuteBarHandler → ILPWriter (backfill config)
  // Logs progress every 5s: rows indexed, current/avg rate, current date

  async runLive(stream: ReadableStream<MinuteAggEvent>): Promise<Stats>
  // WSClient stream → TransformStream → MinuteBarHandler → ILPWriter (live config)

  async syncMetadata(tickers: string[]): Promise<void>
  // MetadataFetcher → MetadataSync → ILPWriter → ticker_metadata
}
```

CLI entrypoint:
```bash
bun run questdb/src/pipeline.ts --setup                          # Create tables
bun run questdb/src/pipeline.ts --sync-metadata --tickers A,B,C  # Fetch/index metadata
```

Backfill and live modes require importing `Pipeline` programmatically and passing a `ReadableStream` from `@fire/massive`.

---

## Directory Structure

```
questdb/
  package.json                         # @fire/questdb, deps: @questdb/nodejs-client, @fire/massive
  tsconfig.json
  index.ts                             # Barrel export
  src/
    config.ts                          # QuestDB connection + pipeline config from env
    types.ts                           # QuestDBConfig, ILPWriterConfig, PipelineConfig, TickerMetadata
    client.ts                          # Bun.sql PgWire client (health, query, DDL)
    ilp-writer.ts                      # ILP Sender: TCP batching, flush timeout, reconnect
    dead-letter.ts                     # Failed doc persistence (ndjson)
    tables.ts                          # DDL for minute_bars, daily_bars, ticker_metadata + migrations
    pipeline.ts                        # Top-level: setup(), runBackfill(), runLive(), syncMetadata()
    handlers/
      minute-bar-handler.ts            # WritableStream consumer for MinuteBar
      daily-aggregator.ts              # In-memory OHLCV accumulator for daily_bars
    metadata/
      metadata-fetcher.ts              # Polygon REST API client for ticker details
      metadata-sync.ts                 # Bulk sync: fetch tickers → write to QuestDB via ILP
```

---

## Docker (QuestDB)

```yaml
# In docker-compose.yml at project root
services:
  questdb:
    image: questdb/questdb:8.2.3
    ports:
      - "9000:9000"   # Web Console + REST
      - "9009:9009"   # ILP ingestion
      - "8812:8812"   # PGWire queries
    volumes:
      - questdb-data:/var/lib/questdb
    environment:
      - QDB_LOG_W_STDOUT_LEVEL=ERROR
      - QDB_PG_USER=admin
      - QDB_PG_PASSWORD=quest
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9000 || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 30

volumes:
  questdb-data:
```

---

## Env Vars

```
QUESTDB_ILP_HOST=localhost        # ILP ingestion endpoint
QUESTDB_ILP_PORT=9009
QUESTDB_PG_HOST=localhost         # PgWire query endpoint
QUESTDB_PG_PORT=8812
QUESTDB_PG_USER=admin
QUESTDB_PG_PASSWORD=quest
MASSIVE_API_KEY=...               # For metadata fetcher (Polygon REST API)
```

---

## Verification Plan

1. `docker compose up questdb` — QuestDB running, web console at `localhost:9000`
2. `bun run setup:questdb` — tables created (minute_bars, daily_bars, ticker_metadata)
3. Verify in QuestDB console: `SHOW TABLES` shows 3 tables; `SELECT count() FROM minute_bars`
4. `bun run sync-metadata` with `--tickers AAPL,MSFT,GOOGL` — fetches from Polygon REST, indexes metadata
5. Verify: `SELECT * FROM ticker_metadata` — shows name, sic_code, exchange
6. Backfill a sample: programmatic call to `Pipeline.runBackfill()` with S3Fetcher stream for AAPL, 4 days
7. Verify: `SELECT count() FROM minute_bars WHERE ticker = 'AAPL'` — has bars; `SELECT * FROM daily_bars WHERE ticker = 'AAPL'` — daily aggregates present
8. Idempotency: re-run backfill — row count unchanged (DEDUP UPSERT handles duplicates)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| ILP TCP connection drops during long backfill | `resetSender()` tears down broken connection; next write creates fresh TCP connection |
| DailyAggregator memory for full-universe backfill | Map only holds in-progress day's accumulators per ticker; completed days flushed immediately |
| QuestDB PgWire compatibility with Bun.sql | Using `sql.unsafe()` for DDL/queries; tested and working |
| Massive REST rate limits for metadata sync | Sequential fetch with 250ms delay; only ~500 tickers, run once |
| ILP flush timeout (30s) on large batches | Batch size tuned to 10k rows; 1ms event loop yield after each flush prevents buffer overrun |
