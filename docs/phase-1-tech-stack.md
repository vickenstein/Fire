# Phase 1 — Data Foundation: Tech Stack

## What Phase 1 Must Deliver

From the roadmap: stand up the data pipeline, ingest market data with intraday granularity, store it in a queryable format optimized for time-series analysis, and establish a single pipeline that serves both research and live operation.

Concrete requirements:
- **Ingest** 1-minute OHLCV bars for US equities (500+ symbols)
- **Store** 3–5 years of historical data plus ongoing daily updates
- **Query** by symbol, time range, and aggregation interval (1-min → 5-min → daily)
- **Serve** the same data and interface for backtesting research and live signal generation
- **Run locally** on Apple Silicon Mac (32GB+ RAM) — no cloud hosting
- **Compute** technical indicators (RSI, MACD, ATR) for chart rendering
- **Prefer** Bun + TypeScript for the application layer

---

## Decision: Actual Technology Stack

After evaluating the options below, the following stack was selected and implemented:

| Layer | Technology | Details |
|---|---|---|
| **Data Provider** | Massive (Polygon.io) Starter | $29/mo, `@polygon.io/client-js` v7.4.0 |
| **Storage** | QuestDB 8.2.3 | Docker, ILP ingestion on :9009, PgWire queries on :8812 |
| **Ingestion** | `@questdb/nodejs-client` | TCP ILP protocol, 10k rows/flush backfill, 500 rows/flush live |
| **Queries** | `Bun.sql` (built-in) | Native PostgreSQL client over QuestDB's PgWire endpoint |
| **Web UI** | Hono + React 19 + Lightweight Charts | 3-pane chart (candles+volume, RSI, MACD), Vite 6, Tailwind CSS |
| **Indicators** | `trading-signals` v6.1 | Computed client-side in the browser (RSI 14, MACD 12/26/9, ATR 14) |
| **Runtime** | Bun + TypeScript 5.7 | Workspace monorepo: massive, questdb, orchestrator, web |
| **Deployment** | Docker Compose | QuestDB + orchestrator + web — single `docker compose up` |

**Key decision**: QuestDB was selected over Elasticsearch for its native `SAMPLE BY` syntax (ideal for OHLCV aggregation), fastest ILP ingestion for bulk backfill of 246M+ rows, and lightweight ~1-2 GB RAM footprint. Visualization is handled by a custom web UI using Lightweight Charts rather than Kibana or Grafana. Technical indicators are computed client-side rather than pre-enriched at ingestion — this simplifies the storage layer and avoids indicator staleness issues.

---

## Data Providers: Massive vs Alpaca

### Head-to-Head

|  | Massive Starter | Alpaca Free | Alpaca Algo Trader Plus |
|---|---|---|---|
| **Monthly cost** | $29 | $0 | $99 |
| **Historical depth** | 5 years | 7+ years | 7+ years |
| **Granularity** | 1-min bars | 1-min bars | 1-min bars |
| **Exchange coverage** | Full SIP (all 19 US exchanges + dark pools) | IEX only (~2% of market volume) | Full SIP |
| **Data latency** | 15-minute delayed | 15-min delayed (SIP), real-time (IEX) | Real-time |
| **REST rate limits** | Unlimited (soft cap at 100 req/sec) | 200 req/min | 10,000 req/min |
| **WebSocket** | Not included (requires Developer @ $79/mo) | 30 symbol limit | Unlimited |
| **TypeScript SDK** | `@polygon.io/client-js` v7.4.0 — solid, actively maintained, isomorphic | `@alpacahq/typescript-sdk` v0.0.32-preview — functional but not production-stable | Same |
| **Programmatic trading** | No | Yes | Yes |
| **Parent company** | Massive (formerly Polygon.io, rebranded Oct 2025) | Alpaca Markets | Alpaca Markets |

### Massive (formerly Polygon.io)

Polygon.io rebranded to Massive.com on October 30, 2025. All APIs, SDKs, and endpoints continue to work — `api.polygon.io` redirects to `api.massive.com`. The data, infrastructure, and team are unchanged.

