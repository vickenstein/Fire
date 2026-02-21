import { QuestDBClient } from "./client";
import { loadConfig } from "./config";
import { setupTables } from "./tables";
import { ILPWriter } from "./ilp-writer";
import { MinuteBarHandler } from "./handlers/minute-bar-handler";
import { MetadataSync } from "./metadata/metadata-sync";
import type { MinuteBar, MinuteAggEvent, PipelineConfig } from "./types";

const LOG_INTERVAL_MS = 5_000;

export class Pipeline {
  private readonly client: QuestDBClient;
  private readonly config: PipelineConfig;

  constructor(config?: PipelineConfig) {
    this.config = config ?? loadConfig();
    this.client = new QuestDBClient(this.config.questdb);
  }

  async setup(): Promise<void> {
    const health = await this.client.health();
    console.log(`QuestDB health: ${health.status}`);
    await setupTables(this.client);
  }

  async runBackfill(
    stream: ReadableStream<MinuteBar>,
  ): Promise<{ docsIndexed: number; docsErrored: number }> {
    const ilpWriter = new ILPWriter(
      this.config.questdb,
      this.config.ilp.backfill,
    );
    const handler = new MinuteBarHandler(ilpWriter);

    const startTime = Date.now();
    let lastLogTime = startTime;
    let lastLogRows = 0;

    const progressTimer = setInterval(() => {
      const now = Date.now();
      const totalRows = ilpWriter.rowsWritten;
      const elapsed = (now - startTime) / 1000;
      const intervalRows = totalRows - lastLogRows;
      const intervalSec = (now - lastLogTime) / 1000;
      const currentRate = Math.round(intervalRows / intervalSec);
      const avgRate = Math.round(totalRows / elapsed);

      const dateInfo = handler.currentDate ? ` | date: ${handler.currentDate}` : "";
      console.log(
        `  backfill: ${totalRows.toLocaleString()} rows | ${currentRate.toLocaleString()}/s current | ${avgRate.toLocaleString()}/s avg${dateInfo}`,
      );

      lastLogTime = now;
      lastLogRows = totalRows;
    }, LOG_INTERVAL_MS);

    try {
      await stream.pipeTo(handler.writable());
      await ilpWriter.close();
    } finally {
      clearInterval(progressTimer);
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalRows = ilpWriter.rowsWritten;
    const avgRate = Math.round(totalRows / ((Date.now() - startTime) / 1000));
    console.log(
      `  backfill done: ${totalRows.toLocaleString()} rows in ${totalTime}s (${avgRate.toLocaleString()}/s avg)`,
    );

    return {
      docsIndexed: ilpWriter.rowsWritten,
      docsErrored: ilpWriter.rowsErrored,
    };
  }

  async runLive(
    stream: ReadableStream<MinuteAggEvent>,
  ): Promise<{ docsIndexed: number; docsErrored: number }> {
    const ilpWriter = new ILPWriter(
      this.config.questdb,
      this.config.ilp.live,
    );
    const handler = new MinuteBarHandler(ilpWriter);

    // Transform MinuteAggEvent → MinuteBar, then process
    const transform = new TransformStream<MinuteAggEvent, MinuteBar>({
      transform(event, controller) {
        controller.enqueue({
          ticker: event.sym,
          open: event.o,
          high: event.h,
          low: event.l,
          close: event.c,
          volume: event.v,
          windowStart: event.s * 1_000_000, // ms to ns
          timestamp: new Date(event.s),
          transactions: 0,
        });
      },
    });

    await stream.pipeThrough(transform).pipeTo(handler.writable());
    await ilpWriter.close();

    return {
      docsIndexed: ilpWriter.rowsWritten,
      docsErrored: ilpWriter.rowsErrored,
    };
  }

  async syncMetadata(tickers: string[]): Promise<void> {
    const ilpWriter = new ILPWriter(
      this.config.questdb,
      this.config.ilp.live,
    );
    const sync = new MetadataSync(
      this.client,
      ilpWriter,
      this.config.massive.apiKey,
    );
    await sync.sync(tickers);
    await ilpWriter.close();
  }

  getClient(): QuestDBClient {
    return this.client;
  }
}

// CLI entrypoint
if (import.meta.main) {
  const args = process.argv.slice(2);
  const pipeline = new Pipeline();

  if (args.includes("--setup")) {
    await pipeline.setup();
  } else if (args.includes("--sync-metadata")) {
    const tickersIdx = args.indexOf("--tickers");
    if (tickersIdx === -1 || !args[tickersIdx + 1]) {
      console.error("Usage: --sync-metadata --tickers AAPL,MSFT,GOOGL");
      process.exit(1);
    }
    const tickers = args[tickersIdx + 1].split(",");
    await pipeline.syncMetadata(tickers);
  } else {
    console.log("Usage:");
    console.log("  --setup                          Create QuestDB tables");
    console.log("  --sync-metadata --tickers A,B,C  Fetch and index ticker metadata");
    console.log("");
    console.log("Backfill and live modes require importing Pipeline programmatically");
    console.log("and passing a ReadableStream from @fire/massive.");
  }
}
