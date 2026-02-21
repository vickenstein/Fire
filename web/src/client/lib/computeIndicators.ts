import { FasterRSI, FasterMACD, FasterATR, FasterEMA } from "trading-signals";

interface OHLCVBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarWithIndicators extends OHLCVBar {
  rsi_14: number | null;
  macd_line: number | null;
  macd_signal: number | null;
  macd_histogram: number | null;
  atr_14: number | null;
}

/**
 * Extra bars needed before visible range for indicators to stabilize.
 * MACD(12,26,9) is the bottleneck: 26 (slow EMA) + 9 (signal) - 1 = 34.
 * Round up to 40 for safety.
 */
export const WARMUP_BARS = 40;

/**
 * Compute RSI(14), MACD(12,26,9), ATR(14) over an array of OHLCV bars.
 * Input must be sorted by timestamp ascending.
 * Bars where indicators haven't stabilized will have null values.
 */
export function computeIndicators(bars: OHLCVBar[]): BarWithIndicators[] {
  if (bars.length === 0) return [];

  const rsi = new FasterRSI(14);
  const macd = new FasterMACD(
    new FasterEMA(12),
    new FasterEMA(26),
    new FasterEMA(9),
  );
  const atr = new FasterATR(14);

  return bars.map((bar) => {
    const close = Number(bar.close);
    const high = Number(bar.high);
    const low = Number(bar.low);

    rsi.update(close, false);
    macd.update(close, false);
    atr.update({ high, low, close }, false);

    const macdResult = macd.isStable ? macd.getResult() : null;

    return {
      ...bar,
      rsi_14: rsi.isStable ? (rsi.getResult() as number) : null,
      macd_line: macdResult?.macd ?? null,
      macd_signal: macdResult?.signal ?? null,
      macd_histogram: macdResult?.histogram ?? null,
      atr_14: atr.isStable ? (atr.getResult() as number) : null,
    };
  });
}
