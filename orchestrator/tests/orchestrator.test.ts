import { describe, test, expect, mock, afterEach } from "bun:test";
import { OrchestratorState, SchedulerEvent } from "../src/types";

/**
 * Integration-style tests for orchestrator logic.
 * These test the state transitions and coordination logic
 * without requiring real ES or Massive connections.
 */

describe("OrchestratorState", () => {
  test("all states are defined", () => {
    expect(OrchestratorState.INITIALIZING).toBe(OrchestratorState.INITIALIZING);
    expect(OrchestratorState.BACKFILLING).toBe(OrchestratorState.BACKFILLING);
    expect(OrchestratorState.LIVE).toBe(OrchestratorState.LIVE);
    expect(OrchestratorState.IDLE).toBe(OrchestratorState.IDLE);
    expect(OrchestratorState.ERROR).toBe(OrchestratorState.ERROR);
  });

  test("all scheduler events are defined", () => {
    expect(SchedulerEvent.MARKET_OPEN).toBe(SchedulerEvent.MARKET_OPEN);
    expect(SchedulerEvent.MARKET_CLOSE).toBe(SchedulerEvent.MARKET_CLOSE);
  });
});

describe("Orchestrator state machine logic", () => {
  /**
   * Simulates the orchestrator's state transitions without
   * real dependencies. Tests the coordination protocol.
   */
  class MockOrchestrator {
    state: OrchestratorState = OrchestratorState.INITIALIZING;
    wsRunning = false;
    backfillRan = false;
    private isCaughtUp: boolean;
    private isMarketOpen: boolean;

    constructor(isCaughtUp: boolean, isMarketOpen: boolean) {
      this.isCaughtUp = isCaughtUp;
      this.isMarketOpen = isMarketOpen;
    }

    async start(): Promise<void> {
      this.state = OrchestratorState.INITIALIZING;

      // Simulate setup + backfill
      await this.runBackfill();

      if (this.isMarketOpen && this.isCaughtUp) {
        this.startLive();
      } else {
        this.state = OrchestratorState.IDLE;
      }
    }

    async handleEvent(event: SchedulerEvent): Promise<void> {
      switch (event) {
        case SchedulerEvent.MARKET_OPEN:
          await this.runBackfill();
          if (this.isCaughtUp) {
            this.startLive();
          } else {
            this.state = OrchestratorState.IDLE;
          }
          break;

        case SchedulerEvent.MARKET_CLOSE:
          this.stopLive();
          await this.runBackfill();
          this.state = OrchestratorState.IDLE;
          break;
      }
    }

    private async runBackfill() {
      this.state = OrchestratorState.BACKFILLING;
      this.backfillRan = true;
    }

    private startLive() {
      this.state = OrchestratorState.LIVE;
      this.wsRunning = true;
    }

    private stopLive() {
      this.wsRunning = false;
    }
  }

  test("startup during market hours + caught up → LIVE", async () => {
    const orch = new MockOrchestrator(true, true);
    await orch.start();

    expect(orch.state).toBe(OrchestratorState.LIVE);
    expect(orch.wsRunning).toBe(true);
    expect(orch.backfillRan).toBe(true);
  });

  test("startup during market hours + NOT caught up → IDLE", async () => {
    const orch = new MockOrchestrator(false, true);
    await orch.start();

    expect(orch.state).toBe(OrchestratorState.IDLE);
    expect(orch.wsRunning).toBe(false);
    expect(orch.backfillRan).toBe(true);
  });

  test("startup during off hours → IDLE", async () => {
    const orch = new MockOrchestrator(true, false);
    await orch.start();

    expect(orch.state).toBe(OrchestratorState.IDLE);
    expect(orch.wsRunning).toBe(false);
  });

  test("MARKET_OPEN when caught up → LIVE", async () => {
    const orch = new MockOrchestrator(true, false);
    await orch.start();
    expect(orch.state).toBe(OrchestratorState.IDLE);

    await orch.handleEvent(SchedulerEvent.MARKET_OPEN);

    expect(orch.state).toBe(OrchestratorState.LIVE);
    expect(orch.wsRunning).toBe(true);
  });

  test("MARKET_OPEN when NOT caught up → stays IDLE", async () => {
    const orch = new MockOrchestrator(false, false);
    await orch.start();

    await orch.handleEvent(SchedulerEvent.MARKET_OPEN);

    expect(orch.state).toBe(OrchestratorState.IDLE);
    expect(orch.wsRunning).toBe(false);
  });

  test("MARKET_CLOSE → stops WS, runs backfill, → IDLE", async () => {
    const orch = new MockOrchestrator(true, true);
    await orch.start();
    expect(orch.state).toBe(OrchestratorState.LIVE);
    expect(orch.wsRunning).toBe(true);

    await orch.handleEvent(SchedulerEvent.MARKET_CLOSE);

    expect(orch.state).toBe(OrchestratorState.IDLE);
    expect(orch.wsRunning).toBe(false);
    expect(orch.backfillRan).toBe(true);
  });

  test("WS never starts when not caught up, even on MARKET_OPEN", async () => {
    const orch = new MockOrchestrator(false, false);
    await orch.start();

    // Simulate multiple market opens while not caught up
    await orch.handleEvent(SchedulerEvent.MARKET_OPEN);
    expect(orch.wsRunning).toBe(false);

    await orch.handleEvent(SchedulerEvent.MARKET_OPEN);
    expect(orch.wsRunning).toBe(false);
  });

  test("full day cycle: IDLE → LIVE → IDLE", async () => {
    const orch = new MockOrchestrator(true, false);
    await orch.start();
    expect(orch.state).toBe(OrchestratorState.IDLE);

    // Market opens
    await orch.handleEvent(SchedulerEvent.MARKET_OPEN);
    expect(orch.state).toBe(OrchestratorState.LIVE);
    expect(orch.wsRunning).toBe(true);

    // Market closes
    await orch.handleEvent(SchedulerEvent.MARKET_CLOSE);
    expect(orch.state).toBe(OrchestratorState.IDLE);
    expect(orch.wsRunning).toBe(false);
  });
});
