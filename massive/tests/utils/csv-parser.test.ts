import { describe, it, expect } from "bun:test";
import { parseCsv, decompressAndParse } from "../../src/utils/csv-parser";

const SAMPLE_CSV = `ticker,volume,open,close,high,low,window_start,transactions
AAPL,1500,150.00,151.00,152.00,149.00,1704722400000000000,25
MSFT,2000,375.50,376.00,377.00,375.00,1704722400000000000,30
AAPL,1200,151.00,151.50,152.50,150.50,1704722460000000000,20`;

describe("parseCsv", () => {
  it("parses all rows correctly", () => {
    const bars = parseCsv(SAMPLE_CSV);
    expect(bars).toHaveLength(3);
  });

  it("maps fields correctly", () => {
    const bars = parseCsv(SAMPLE_CSV);
    const bar = bars[0];
    expect(bar.ticker).toBe("AAPL");
    expect(bar.open).toBe(150.0);
    expect(bar.high).toBe(152.0);
    expect(bar.low).toBe(149.0);
    expect(bar.close).toBe(151.0);
    expect(bar.volume).toBe(1500);
    expect(bar.transactions).toBe(25);
    expect(bar.windowStart).toBe(1704722400000000000);
    expect(bar.timestamp).toBeInstanceOf(Date);
  });

  it("converts nanosecond timestamp to Date correctly", () => {
    const bars = parseCsv(SAMPLE_CSV);
    // 1704722400000000000 ns = 1704722400000 ms
    expect(bars[0].timestamp.getTime()).toBe(1704722400000);
  });

  it("filters by symbol", () => {
    const bars = parseCsv(SAMPLE_CSV, "AAPL");
    expect(bars).toHaveLength(2);
    expect(bars.every((b) => b.ticker === "AAPL")).toBe(true);
  });

  it("returns empty for non-existent symbol", () => {
    const bars = parseCsv(SAMPLE_CSV, "GOOG");
    expect(bars).toHaveLength(0);
  });

  it("handles empty input", () => {
    expect(parseCsv("")).toHaveLength(0);
  });

  it("returns empty when header is valid but no data rows", () => {
    const headerOnly =
      "ticker,volume,open,close,high,low,window_start,transactions\n";
    expect(parseCsv(headerOnly)).toHaveLength(0);
  });

  it("throws on missing required columns", () => {
    const badCsv = "ticker,volume\nAAPL,100";
    expect(() => parseCsv(badCsv)).toThrow("CSV missing required columns");
  });

  it("skips malformed rows", () => {
    const csv = `ticker,volume,open,close,high,low,window_start,transactions
AAPL,1500,150.00,151.00,152.00,149.00,1704722400000000000,25
bad,row`;
    const bars = parseCsv(csv);
    expect(bars).toHaveLength(1);
  });
});

describe("decompressAndParse", () => {
  it("decompresses gzip and parses CSV", () => {
    const compressed = Bun.gzipSync(Buffer.from(SAMPLE_CSV));
    const bars = decompressAndParse(compressed);
    expect(bars).toHaveLength(3);
    expect(bars[0].ticker).toBe("AAPL");
  });

  it("filters by symbol after decompression", () => {
    const compressed = Bun.gzipSync(Buffer.from(SAMPLE_CSV));
    const bars = decompressAndParse(compressed, "MSFT");
    expect(bars).toHaveLength(1);
    expect(bars[0].ticker).toBe("MSFT");
  });
});
