import type { Sender } from "@questdb/nodejs-client";
import type { MinuteBar } from "../types";
import { ILPWriter } from "../ilp-writer";
import { DailyAggregator } from "./daily-aggregator";

const TABLE = "minute_bars";

export class MinuteBarHandler {
  private readonly ilpWriter: ILPWriter;
  private readonly dailyAggregator = new DailyAggregator();
  private sender: Sender | null = null;
  private _currentDate = "";

  constructor(ilpWriter: ILPWriter) {
    this.ilpWriter = ilpWriter;
  }

  /** Date string (YYYY-MM-DD) of the most recently processed bar. */
  get currentDate(): string {
    return this._currentDate;
  }

  writable(): WritableStream<MinuteBar> {
    return new WritableStream({
      write: (bar) => this.processBar(bar),
      close: async () => {
        // Flush remaining daily accumulators (including in-progress day)
        if (this.sender) {
          this.dailyAggregator.flushAll(this.sender, this.ilpWriter);
        }
        await this.ilpWriter.flush();
      },
    });
  }

  private async processBar(bar: MinuteBar): Promise<void> {
    if (!this.sender) {
      this.sender = await this.ilpWriter.getSender();
    }

    const s = this.sender;

    // Write directly to the Sender's internal buffer — zero intermediate objects
    s.table(TABLE);
    s.symbol("ticker", bar.ticker);
    s.floatColumn("open", bar.open);
    s.floatColumn("high", bar.high);
    s.floatColumn("low", bar.low);
    s.floatColumn("close", bar.close);
    s.intColumn("volume", bar.volume);
    s.intColumn("transactions", bar.transactions);

    s.at(BigInt(bar.timestamp.getTime()) * 1000n, "us");

    this._currentDate = bar.timestamp.toISOString().slice(0, 10);
    this.ilpWriter.addPending();

    // Update daily aggregator, flush completed days
    this.dailyAggregator.update(bar);
    this.dailyAggregator.flushCompleted(this._currentDate, s, this.ilpWriter);

    await this.ilpWriter.maybeFlush();
  }
}
