# Phase 1d: Web UI — Real-Time Charting Interface

## Context

Phases 1a-1c build the data pipeline: fetch from Massive S3/WebSocket (1a), store in QuestDB (1b), orchestrate backfill and live streaming (1c). Phase 1d builds a browser-based charting interface that reads from QuestDB and renders interactive financial charts. The original plan called for Kibana as the visualization layer; this custom UI replaces it with purpose-built OHLCV charting using Lightweight Charts.

---

## Architecture Overview

```
Browser (React SPA)                  Server (Hono + Bun)           QuestDB
┌──────────────────────┐            ┌──────────────────┐          ┌─────────┐
│  ChartPanel          │  GET /api  │  Hono API routes │  PgWire  │ minute_ │
│  - Candlestick+Vol   │───────────>│  - /bars         │─────────>│  bars   │
│  - RSI(14)           │            │  - /tickers      │          │ daily_  │
│  - MACD(12,26,9)     │  JSON      │  - /ticker/:sym  │  SQL     │  bars   │
│                      │<───────────│  - /bars/latest  │<─────────│ ticker_ │
│  computeIndicators() │            │                  │          │  meta   │
│  useAutoTimeframe()  │            │  Bun.sql client  │          └─────────┘
└──────────────────────┘            └──────────────────┘
```

- **Hono API server** runs on Bun, queries QuestDB via `Bun.sql` PgWire
- **Vite dev server** proxies `/api` calls to the API server during development
- **React 19 SPA** with 3-pane synchronized chart (Lightweight Charts v4.2)
- **Client-side indicator computation** via `trading-signals` v6.1

---

## API Endpoints (`web/src/api/routes.ts`)

All endpoints query QuestDB via `Bun.sql` PgWire connection on port 8812.

### `GET /api/bars`

Fetch OHLCV bars with timeframe aggregation.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `ticker` | yes | — | Stock symbol (e.g., AAPL) |
| `from` | no | 2020-01-01 | Start date (YYYY-MM-DD) |
| `to` | no | today | End date (YYYY-MM-DD) |
| `timeframe` | no | 1m | One of: 1m, 5m, 15m, 1h, 5h, 1d, 1W, 1M |

**Query strategy by timeframe:**
- **1m**: Raw rows from `minute_bars`
- **5m, 15m, 1h, 5h**: `SAMPLE BY` from `minute_bars` — `first(open), max(high), min(low), last(close), sum(volume)`
- **1d**: Pre-aggregated rows from `daily_bars`
- **1W, 1M**: `SAMPLE BY` from `daily_bars`

Returns: `Array<{ timestamp, open, high, low, close, volume }>`

### `GET /api/tickers`

List all tickers with data. Returns `DISTINCT ticker` from `minute_bars`, sorted alphabetically.

Returns: `string[]`

### `GET /api/ticker/:symbol`

Metadata for a single ticker from `ticker_metadata` table.

Returns: `{ ticker, name, sic_code, sic_description, exchange, market_cap, ... }`

### `GET /api/bars/latest`

Last bar for a ticker using QuestDB's `LATEST ON` syntax.

| Param | Required | Description |
|-------|----------|-------------|
| `ticker` | yes | Stock symbol |

Query: `SELECT ... FROM minute_bars WHERE ticker = '...' LATEST ON timestamp PARTITION BY ticker`

Returns: `{ timestamp, open, high, low, close, volume }`

---

## Client-Side Indicator Computation (`web/src/client/lib/computeIndicators.ts`)

All technical indicators are computed in the browser, not stored in QuestDB. This was a deliberate reversal from the original plan of pre-computing at ingestion time (see Phase 1b doc for rationale).

### Indicators

| Indicator | Class | Parameters | Stability |
|-----------|-------|------------|-----------|
| RSI | `FasterRSI(14)` | 14-period | Stable after 14 bars |
| MACD | `FasterMACD(EMA(12), EMA(26), EMA(9))` | 12/26/9 | Stable after 34 bars (26 + 9 - 1) |
| ATR | `FasterATR(14)` | 14-period | Stable after 14 bars |

### WARMUP_BARS = 40

MACD is the bottleneck: 26 (slow EMA) + 9 (signal) - 1 = 34. Rounded up to 40 for safety. This constant is used by `useAutoTimeframe` to request extra bars before the visible range so indicators are stable when the viewport begins.

### API

```typescript
function computeIndicators(bars: OHLCVBar[]): BarWithIndicators[]
```

Input must be sorted by timestamp ascending. Returns the same bars with indicator fields appended. Bars where indicators haven't stabilized have `null` values. Uses the streaming API from `trading-signals`: `update(value, false)` → `isStable` → `getResult()`.

---

## Zoom-Aware Timeframe Switching (`web/src/client/hooks/useAutoTimeframe.ts`)

The chart automatically switches between timeframes as the user zooms in/out, providing seamless multi-resolution viewing without manual timeframe selection.

### Algorithm

1. Subscribe to `chart.timeScale().subscribeVisibleTimeRangeChange()`
2. **Distinguish zoom from pan**: Compare current visible duration to previous. Only re-evaluate if duration changes by >10% (zoom), not on pan.
3. **Zoom direction gating**: Only switch timeframes when bars leave the comfortable 2-10px range in the matching direction:
   - Zooming in: only switch to finer timeframe when bars exceed 10px
   - Zooming out: only switch to coarser timeframe when bars drop below 2px
4. **Find best timeframe**: Walk the ordered timeframe list, pick the finest where bars are at least 2px wide
5. **Debounce**: 300ms delay before switching to avoid rapid re-fetches
6. **Cooldown**: 500ms after data loads before allowing another switch

### Fine Timeframe Scoping

