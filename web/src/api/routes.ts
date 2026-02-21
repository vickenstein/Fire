import { Hono } from "hono";
import { sql } from "./db";

const api = new Hono();

const VALID_TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "5h", "1d", "1W", "1M"]);
const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/bars?ticker=AAPL&from=2024-01-01&to=2025-01-01&timeframe=1m
api.get("/bars", async (c) => {
  const ticker = c.req.query("ticker");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const timeframe = c.req.query("timeframe") ?? "1m";

  if (!ticker) return c.json({ error: "ticker is required" }, 400);
  if (!TICKER_RE.test(ticker)) return c.json({ error: "Invalid ticker format" }, 400);
  if (!VALID_TIMEFRAMES.has(timeframe)) return c.json({ error: "Invalid timeframe" }, 400);
  if (from && !DATE_RE.test(from)) return c.json({ error: "Invalid 'from' date format" }, 400);
  if (to && !DATE_RE.test(to)) return c.json({ error: "Invalid 'to' date format" }, 400);

  const fromDate = from ?? "2020-01-01";
  const toDate = to ?? new Date().toISOString().slice(0, 10);

  let query: string;

  if (timeframe === "1m") {
    // Raw minute bars
    query = `
      SELECT timestamp, open, high, low, close, volume
      FROM minute_bars
      WHERE ticker = '${ticker}'
        AND timestamp >= '${fromDate}'
        AND timestamp <= '${toDate}T23:59:59.999Z'
      ORDER BY timestamp
    `;
  } else if (timeframe === "1d") {
    // Pre-aggregated daily bars
    query = `
      SELECT timestamp, open, high, low, close, volume
      FROM daily_bars
      WHERE ticker = '${ticker}'
        AND timestamp >= '${fromDate}'
        AND timestamp <= '${toDate}T23:59:59.999Z'
      ORDER BY timestamp
    `;
  } else if (timeframe === "1W" || timeframe === "1M") {
    // Aggregated from daily_bars via SAMPLE BY
    const sampleInterval = timeframe === "1W" ? "7d" : "1M";
    query = `
      SELECT timestamp, first(open) as open, max(high) as high,
             min(low) as low, last(close) as close, sum(volume) as volume
      FROM daily_bars
      WHERE ticker = '${ticker}'
        AND timestamp >= '${fromDate}'
        AND timestamp <= '${toDate}T23:59:59.999Z'
      SAMPLE BY ${sampleInterval} ALIGN TO CALENDAR
      ORDER BY timestamp
    `;
  } else {
    // Aggregated via SAMPLE BY (5m, 15m, 1h, 5h)
    query = `
      SELECT timestamp, first(open) as open, max(high) as high,
             min(low) as low, last(close) as close, sum(volume) as volume
      FROM minute_bars
      WHERE ticker = '${ticker}'
        AND timestamp >= '${fromDate}'
        AND timestamp <= '${toDate}T23:59:59.999Z'
      SAMPLE BY ${timeframe} ALIGN TO CALENDAR
      ORDER BY timestamp
    `;
  }

  try {
    const rows = await sql.unsafe(query);
    return c.json(rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

// GET /api/tickers — list all tickers with data
api.get("/tickers", async (c) => {
  try {
    const rows = await sql.unsafe(`
      SELECT DISTINCT ticker FROM minute_bars ORDER BY ticker
    `);
    return c.json(rows.map((r: any) => r.ticker));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

// GET /api/ticker/:symbol — metadata for a single ticker
api.get("/ticker/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  try {
    const rows = await sql.unsafe(`
      SELECT * FROM ticker_metadata
      WHERE ticker = '${symbol}'
      LIMIT 1
    `);
    if (rows.length === 0) {
      return c.json({ error: "Ticker not found" }, 404);
    }
    return c.json(rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

// GET /api/bars/latest?ticker=AAPL — get last bar for a ticker
api.get("/bars/latest", async (c) => {
  const ticker = c.req.query("ticker");
  if (!ticker) return c.json({ error: "ticker is required" }, 400);

  try {
    const rows = await sql.unsafe(`
      SELECT timestamp, open, high, low, close, volume
      FROM minute_bars
      WHERE ticker = '${ticker}'
      LATEST ON timestamp PARTITION BY ticker
    `);
    if (rows.length === 0) {
      return c.json({ error: "No data for ticker" }, 404);
    }
    return c.json(rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

export { api };