**What the Starter plan provides:**
- REST access to aggregate bars (minute, hour, day, week, month) for all US equities
- Full SIP coverage — consolidated tape from all 19 US stock exchanges plus FINRA dark pool prints
- 5 years of historical intraday data for backfill
- Reference data: tickers, company details, splits, dividends, financials
- Snapshots: current quotes across all tickers (15-min delayed)
- Technical indicators via API

**What it does not provide:**
- Real-time data (15-minute delay on Starter)
- WebSocket streaming (requires Developer tier at $79/mo)
- Second-level or tick-level data (requires Developer or Advanced)

**SDK (`@polygon.io/client-js` v7.4.0):**
- Covers REST and WebSocket APIs
- Types auto-generated from OpenAPI spec — TypeScript support is strong
- Isomorphic (works in browser, Node, and Bun)

**Upgrade path:** When Phase 1 is complete and real-time data becomes necessary, upgrading to Developer ($79/mo) adds WebSocket streaming and second-level aggregates. The API surface is the same — no code changes required beyond enabling the WebSocket client.

### Alpaca

Alpaca is primarily a brokerage that also provides market data. They discontinued their Polygon data-sharing agreement in 2021; market data now comes from Alpaca's own infrastructure.

**Free tier limitations:**
- Intraday data is sourced from IEX exchange only (~2% of total US market volume)
- Volume figures are unreliable for analysis because they reflect IEX trades only, not the full market
- Prices are generally accurate for price discovery but spread/depth data is incomplete
- 200 API requests per minute — sufficient for small universes but tight for bulk backfill of 500+ symbols
- WebSocket limited to 30 simultaneous symbol subscriptions

**Algo Trader Plus ($99/mo):**
- Full SIP data (all US exchanges, consolidated tape)
- True real-time streaming via WebSocket
- 10,000 API requests per minute
- Unlimited WebSocket subscriptions
- If you ever want to route trades through Alpaca instead of Robinhood, having data + execution on the same platform simplifies the architecture

**SDK (`@alpacahq/typescript-sdk`):**
- Version 0.0.32-preview — the version number signals this is not production-stable
- Zero external dependencies, TypeScript-first, ESM/CJS dual format
- REST + WebSocket support for market data and trading
- Alpaca has stated in some places that the SDK is "no longer in development," creating uncertainty about its long-term trajectory
- The older `@alpacahq/alpaca-trade-api` package is more battle-tested but lacks TypeScript-native types

### Other Providers Considered

| Provider | Why it falls short |
|---|---|
| **yfinance** | Only 30 days of 1-min history. Unofficial scraping-based API — Yahoo broke it for weeks in Feb 2025. Not viable for production. |
| **Tiingo ($30/mo)** | Intraday data is IEX-only (same limitation as Alpaca free). Excellent for EOD daily data but insufficient for intraday volume analysis. |
| **Alpha Vantage ($50/mo)** | 75 req/min at entry tier. Requires a separate "data entitlement process" to activate real-time feeds. Overpriced for what it delivers. |
| **Twelve Data ($79/mo)** | Only 1–2 years of intraday historical depth. Credit-based pricing creates unpredictable costs across 500+ symbols. |

### Data Provider Verdict

For Phase 1 with 15-minute delayed data acceptable:

- **Massive Starter ($29/mo)** delivers the best value: full SIP coverage, 5 years of 1-min history, unlimited API calls, and a mature TypeScript SDK. The 15-minute delay is irrelevant for historical backfill and acceptable for Phase 1 signal development.
- **Alpaca Free ($0)** is viable for prototyping but IEX-only data means volume analysis is unreliable. Worth using as a secondary/validation source.
- **Alpaca Algo Trader Plus ($99/mo)** becomes the comparison point when real-time data is needed in later phases — $99 for full SIP real-time vs Massive Developer at $79 for the same capability.

---

## Storage Options Compared

The data layer needs to store ~246 million rows (500 stocks × 390 minutes/day × 252 trading days/year × 5 years) of pre-enriched, denormalized OHLCV documents. On disk, this is roughly 3–6 GB compressed (Parquet) or 8–15 GB in a database with indexes.