For 1m/5m/15m/1h/5h, the hook scopes the API request to the visible range plus a buffer:
- Buffer covers both viewport panning room and indicator warmup (`WARMUP_BARS * bar duration`)
- The larger of (visible duration) and (warmup seconds) is used as the buffer

This prevents fetching millions of minute bars when only a few days are visible.

### Lifecycle

1. **Ticker change** → Reset to 1d timeframe, fetch all daily data
2. **Zoom in** → When bars exceed 10px, switch to finer timeframe, fetch visible range + buffer
3. **Zoom out** → When bars drop below 2px, switch to coarser timeframe
4. **Pan** → No timeframe change (duration unchanged)

---

## Chart Rendering (`web/src/client/components/ChartPanel.tsx`)

### 3-Pane Layout

```
┌────────────────────────────────────┐
│  Candlestick + Volume Overlay      │  flex-[3]
│  (main chart, 3x height)          │
├────────────────────────────────────┤
│  RSI(14)                           │  h-24 (96px)
│  Line + overbought(70)/oversold(30)│
├────────────────────────────────────┤
│  MACD(12,26,9)                     │  h-24 (96px)
│  Line + Signal + Histogram         │
└────────────────────────────────────┘
```

### Chart Configuration

- **Theme**: Dark (#0a0a0a background, #1f2937 grid, #374151 borders)
- **Candles**: Green (#22c55e) up, red (#ef4444) down
- **Volume**: Histogram overlay on main chart, separate price scale with `scaleMargins: { top: 0.8, bottom: 0 }` (bottom 20% of chart)
- **RSI**: Purple (#a855f7) line, gray dashed reference lines at 70/30
- **MACD**: Blue (#3b82f6) line, orange (#f97316) signal, green/red histogram

### Synchronized Time Scales

All three charts share the same visible time range via bidirectional `subscribeVisibleLogicalRangeChange` listeners. Zooming or panning any chart updates all three.

### Viewport Management

- **Initial load**: `fitContent()` to show all data
- **Timeframe switch**: Save visible range before data replacement, restore after with `requestAnimationFrame` for smooth transitions
- **ResizeObserver**: Responsive sizing for all three chart panes

---

## Ticker Search (`web/src/client/components/TickerSearch.tsx`)

- Fetches all available tickers on mount via `GET /api/tickers`
- Prefix-matching autocomplete (up to 10 suggestions)
- Auto-uppercases input
- Enter key or click to select
- Escape to dismiss suggestions

---

## Directory Structure

```
web/
  package.json                         # @fire/web, deps: hono, react, lightweight-charts, trading-signals
  Dockerfile                           # Multi-stage: Vite build + Bun runtime
  vite.config.ts                       # React plugin, root: src/client, proxy /api → :3001
  tailwind.config.js
  postcss.config.js
  tsconfig.json
  src/
    server.ts                          # Hono app: API routes + static serving + SPA fallback
    api/
      db.ts                            # Bun.sql PgWire connection to QuestDB
      routes.ts                        # GET /api/bars, /api/tickers, /api/ticker/:symbol, /api/bars/latest
    client/
      index.html                       # SPA entry
      main.tsx                         # React root mount
      index.css                        # Tailwind imports
      App.tsx                          # Root component: header (ticker search, timeframe display) + chart panel
      components/
        ChartPanel.tsx                 # 3-pane synchronized Lightweight Charts
        TickerSearch.tsx               # Autocomplete ticker input
      hooks/
        useAutoTimeframe.ts            # Zoom-aware automatic timeframe switching
      lib/
        computeIndicators.ts           # Client-side RSI/MACD/ATR computation
```

---

## Docker

Multi-stage build (`web/Dockerfile`):

**Stage 1 (builder)**:
- `oven/bun:1-alpine` base
- Install deps, run `bun run build` (Vite builds React SPA to `dist/client/`)

**Stage 2 (runtime)**:
- Production deps only
- Copy `server.ts`, `api/` directory, and built `dist/client/`
- Exposes port 3000
- `CMD ["bun", "run", "web/src/server.ts"]`

In production, the Hono server:
1. Serves API routes under `/api/*`
2. Serves static Vite-built assets under `/*`
3. Falls back to `index.html` for SPA routing

---

## Development

```bash
bun run --cwd web dev       # API server on :3001 + Vite dev server on :3000
bun run --cwd web dev:api   # API server only (for testing)
bun run --cwd web build     # Production Vite build
bun run --cwd web start     # Production server (serves built assets)
```

Vite proxies `/api/*` to `http://localhost:3001` during development, enabling hot-reload for the React app while API calls reach the Hono server.

---

## Env Vars

```
PORT=3000                          # HTTP server port (default 3000)
QUESTDB_PG_HOST=localhost          # QuestDB PgWire host
QUESTDB_PG_PORT=8812               # QuestDB PgWire port
QUESTDB_PG_USER=admin              # QuestDB username
QUESTDB_PG_PASSWORD=quest          # QuestDB password
```

---

## Verification

1. **QuestDB running**: `docker compose up questdb` with data loaded
2. **API works**: `curl http://localhost:3001/api/tickers` returns ticker list
3. **Bars endpoint**: `curl 'http://localhost:3001/api/bars?ticker=AAPL&timeframe=1d'` returns OHLCV JSON
4. **Dev mode**: `bun run --cwd web dev` → open `http://localhost:3000`
   - Chart renders with candlesticks + volume
   - RSI and MACD panes populated
   - Zoom in: timeframe auto-switches from 1d → 1h → 15m → 5m → 1m
   - Zoom out: timeframe coarsens back up
   - Type new ticker in search → chart updates
5. **Production build**: `bun run --cwd web build && bun run --cwd web start`
   - Same functionality on `:3000` served from compiled assets
6. **Docker**: `docker compose up --build web` → chart UI at `:3000`
