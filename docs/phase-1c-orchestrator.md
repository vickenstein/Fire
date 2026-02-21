# Phase 1c: Containerized Orchestrator Service

## Context

Phases 1a (S3Fetcher, WSClient) and 1b (QuestDB ingestion pipeline) exist as separate building blocks with no process to tie them together. There is no way to:
- Automatically detect what data QuestDB already has and backfill the gap
- Start/stop the WebSocket client based on whether the market is actually in session
- Ensure the WS client never starts until historical data is caught up
- Run the pipeline as a persistent, containerized service

Phase 1c builds a long-running orchestrator that composes these existing components into an idempotent, resumable, market-session-aware pipeline.

---

## Workspace: `orchestrator/`

```
orchestrator/
  package.json                   # @fire/orchestrator, deps: @fire/massive + @fire/questdb + @polygon.io/client-js
  tsconfig.json
  Dockerfile
  index.ts                       # Entrypoint with graceful shutdown (SIGINT/SIGTERM)
  src/
    orchestrator.ts              # Main state machine
    scheduler.ts                 # Interval-based market session monitor
    gap-detector.ts              # Queries QuestDB for latest data, computes backfill range
    market-status.ts             # Live market status via Polygon REST API + static fallback
    config.ts                    # Orchestrator env var loading
    types.ts                     # OrchestratorState, config types, MarketSession, GapInfo
  tests/
    market-status.test.ts
    gap-detector.test.ts
    scheduler.test.ts
    orchestrator.test.ts
```

---

## Orchestrator State Machine

```
              ┌──────────────┐
  startup ──> │ INITIALIZING │  Wait for QuestDB health, run pipeline.setup()
              └──────┬───────┘
                     │
                     v
              ┌──────────────┐
         ┌──> │  BACKFILLING │  Query QuestDB for latest timestamp, S3 fetch the gap
         │    └──────┬───────┘
         │           │ caught up?
         │           v
         │    ┌──────────────┐
         │    │    IDLE      │ <── market session ends / not in session
         │    └──────┬───────┘
         │           │ market session starts (API confirms open)
         │           v
         │    ┌──────────────┐
         └────│    LIVE      │  WSClient streaming AM.* events
              └──────┬───────┘
                     │ error in any state
                     v
              ┌──────────────┐
              │    ERROR     │  60s recovery timer → IDLE
              └──────────────┘
```

**States**: `INITIALIZING`, `BACKFILLING`, `LIVE`, `IDLE`, `ERROR`

**Key invariants:**
- WS client **never** starts during off hours (weekends, pre/post market, holidays)
- WS client **never** starts until backfill is caught up
- On market close: stop WS → run backfill check → enter IDLE
- On market open: run backfill first → then start WS
- On error: 60s timeout → recover to IDLE

---

## Market Session Detection (`market-status.ts`)

**Dynamic, not static.** Uses the Polygon REST API via `restClient.reference.marketStatus()` which calls `/v1/marketstatus/now`. Already available in `@polygon.io/client-js` (the SDK the project already depends on). This handles holidays, early closes, and exchange-specific state automatically — no static calendar to maintain.

### `MarketStatusChecker` class

```typescript
import { restClient } from "@polygon.io/client-js";

class MarketStatusChecker {
  private rest;                          // restClient instance
  private cachedStatus: MarketSession | null;
  private lastCheckTime: number;
  private readonly cacheTtlMs: number;   // default 60_000 (1 min)

  constructor(apiKey: string, cacheTtlMs?: number);

  async isMarketInSession(): Promise<boolean>;   // cached check
  async getStatus(): Promise<MarketSession>;      // full status with cache
  async refresh(): Promise<MarketSession>;        // force refresh
}
```

**Caching**: API called at most once per `cacheTtlMs` (default 1 minute). During active 30-second polling, most checks hit cache.

**Static fallback**: If API fails (network issue, rate limit), fall back to `isLikelyMarketHours(now)` check using `Intl.DateTimeFormat` with `timeZone: "America/New_York"` for DST handling. Log a warning when falling back. The fallback checks weekday 9:30 AM-4:00 PM ET — correct except for holidays and early closes.

### Exported utilities

- `isLikelyMarketHours(now?)` — Static weekday 9:30-16:00 ET check
- `nextLikelyMarketOpen(from?)` — Next weekday 9:30 ET as Date (handles weekends)
- `msUntilLikelyMarketOpen(from?)` — Milliseconds until next open (0 if currently open)
- `getEasternTime(date?)` — Parse current time into ET components via `Intl.DateTimeFormat`

