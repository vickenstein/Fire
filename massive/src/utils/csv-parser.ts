import type { MinuteBar } from "../types";

/**
 * Decompress a gzip buffer and parse CSV content into MinuteBar[].
 * Reads the header row dynamically to determine column indices.
 * Optionally filters by ticker symbol.
 */
export function decompressAndParse(
  buffer: Buffer | Uint8Array,
  filterSymbol?: string,
): MinuteBar[] {
  const decompressed = Bun.gunzipSync(buffer);
  const text = new TextDecoder().decode(decompressed);
  return parseCsv(text, filterSymbol);
}

/**
 * Parse raw CSV text into MinuteBar[].
 * Expected columns (order determined by header):
 *   ticker, volume, open, close, high, low, window_start, transactions
 */
export function parseCsv(text: string, filterSymbol?: string): MinuteBar[] {
  const lines = text.split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].trim();
  const columns = header.split(",");

  const idx = {
    ticker: columns.indexOf("ticker"),
    volume: columns.indexOf("volume"),
    open: columns.indexOf("open"),
    close: columns.indexOf("close"),
    high: columns.indexOf("high"),
    low: columns.indexOf("low"),
    windowStart: columns.indexOf("window_start"),
    transactions: columns.indexOf("transactions"),
  };

  // Validate required columns exist
  const missing = Object.entries(idx)
    .filter(([, i]) => i === -1)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`CSV missing required columns: ${missing.join(", ")}`);
  }

  const bars: MinuteBar[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",");

    if (parts.length < columns.length) {
      console.warn(`csv-parser: skipping malformed row ${i}: ${line.slice(0, 100)}`);
      continue;
    }

    const ticker = parts[idx.ticker];
    if (filterSymbol && ticker !== filterSymbol) continue;

    const windowStartNano = Number(parts[idx.windowStart]);
    if (Number.isNaN(windowStartNano)) {
      console.warn(`csv-parser: skipping row ${i} with invalid window_start`);
      continue;
    }

    bars.push({
      ticker,
      open: Number(parts[idx.open]),
      high: Number(parts[idx.high]),
      low: Number(parts[idx.low]),
      close: Number(parts[idx.close]),
      volume: Number(parts[idx.volume]),
      windowStart: windowStartNano,
      timestamp: new Date(windowStartNano / 1_000_000), // nano → ms
      transactions: Number(parts[idx.transactions]),
    });
  }

  return bars;
}
