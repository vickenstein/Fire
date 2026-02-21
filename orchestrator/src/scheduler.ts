import { SchedulerEvent } from "./types";
import {
  MarketStatusChecker,
  isLikelyMarketHours,
  msUntilLikelyMarketOpen,
} from "./market-status";

/** Pre-wake buffer: start polling this many ms before likely market open. */
const PRE_WAKE_BUFFER_MS = 30 * 60_000; // 30 minutes

export class Scheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly checkIntervalMs: number;
  private readonly handler: (event: SchedulerEvent) => Promise<void>;
  private readonly marketStatus: MarketStatusChecker;
  private previouslyOpen = false;
  private running = false;

  constructor(
    handler: (event: SchedulerEvent) => Promise<void>,
    marketStatus: MarketStatusChecker,
    checkIntervalMs = 30_000,
  ) {
    this.handler = handler;
    this.marketStatus = marketStatus;
    this.checkIntervalMs = checkIntervalMs;
  }

  /** Start the scheduler. Begins polling or sleeping based on current time. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Seed the initial state
    this.previouslyOpen = await this.marketStatus.isMarketInSession();
    console.log(
      `Scheduler started. Market currently: ${this.previouslyOpen ? "open" : "closed"}`,
    );

    this.scheduleNext();
  }

  /** Stop the scheduler and clear all timers. */
  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
  }

  /** Whether the scheduler is currently active. */
  get isRunning(): boolean {
    return this.running;
  }

  private scheduleNext(): void {
    if (!this.running) return;

    // Clear any existing timers
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }

    if (isLikelyMarketHours() || this.isNearMarketOpen()) {
      // Near or during market hours: poll every checkIntervalMs
      this.startPolling();
    } else {
      // Extended off-hours: sleep until close to next market open
      this.startIdleSleep();
    }
  }

  private startPolling(): void {
    console.log(
      `Scheduler: active polling every ${this.checkIntervalMs / 1000}s`,
    );

    this.interval = setInterval(async () => {
      if (!this.running) return;

      try {
        const isOpen = await this.marketStatus.isMarketInSession();

        if (!this.previouslyOpen && isOpen) {
          // Transition: closed → open
          console.log("Scheduler: market opened");
          this.previouslyOpen = true;
          await this.handler(SchedulerEvent.MARKET_OPEN);
        } else if (this.previouslyOpen && !isOpen) {
          // Transition: open → closed
          console.log("Scheduler: market closed");
          this.previouslyOpen = false;
          await this.handler(SchedulerEvent.MARKET_CLOSE);

          // Switch to idle sleep mode
          this.scheduleNext();
        }
      } catch (error) {
        console.error("Scheduler poll error:", error);
      }
    }, this.checkIntervalMs);
  }

  private startIdleSleep(): void {
    const msToWake = Math.max(
      0,
      msUntilLikelyMarketOpen() - PRE_WAKE_BUFFER_MS,
    );
    const hoursToWake = (msToWake / 3_600_000).toFixed(1);

    console.log(
      `Scheduler: sleeping for ${hoursToWake}h until near next market open`,
    );

    if (msToWake <= 0) {
      // Already close to market open, start polling
      this.startPolling();
      return;
    }

    this.sleepTimer = setTimeout(() => {
      if (!this.running) return;
      console.log("Scheduler: waking up, resuming active polling");
      this.startPolling();
    }, msToWake);
  }

  /** Check if we're within the pre-wake buffer of market open. */
  private isNearMarketOpen(): boolean {
    const msToOpen = msUntilLikelyMarketOpen();
    return msToOpen > 0 && msToOpen <= PRE_WAKE_BUFFER_MS;
  }
}
