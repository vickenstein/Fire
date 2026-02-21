import { S3Fetcher, WSClient, loadMassiveConfig } from "@fire/massive";
import type { MinuteAggEvent } from "@fire/massive";
import { Pipeline, loadConfig } from "@fire/questdb";
import { GapDetector } from "./gap-detector";
import { MarketStatusChecker } from "./market-status";
import { Scheduler } from "./scheduler";
import { loadOrchestratorConfig } from "./config";
import {
  OrchestratorState,
  SchedulerEvent,
  type OrchestratorConfig,
} from "./types";

export class Orchestrator {
  private state: OrchestratorState = OrchestratorState.INITIALIZING;
  private readonly pipeline: Pipeline;
  private readonly s3Fetcher: S3Fetcher;
  private readonly gapDetector: GapDetector;
  private readonly marketStatus: MarketStatusChecker;
  private readonly scheduler: Scheduler;
  private readonly config: OrchestratorConfig;
  private wsClient: WSClient | null = null;
  private liveStreamPromise: Promise<unknown> | null = null;

  constructor() {
    const massiveConfig = loadMassiveConfig();
    this.config = loadOrchestratorConfig();
    this.pipeline = new Pipeline();
    this.s3Fetcher = new S3Fetcher(massiveConfig);
    this.gapDetector = new GapDetector(this.pipeline.getClient());
    this.marketStatus = new MarketStatusChecker(
      massiveConfig.apiKey,
      this.config.marketStatusCacheTtlMs,
    );
    this.scheduler = new Scheduler(
      (event) => this.handleSchedulerEvent(event),
      this.marketStatus,
      this.config.marketCheckIntervalMs,
    );
  }

  /** Current orchestrator state. */
  get currentState(): OrchestratorState {
    return this.state;
  }

  /** Start the orchestrator lifecycle. */
  async start(): Promise<void> {
    this.setState(OrchestratorState.INITIALIZING);

    // 1. Wait for QuestDB to be reachable
    await this.waitForQuestDB();

    // 2. Ensure tables exist (idempotent)
    await this.pipeline.setup();
    console.log("QuestDB tables ready");

    // 3. Run initial backfill to catch up
    await this.runBackfill();

    // 4. Check market status and enter appropriate state
    const isOpen = await this.marketStatus.isMarketInSession();
    const gap = await this.detectGap();

    if (isOpen && gap.isCaughtUp) {
      await this.startLive();
    } else {
      this.setState(OrchestratorState.IDLE);
    }

    // 5. Start the scheduler to monitor market session transitions
    await this.scheduler.start();
  }

  /** Gracefully stop the orchestrator. */
  async stop(): Promise<void> {
    console.log("Orchestrator shutting down...");
    this.scheduler.stop();
    await this.stopLive();
    console.log("Orchestrator stopped");
  }

  // ── Private: QuestDB health wait ──────────────────────────────────────

  private async waitForQuestDB(): Promise<void> {
    const startTime = Date.now();
    const timeout = this.config.dbHealthTimeoutMs;

    while (Date.now() - startTime < timeout) {
      try {
        const health = await this.pipeline.getClient().health();
        console.log(`QuestDB health: ${health.status}`);
        return;
      } catch {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`Waiting for QuestDB... (${elapsed}s)`);
        await sleep(2000);
      }
    }

    throw new Error(
      `QuestDB did not become healthy within ${timeout / 1000}s`,
    );
  }

  // ── Private: Backfill ───────────────────────────────────────────────

  private async detectGap() {
    const latestTs = await this.gapDetector.getLatestTimestamp();
    return this.gapDetector.computeGap(latestTs, this.config.backfillStartDate);
  }

  private async runBackfill(): Promise<void> {
    this.setState(OrchestratorState.BACKFILLING);

    const gap = await this.detectGap();

    if (!gap.hasGap) {
      console.log("No backfill gap detected. Data is current.");
      return;
    }

    console.log(
      `Backfilling ${gap.backfillStartDate} → ${gap.backfillEndDate}` +
        (gap.latestTimestamp
          ? ` (latest: ${gap.latestTimestamp.toISOString()})`
          : " (cold start)"),
    );

    const stream = this.s3Fetcher.stream({
      startDate: gap.backfillStartDate,
      endDate: gap.backfillEndDate,
    });

    const result = await this.pipeline.runBackfill(stream);

    console.log(
      `Backfill complete: ${result.docsIndexed} indexed, ${result.docsErrored} errored`,
    );
  }

  // ── Private: Live streaming ─────────────────────────────────────────

  private async startLive(): Promise<void> {
    this.setState(OrchestratorState.LIVE);

    this.wsClient = new WSClient();
    // Only subscribe to minute agg channel
    const rawStream = this.wsClient.stream(this.config.wsChannels);

    // Filter to only AM events and type as MinuteAggEvent stream
    const filteredStream = new ReadableStream<MinuteAggEvent>({
      start: async (controller) => {
        const reader = rawStream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.ev === "AM") {
              controller.enqueue(value);
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
      cancel: () => {
        this.wsClient?.disconnect();
      },
    });

    this.liveStreamPromise = this.pipeline
      .runLive(filteredStream)
      .then((result) => {
        console.log(
          `Live session ended: ${result.docsIndexed} indexed, ${result.docsErrored} errored`,
        );
      })
      .catch((error) => {
        console.error("Live stream error:", error);
      });
  }

  private async stopLive(): Promise<void> {
    if (this.wsClient) {
      await this.wsClient.disconnect();
      this.wsClient = null;
    }
    if (this.liveStreamPromise) {
      await this.liveStreamPromise;
      this.liveStreamPromise = null;
    }
  }

  // ── Private: Scheduler event handler ────────────────────────────────

  private async handleSchedulerEvent(event: SchedulerEvent): Promise<void> {
    try {
      switch (event) {
        case SchedulerEvent.MARKET_OPEN: {
          console.log("Event: MARKET_OPEN — running backfill then starting live");

          // Always backfill first to ensure we're caught up
          await this.runBackfill();

          const gap = await this.detectGap();
          if (gap.isCaughtUp) {
            await this.startLive();
          } else {
            console.warn(
              "Backfill not fully caught up; staying in IDLE until next check",
            );
            this.setState(OrchestratorState.IDLE);
          }
          break;
        }

        case SchedulerEvent.MARKET_CLOSE: {
          console.log("Event: MARKET_CLOSE — stopping live stream");

          await this.stopLive();

          // Post-close backfill to catch any remaining data
          await this.runBackfill();

          this.setState(OrchestratorState.IDLE);
          break;
        }
      }
    } catch (error) {
      console.error(`Error handling ${event}:`, error);
      this.setState(OrchestratorState.ERROR);

      // Attempt recovery after 60 seconds
      setTimeout(async () => {
        console.log("Attempting recovery from error state...");
        this.setState(OrchestratorState.IDLE);
      }, 60_000);
    }
  }

  // ── Private: State management ───────────────────────────────────────

  private setState(state: OrchestratorState): void {
    if (this.state !== state) {
      console.log(`State: ${this.state} → ${state}`);
      this.state = state;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
