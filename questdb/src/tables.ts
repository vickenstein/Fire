import { QuestDBClient } from "./client";
import { loadQuestDBConfig } from "./config";

const MINUTE_BARS_DDL = `
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
`;

const DAILY_BARS_DDL = `
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
`;

const TICKER_METADATA_DDL = `
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
`;

export async function setupTables(client: QuestDBClient): Promise<void> {
  console.log("Creating QuestDB tables...");

  await client.execute(MINUTE_BARS_DDL);
  console.log("  minute_bars: OK");

  await client.execute(DAILY_BARS_DDL);
  console.log("  daily_bars: OK");

  await client.execute(TICKER_METADATA_DDL);
  console.log("  ticker_metadata: OK");

  console.log("QuestDB tables ready.");
}

/**
 * One-time migration: populate daily_bars from existing minute_bars.
 * Safe to re-run — DEDUP UPSERT handles duplicates.
 */
export async function backfillDailyBars(client: QuestDBClient): Promise<void> {
  // Check if daily_bars already has data
  const rows = await client.query<{ cnt: number }>(
    "SELECT count() as cnt FROM daily_bars",
  );
  if (rows[0]?.cnt > 0) {
    console.log(`  daily_bars: already has ${rows[0].cnt} rows, skipping backfill`);
    return;
  }

  console.log("  daily_bars: backfilling from minute_bars...");
  await client.execute(`
    INSERT INTO daily_bars (ticker, timestamp, open, high, low, close, volume)
    SELECT ticker, timestamp, first(open), max(high), min(low), last(close), sum(volume)
    FROM minute_bars
    SAMPLE BY 1d ALIGN TO CALENDAR
  `);

  const after = await client.query<{ cnt: number }>(
    "SELECT count() as cnt FROM daily_bars",
  );
  console.log(`  daily_bars: backfilled ${after[0]?.cnt ?? 0} rows`);
}

const INDICATOR_COLUMNS = [
  "rsi_14",
  "macd_line",
  "macd_signal",
  "macd_histogram",
  "atr_14",
];

async function dropIndicatorColumns(client: QuestDBClient): Promise<void> {
  console.log("Dropping indicator columns from minute_bars...");
  for (const col of INDICATOR_COLUMNS) {
    try {
      await client.execute(`ALTER TABLE minute_bars DROP COLUMN ${col}`);
      console.log(`  dropped: ${col}`);
    } catch (err: any) {
      // Column may already be dropped — ignore "does not exist" errors
      if (err.message?.includes("does not exist")) {
        console.log(`  skipped: ${col} (already dropped)`);
      } else {
        throw err;
      }
    }
  }
  console.log("Indicator columns dropped. Disk space reclaimed.");
}

// CLI entrypoint
if (import.meta.main) {
  const config = loadQuestDBConfig();
  const client = new QuestDBClient(config);

  await setupTables(client);

  const args = process.argv.slice(2);
  if (args.includes("--backfill-daily")) {
    await backfillDailyBars(client);
  }
  if (args.includes("--drop-indicator-columns")) {
    await dropIndicatorColumns(client);
  }

  await client.close();
}