Four contenders, each evaluated on the same criteria.

### Comparison Table

|  | Elasticsearch | DuckDB + Parquet | QuestDB | TimescaleDB |
|---|---|---|---|---|
| **Architecture** | Distributed search/analytics engine (Lucene-based, JVM) | Embedded analytical DB (in-process, no server) | Purpose-built time-series DB (Java, off-heap memory) | PostgreSQL extension |
| **RAM (idle)** | 4–8 GB (JVM heap) | ~0 (embedded) | 1–2 GB | 0.5–1 GB |
| **Setup** | `docker compose up` (ES + Kibana) | `bun add duckdb` — no server | Docker or standalone JAR | Docker or Homebrew |
| **OHLCV queries** | date_histogram + sub-aggs (first, last, min, max, sum) | Standard SQL with `date_trunc()` | `SAMPLE BY` native syntax | `time_bucket()` function |
| **VWAP** | Scripted aggregation or pre-compute at ingestion | Standard SQL | `SAMPLE BY` with aggregation | Standard SQL |
| **Vector search** | Native kNN (dense_vector field type) | Not available | Not available | Via pgvector extension |
| **Full-text search** | Core capability (inverted index, BM25) | Basic LIKE/regex | Not available | Via pg_trgm or full-text search |
| **Built-in UI** | Kibana (free, powerful dashboards, Lens, Discover) | None | Web console (basic) | None |
| **Visualization** | Kibana dashboards, Canvas, Lens | Requires separate tool | Grafana (separate install) | Grafana (separate install) |
| **Denormalized docs** | Native fit — document store by design | Tables or nested structs | Flat rows | Relational tables |
| **Concurrent access** | Multi-reader, multi-writer | Single-writer limitation | Multi-reader, multi-writer | Multi-reader, multi-writer |
| **Storage efficiency** | TSDS mode: ~0.9 bytes/data point with multi-metric docs | Parquet: columnar compression, very efficient | Columnar, append-optimized | 10–20x compression on older chunks |
| **Ingestion throughput** | Good (bulk API) | Good (batch inserts) | Fastest (ILP protocol) | Good (COPY or batch INSERT) |

### Elasticsearch

Elasticsearch is a distributed search and analytics engine. Since 8.x, it includes Time Series Data Streams (TSDS) specifically designed for metrics and time-series workloads, and dense vector fields for kNN similarity search.

**Strengths for this architecture:**

*Single unified system.* Elasticsearch handles OHLCV time-series, full-text search (earnings transcripts, news, SEC filings), and vector similarity search (embeddings for sentiment analysis) in one deployment. No need to manage multiple storage systems or synchronize data between them.

*Denormalized documents are the native data model.* Pre-enriching data with technical indicators, sector tags, regime labels, and derived metrics before ingestion fits ES perfectly. Each document is self-contained — no joins needed at query time.

*OHLCV aggregations.* The `date_histogram` aggregation with sub-aggregations handles time-bucketed OHLCV queries:
```
date_histogram(interval: "5m") → {
  first(open), max(high), min(low), last(close), sum(volume)
}
```

*TSDS mode.* Time Series Data Streams route all data points for a time series (keyed by dimensions like `ticker` and `exchange`) to the same shard. Storage efficiency reaches ~0.9 bytes per data point with multi-metric documents. Older data is automatically downsampled and compressed.

