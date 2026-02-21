import type { Sender } from "@questdb/nodejs-client";
import type { MinuteBar } from "../types";
import { ILPWriter } from "../ilp-writer";

const TABLE = "daily_bars";

interface DailyAccum {
  ticker: string;
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class DailyAggregator {
  /** Key: `${ticker}:${date}` → running OHLCV */
  private readonly accums = new Map<string, DailyAccum>();

  update(bar: MinuteBar): void {
    const date = bar.timestamp.toISOString().slice(0, 10);
    const key = `${bar.ticker}:${date}`;

    const existing = this.accums.get(key);
    if (!existing) {
      this.accums.set(key, {
        ticker: bar.ticker,
        date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }

  /**
   * Write daily bars for completed days (any date < currentDate) to ILP.
   * Returns the number of rows written.
   */
  flushCompleted(
    currentDate: string,
    sender: Sender,
    ilpWriter: ILPWriter,
  ): number {
    let flushed = 0;
    for (const [key, accum] of this.accums) {
      if (accum.date < currentDate) {
        writeDailyBar(sender, accum);
        ilpWriter.addPending();
        this.accums.delete(key);
        flushed++;
      }
    }
    return flushed;
  }

  /**
   * Write ALL accumulators (including in-progress day) to ILP.
   * Call on shutdown / stream close.
   */
  flushAll(sender: Sender, ilpWriter: ILPWriter): number {
    let flushed = 0;
    for (const accum of this.accums.values()) {
      writeDailyBar(sender, accum);
      ilpWriter.addPending();
      flushed++;
    }
    this.accums.clear();
    return flushed;
  }
}

function writeDailyBar(sender: Sender, accum: DailyAccum): void {
  const ts = new Date(`${accum.date}T00:00:00.000Z`);

  sender.table(TABLE);
  sender.symbol("ticker", accum.ticker);
  sender.floatColumn("open", accum.open);
  sender.floatColumn("high", accum.high);
  sender.floatColumn("low", accum.low);
  sender.floatColumn("close", accum.close);
  sender.intColumn("volume", accum.volume);
  sender.at(BigInt(ts.getTime()) * 1000n, "us");
}