---

## Scheduler (`scheduler.ts`) — Interval-Based Session Monitor

Polls the market status at a regular interval and reacts to **transitions** rather than scheduling exact open/close times. This naturally handles holidays, early closes, and API-driven state without a static calendar.

```typescript
class Scheduler {
  private interval: ReturnType<typeof setInterval> | null;
  private sleepTimer: ReturnType<typeof setTimeout> | null;
  private readonly checkIntervalMs: number;     // default 30_000 (30s)
  private previouslyOpen: boolean;

  constructor(handler, marketStatus: MarketStatusChecker, checkIntervalMs?);
  start(): Promise<void>;
  stop(): void;
}
```

**Polling logic** (every 30 seconds during likely market hours):
1. Call `marketStatus.isMarketInSession()` (cached, ~1 API call/min)
2. Detect transitions:
   - `was closed → now open` → fire `MARKET_OPEN` event
   - `was open → now closed` → fire `MARKET_CLOSE` event
3. Orchestrator handles the events

**Idle optimization**: During extended off-hours (overnight, weekends), use the static fallback to calculate ms until ~30 minutes before next likely market open. Set a single `setTimeout` for that duration, then resume 30-second polling. Avoids unnecessary API calls through the weekend.

```
Weekend example:
  Friday 4:00 PM → MARKET_CLOSE
  → calculate next likely open = Monday 9:00 AM → setTimeout(~65 hours)
  → Monday 9:00 AM → resume 30s polling
  → ~9:30 AM → API says "open" → MARKET_OPEN event
```

---

## Backfill & "Caught Up" Detection (`gap-detector.ts`)

### Latest Data Query

QuestDB PgWire query on `minute_bars`:

```sql
SELECT max(timestamp) as latest FROM minute_bars
```

Delegates to `QuestDBClient.getLatestTimestamp()`. Returns `null` if table is empty or doesn't exist yet.

### GapInfo

```typescript
interface GapInfo {
  latestTimestamp: Date | null;
  backfillStartDate: string;     // YYYY-MM-DD
  backfillEndDate: string;       // YYYY-MM-DD (typically yesterday)
  hasGap: boolean;
  isCaughtUp: boolean;           // safe to start live stream?
}
```

### "Caught Up" Logic

S3 flat files for trading day T are published on day T+1. So **caught up** means the latest QuestDB data covers through the previous trading day:

- `isCaughtUp = true` when latest QuestDB timestamp >= previous trading day's date
- The WS client only starts when `isCaughtUp && isMarketInSession()`

### Backfill Range

- **Cold start** (QuestDB empty): from `BACKFILL_START_DATE` env var (default `2020-01-02`) through yesterday
- **Warm resume**: from the day after latest QuestDB timestamp through yesterday
- **5-year cap**: Start date capped to 5 years ago (Massive flat file lookback limit)
- **No gap**: skip backfill

### Full-universe backfill

All tickers — no symbol filter. `FetchBarsOptions.symbol` is optional; when `undefined`, S3Fetcher includes all tickers from each daily file.

---

## Idempotency & Duplicate Prevention

| Layer | Mechanism |
|-------|-----------|
| **Primary** | Gap detection — only fetch dates after latest QuestDB timestamp |
| **Safety net** | QuestDB `DEDUP UPSERT KEYS(timestamp, ticker)` — matching rows are upserted, not duplicated |
| **Day boundary** | If latest timestamp is mid-day, start from next full day; small gap is harmless |
| **Disk cache** | S3 files cached in `.cache/` — no redundant downloads on restart |

---

## S3 Disk Archive (Side Effect)

Existing `S3Fetcher` already caches raw `.csv.gz` to `massive/.cache/` mirroring S3 paths. `.cache/` is in `.gitignore`. In Docker, mounted as a bind mount for persistence and host access.

---

## Docker: Single-Command Deployment

**Goal**: `docker compose up --build` starts the entire system — QuestDB, the orchestrator, and the web UI. Nothing else to run.

### Orchestrator Dockerfile (`orchestrator/Dockerfile`)

```dockerfile
FROM oven/bun:1-alpine

WORKDIR /app

# Copy root workspace files for dependency resolution
COPY package.json bun.lock tsconfig.json ./
COPY massive/package.json massive/
COPY questdb/package.json questdb/
COPY orchestrator/package.json orchestrator/

# Install dependencies (skip native build scripts — bufferutil/utf-8-validate
# are optional ws optimizations; ws falls back to pure JS without them)
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source code for all workspaces (orchestrator imports from both)
COPY massive/ massive/
COPY questdb/ questdb/
COPY orchestrator/ orchestrator/

CMD ["bun", "run", "orchestrator/index.ts"]
```