*Vector search (kNN).* Dense vector fields enable similarity search across embeddings — useful for finding stocks with similar sentiment profiles, clustering earnings call transcripts, or building embedding-based signal features. This capability is unique among the four options (TimescaleDB can approximate it with pgvector, but ES's implementation is more mature and integrated).

*Kibana.* A free, production-grade UI for exploring data (Discover), building dashboards (Lens), and running ad-hoc queries (Dev Tools console). No separate visualization tool needed. Kibana is included in the Docker Compose stack at no additional cost.

**Considerations:**

*Resource footprint.* ES requires 4–8 GB RAM for the JVM heap, plus Kibana adds ~1–2 GB. On a 32GB Mac this is manageable but not negligible — roughly 20–30% of total RAM dedicated to the storage layer.

*Cold start.* JVM startup takes 10–30 seconds. Not an issue for a persistent Docker service, but noticeable if you stop/start frequently.

*Query interface.* ES queries are JSON-based (Query DSL), not SQL. ES|QL (Elasticsearch Query Language) is a newer SQL-like alternative gaining maturity. The JSON DSL is powerful but verbose compared to SQL for simple range scans.

*Bun compatibility.* The official `@elastic/elasticsearch` client has had issues with Bun's `undici` compatibility layer (specifically `undici.Pool.request`). These were reported in Bun v1.0.x; Bun v1.2.5 rewrote its N-API layer and may have resolved them. If issues persist, the REST API can be called directly via `fetch` — ES exposes a standard HTTP/JSON interface.

*Append-only in TSDS mode.* TSDS data streams do not support in-place updates. Documents are immutable once indexed. This is the correct model for market data (bars don't change after the fact) but is a constraint to be aware of.

### DuckDB + Parquet

DuckDB is an embedded, in-process analytical database — like SQLite but for OLAP workloads. No server, no daemon, no configuration. Data lives in Parquet files on disk, queryable directly via SQL.

**Strengths for this architecture:**

*Zero ops overhead.* Install via `bun add duckdb` (or `pip install duckdb` for Python). No Docker, no service management, no ports to expose. Open a connection to a `.duckdb` file (or query Parquet files directly) and start querying.

*Query Parquet files directly.* `SELECT * FROM 'data/AAPL/2024/*.parquet' WHERE ts BETWEEN ...` — no ingestion step required. Filter pushdown reads only the relevant row groups from disk.

*Storage efficiency.* Parquet with Zstandard compression: ~3–6 GB for 5 years × 500 stocks. Files are portable, inspectable, and trivially backed up with `cp`.

*Analytical performance.* Columnar, vectorized execution engine using all available cores. On Apple Silicon, this is fast for aggregation-heavy workloads (VWAP, rolling stats, resampling).

*Bun compatibility.* `@duckdb/node-api` (the official "Neo" API) works with Bun since v1.2.2. The Bun-native alternative `@evan/duckdb` claims 2–6x faster performance. Both can query Parquet files via SQL.

**Considerations:**

*Single-writer limitation.* DuckDB is an embedded database — only one process can write at a time. If your live feed handler and your research notebooks are separate processes, you'll get lock contention. Read-only concurrent access is supported.

*No built-in UI.* You need a separate visualization tool (lightweight-charts, plotly, or a custom web UI). There is no equivalent to Kibana's Discover or dashboards.

*No vector or text search.* DuckDB is a pure analytical engine. If you need embedding-based similarity search or full-text search on text data, you need a separate system.

*No server for concurrent access.* Because DuckDB runs in-process, there's no network interface for other services to query. Each process embeds its own DuckDB instance.

*Denormalization pattern.* Pre-enriched data can be stored as wide Parquet files (one row per bar with all indicators as columns). This works well but lacks the document flexibility of Elasticsearch's nested objects.

### QuestDB

QuestDB is a purpose-built time-series database. Despite being Java-based, it manages its own off-heap memory and avoids the garbage collection issues that plague Elasticsearch's JVM.

**Strengths for this architecture:**

*Native time-series SQL.* `SAMPLE BY` is the standout feature — purpose-built for OHLCV aggregation:
```sql
SELECT symbol, first(open), max(high), min(low), last(close), sum(volume)
FROM bars
WHERE ts IN '2024'
SAMPLE BY 5m
```
`ASOF JOIN` aligns time series with different timestamps — useful for joining price data with indicator signals that arrive at slightly different times.

*Fastest ingestion.* QuestDB benchmarks show 6–13x faster ingestion than TimescaleDB via the InfluxDB Line Protocol (ILP). For bulk historical backfill (246M rows), this matters.

*Lightweight.* ~1–2 GB RAM. Starts in seconds (unlike ES's 10–30 second cold start). Columnar, append-optimized storage.

*Bun compatibility.* `@questdb/nodejs-client` v4.0.2 is TypeScript-native (the entire codebase was migrated to TypeScript). HTTP ILP sender with automatic retries and connection reuse. Reads via PostgreSQL wire protocol using standard `pg` clients.

**Considerations:**

*No vector or text search.* QuestDB is purely a time-series engine. Sentiment analysis or text-based features require a separate system.

*No built-in dashboards.* The web console provides a SQL query interface but no dashboarding. Grafana is the recommended visualization companion (separate Docker container).

*SQL compatibility gaps.* QuestDB's SQL is mostly PostgreSQL-compatible but not 100%. Some advanced window functions and CTEs may behave differently.

*Denormalization.* QuestDB stores flat rows in tables. Pre-enriched data works as wide rows (many columns) but there's no document/nested object concept.

### TimescaleDB

TimescaleDB is a PostgreSQL extension that adds time-series superpowers — automatic time-based partitioning (hypertables), continuous aggregates, and native compression.

**Strengths for this architecture:**

*Full PostgreSQL.* Every PostgreSQL feature works: complex JOINs, CTEs, window functions, views, triggers, stored procedures. If you need relational capabilities alongside time-series (e.g., joining bars with a corporate_actions table), this is the most natural fit.

*`time_bucket()` and continuous aggregates.* `time_bucket('5 minutes', ts)` is the aggregation primitive. Continuous aggregates are materialized views that auto-refresh — define 5-min bars from 1-min data once, and they stay up to date automatically.

*Compression.* Older hypertable chunks compress automatically (10–20x for OHLCV data). Retention policies can drop data beyond a threshold.

*Best Bun integration.* `Bun.sql` is Bun's native, zero-dependency PostgreSQL client — up to 50% faster than npm alternatives. Drizzle ORM provides a TypeScript-first ORM layer with official Bun support. No compatibility concerns.

*pgvector for embeddings.* The pgvector extension adds vector similarity search to PostgreSQL. While less mature than ES's kNN implementation, it enables embedding-based queries within the same database.

**Considerations:**

*No built-in UI.* Like QuestDB, visualization requires Grafana or a custom solution. No equivalent to Kibana.

*Relational model.* If the architecture is denormalized documents, PostgreSQL's relational model is a mismatch — you'd be using a relational database as a document store. It works (JSONB columns) but it's not the natural fit.

*Setup.* Requires PostgreSQL + TimescaleDB extension. Docker (`timescale/timescaledb` image) is straightforward but adds a running service.

*Ingestion speed.* Slower than QuestDB for bulk loads, though `COPY` command and batch inserts are well-optimized.

---

## Open-Source Ecosystem & Bun/TypeScript Compatibility

### Data Ingestion SDKs

| SDK | Package | Status | Bun Compatible |
|---|---|---|---|
| Massive (Polygon) | `@polygon.io/client-js` | v7.4.0, actively maintained, isomorphic | Yes |
| Alpaca | `@alpacahq/typescript-sdk` | v0.0.32-preview, uncertain roadmap | Yes |
| Alpaca (legacy) | `@alpacahq/alpaca-trade-api` | Stable but not TS-native | Yes (Node compat) |

### Storage Clients in Bun/TypeScript

| Storage | Package | Bun Status |
|---|---|---|
| Elasticsearch | `@elastic/elasticsearch` | Known `undici` issues in older Bun; v1.2.5 may resolve. Fallback: raw `fetch` against REST API. |
| DuckDB | `@duckdb/node-api` | Works since Bun v1.2.2. Edge-case crashes under high concurrency reported. |
| DuckDB (Bun-native) | `@evan/duckdb` | Bun-specific bindings, 2–6x faster than Node. |
| QuestDB (write) | `@questdb/nodejs-client` | v4.0.2, TypeScript-native, HTTP ILP sender. Likely Bun-compatible. |
| QuestDB (read) | `Bun.sql` (built-in) | Native PostgreSQL client over PgWire. Zero deps. |
| TimescaleDB | `Bun.sql` (built-in) | Native, zero-dep, fastest option. |
| TimescaleDB | `drizzle-orm/bun-sql` | Official Bun support, TypeScript-first ORM. |

### Parquet Tooling in TypeScript

| Library | Size | Approach | Notes |
|---|---|---|---|
| DuckDB (`read_parquet()`) | N/A | SQL queries over Parquet files | Most powerful option — filter pushdown, glob patterns, column pruning |
| `parquet-wasm` | 1.2 MB (brotli) | Rust compiled to WASM | Returns Apache Arrow format. No native deps. |
| `hyparquet` | 10 KB | Pure JavaScript | Predicate pushdown. Lightweight but less feature-complete. |
| `apache-arrow` (JS) | — | Columnar in-memory format | Interchange format between tools, not a standalone query engine. |

Compared to Python's `pyarrow` and `polars`, the TypeScript Parquet ecosystem is functional for flat OHLCV schemas but less mature for complex nested schemas or advanced analytical operations.

### DataFrame-Like Libraries in TypeScript

| Library | Status | Notes |
|---|---|---|
| **Arquero** | Active | Columnar, relational algebra verbs, TypeScript-native. Best option for transforms. |
| **danfo.js** | Active | Pandas-style API, TensorFlow.js integration. Harder to scale past 1M rows. |

Neither approaches the maturity of Python's pandas or polars for financial analysis. The practical workaround: use DuckDB SQL for heavy analytical work (windowed aggregations, rolling stats, resampling) and bring results into Arquero or plain TypeScript arrays for signal logic.

### Finance Libraries for Pre-Enrichment

| Library | Language | Notes |
|---|---|---|
| `trading-signals` (selected) | TypeScript | Streaming API: `update(value)` → `isStable()` → `getResult()`. FasterRSI, FasterMACD, FasterATR. Zero native deps. Used client-side in web UI. |
| `technicalindicators` | TypeScript | SMA, EMA, RSI, MACD, Bollinger Bands, etc. Pure JS, no native deps. |
| `ta-lib` (via bindings) | C (with JS bindings) | Industry standard. `talib-binding` provides Node bindings. Bun compatibility unverified. |
| Custom TypeScript | — | For domain-specific enrichment (VWAP deviation, volume profile, regime tags). |

### Backtesting Frameworks

This is the significant gap in the TypeScript ecosystem.

**Python (mature):**
- `vectorbt` — vectorized, NumPy/Numba-based, fast parameter sweeps. Open-source version at v0.26.x; active development shifted to commercial VectorBT PRO.
- `zipline-reloaded` — event-driven, maintained by Stefan Jansen. v3.1.1 (July 2025). Conda recommended.
- `backtesting.py` — simple API, interactive Bokeh visualizations, built-in optimizer. Single-asset only.
- `bt` — composable algo stacks, portfolio-level backtesting. Active (April 2025 release).
- `NautilusTrader` — professional-grade (Rust + Cython), seamless backtest-to-live. Steep learning curve.

**TypeScript (thin):**
- `BacktestJS` — TypeScript-native, SQLite-backed, ~3 weekly npm downloads. Effectively abandoned.
- `Grademark` — walk-forward optimization, portfolio simulation. Low adoption, unclear maintenance.

**GitHub topic stats:** 2,579 Python repos vs 59 TypeScript repos tagged "quantitative-finance."

**Practical approach:** Use Python for backtesting, reading from the same QuestDB instance (via PgWire) or exported Parquet files that the Bun/TypeScript pipeline writes to. This is a natural boundary — the production pipeline is TypeScript, the research/backtesting layer is Python.

### Visualization

TypeScript is genuinely strong here — arguably better than Python for interactive financial charts.

| Library | Notes |
|---|---|
| **TradingView `lightweight-charts`** | v5.1, 45 KB, HTML5 Canvas, TypeScript-native. Candlestick, OHLC, line, area, histogram. Official TradingView OSS library. |
| **Plotly.js** | Interactive, general-purpose. Good for statistical research charts (distributions, heatmaps, correlation matrices). |
| **Kibana** | Free with Elasticsearch. Dashboards, Discover, Lens, Canvas. No separate install needed. |
| **Grafana** | Free, pairs with QuestDB or TimescaleDB. Powerful but requires separate Docker container. |

### Scheduling Data Pulls

| Tool | Complexity | Notes |
|---|---|---|
| macOS `cron` | Low | Simple periodic scripts. |
| Bun scripts + `setInterval` | Low | For long-running processes that poll on a schedule. |
| `node-cron` | Low | Cron syntax in TypeScript. Works with Bun. |
| `Prefect` (Python) | Medium | Full workflow orchestration with retries, observability. Useful when the pipeline grows. |

### Bun-Specific Advantages

| Feature | Benefit |
|---|---|
| **Built-in SQLite (`bun:sqlite`)** | 3–6x faster than `better-sqlite3`. Good for metadata, ingestion state, symbol lists. Uses Apple's optimized SQLite on macOS. |
| **Built-in PostgreSQL (`Bun.sql`)** | Native, zero-dep Postgres client. ~50% faster row reads vs npm alternatives. Direct path to TimescaleDB. |
| **Built-in S3 support** | Native S3 read/write for archival. 5x faster than npm S3 packages. |
| **Fast startup** | Sub-second script startup vs Node.js. Relevant for scheduled ingestion scripts. |
| **Native HTTP/WebSocket** | No Express/ws dependency needed for serving a local signal UI. |

---

## Recommended Stack

The four storage options serve different philosophies. Rather than prescribing one answer, here is how they map to different priorities:

### If your priority is a unified system (one storage for everything) *(evaluated, not selected)*

**Elasticsearch + Kibana**
- Single system for OHLCV, text search, vector search, and visualization
- Pre-enriched, denormalized documents are the native data model
- Kibana provides immediate dashboarding without building a custom UI
- Scales naturally as you add sentiment analysis, news search, and embedding-based features in later phases
- Tradeoff: higher RAM footprint (4–8 GB), JSON query DSL

### If your priority is minimal infrastructure *(evaluated, not selected)*

**DuckDB + Parquet**
- Zero servers, zero Docker, zero RAM overhead at idle
- SQL over Parquet files — start querying immediately
- Best for rapid prototyping and research iteration
- Tradeoff: no concurrent writes, no built-in UI, no vector/text search

### If your priority is time-series query ergonomics *(selected)*

**QuestDB**
- `SAMPLE BY` and `ASOF JOIN` are purpose-built for OHLCV analysis
- Fastest ingestion for bulk historical backfill
- Tradeoff: no text/vector search, requires Grafana for visualization

### If your priority is relational flexibility *(evaluated, not selected)*

**TimescaleDB**
- Full PostgreSQL: JOINs, CTEs, window functions, continuous aggregates
- Best Bun integration via `Bun.sql`
- pgvector for embedding search
- Tradeoff: slower ingestion than QuestDB, no built-in UI

---

## Cost Summary

| Stack | Monthly Cost | Notes |
|---|---|---|
| Massive Starter + Elasticsearch | $29 | ES + Kibana are free (open source, local Docker) |
| Massive Starter + DuckDB/Parquet | $29 | DuckDB is free, embedded |
| Massive Starter + QuestDB | $29 | QuestDB is free (open source, local Docker) |
| Massive Starter + TimescaleDB | $29 | TimescaleDB is free (open source, local Docker) |
| Alpaca Free + any storage | $0 | IEX-only data — volume unreliable |
| Alpaca Algo Trader Plus + any storage | $99 | Full SIP, real-time |

All storage options are free when self-hosted locally. The cost difference is entirely in the data provider.

---

## Data Volume Estimates

| Metric | Value |
|---|---|
| Symbols | 500 |
| Minutes per trading day | 390 (9:30 AM – 4:00 PM ET) |
| Trading days per year | 252 |
| Years of history | 5 |
| **Total rows** | **~246 million** |
| Compressed Parquet | ~3–6 GB |
| Elasticsearch (TSDS) | ~5–10 GB |
| QuestDB | ~3–6 GB |
| TimescaleDB (compressed) | ~2–5 GB |
| Daily incremental rows | ~195,000 (500 × 390) |
| Daily incremental size | ~1–2 MB compressed |

This is a manageable dataset for any of the four storage options on a 32GB Mac. None of these volumes pose a scaling concern.