### `docker-compose.yml`

```yaml
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

  orchestrator:
    build:
      context: .
      dockerfile: orchestrator/Dockerfile
    env_file: .env
    environment:
      - QUESTDB_ILP_HOST=questdb
      - QUESTDB_ILP_PORT=9009
      - QUESTDB_PG_HOST=questdb
      - QUESTDB_PG_PORT=8812
      - QUESTDB_PG_USER=admin
      - QUESTDB_PG_PASSWORD=quest
    depends_on:
      questdb:
        condition: service_healthy
    volumes:
      - ./massive/.cache:/app/massive/.cache
      - ./questdb/.dead-letter:/app/questdb/.dead-letter
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: web/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - QUESTDB_PG_HOST=questdb
      - QUESTDB_PG_PORT=8812
      - QUESTDB_PG_USER=admin
      - QUESTDB_PG_PASSWORD=quest
    depends_on:
      questdb:
        condition: service_healthy

volumes:
  questdb-data:
```

The orchestrator container:
- Waits for QuestDB healthcheck before starting (no manual coordination)
- Reads credentials from `.env` via `env_file` (for `MASSIVE_API_KEY`)
- Persists S3 cache and dead-letter data via bind mounts
- Auto-restarts on crash (`unless-stopped`)

---

## Changes to Existing Code

| File | Change |
|------|--------|
| `massive/src/types.ts` | Make `symbol` optional in `FetchBarsOptions` |
| `massive/index.ts` | Export `getTradingDays` and `formatDate` |
| `package.json` (root) | Add `"orchestrator"` to workspaces: `["massive", "questdb", "orchestrator", "web"]` |
| `.gitignore` | Add `.cache/`, `.dead-letter/`, `node_modules/` |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKFILL_START_DATE` | `2020-01-02` | Earliest backfill date on cold start |
| `WS_CHANNELS` | `AM.*` | WebSocket subscription channels (comma-separated) |
| `MARKET_CHECK_INTERVAL_MS` | `30000` (30s) | Market status polling interval |
| `MARKET_STATUS_CACHE_TTL_MS` | `60000` (1 min) | API response cache TTL |
| `DB_HEALTH_TIMEOUT_MS` | `60000` | Max wait for QuestDB on startup |
| `QUESTDB_ILP_HOST` | `localhost` | QuestDB ILP ingestion host |
| `QUESTDB_ILP_PORT` | `9009` | QuestDB ILP ingestion port |
| `QUESTDB_PG_HOST` | `localhost` | QuestDB PgWire query host |
| `QUESTDB_PG_PORT` | `8812` | QuestDB PgWire query port |
| `QUESTDB_PG_USER` | `admin` | QuestDB PgWire username |
| `QUESTDB_PG_PASSWORD` | `quest` | QuestDB PgWire password |
| `MASSIVE_API_KEY` | (required) | Polygon/Massive API key |

---

## Verification

1. **Unit tests**: `bun test --cwd orchestrator`
   - Market status: mock API responses for open/closed/holiday/early-close; verify fallback on API failure
   - Gap detector: mock QuestDB responses for empty/partial/current; verify `isCaughtUp` across scenarios
   - Scheduler: verify transition detection (closed->open, open->closed), idle sleep optimization

2. **Single-command deployment**: `docker compose up --build`
   - QuestDB starts → healthcheck passes → orchestrator container starts
   - Orchestrator logs: QuestDB health → table setup → backfill progress → market status → IDLE or LIVE
   - QuestDB console available at `localhost:9000` for data verification
   - Web UI available at `localhost:3000` for charting
   - No manual steps required — everything runs inside Docker

3. **Idempotency**: `docker compose down && docker compose up`
   - Gap detector finds latest QuestDB data → skips already-indexed dates
   - S3 cache persists via bind mount → no redundant downloads
   - Logs "No backfill gap detected" if fully caught up

4. **Market session lifecycle** (during trading hours):
   - Orchestrator backfills → detects market open via API → starts WS → streams live AM.* data
   - At market close → stops WS → runs post-close backfill check → enters IDLE
   - Verify in QuestDB console: `SELECT count() FROM minute_bars` shows both backfilled and live data
