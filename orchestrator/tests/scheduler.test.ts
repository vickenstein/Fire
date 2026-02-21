import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { Scheduler } from "../src/scheduler";
import { MarketStatusChecker } from "../src/market-status";
import { SchedulerEvent } from "../src/types";

function createMockMarketStatus(isOpen: boolean): MarketStatusChecker {
  const checker = {
    isMarketInSession: mock(async () => isOpen),
    getStatus: mock(async () => ({
      isOpen,
      market: isOpen ? "open" : "closed",
      exchanges: { nyse: isOpen ? "open" : "closed" },
      serverTime: new Date().toISOString(),
    })),
    refresh: mock(async () => ({
      isOpen,
      market: isOpen ? "open" : "closed",
      exchanges: { nyse: isOpen ? "open" : "closed" },
      serverTime: new Date().toISOString(),
    })),
  } as unknown as MarketStatusChecker;
  return checker;
}

describe("Scheduler", () => {
  let scheduler: Scheduler | null = null;

  afterEach(() => {
    scheduler?.stop();
    scheduler = null;
  });

  test("initializes with correct running state", () => {
    const handler = mock(async () => {});
    const market = createMockMarketStatus(false);
    scheduler = new Scheduler(handler, market, 100);

    expect(scheduler.isRunning).toBe(false);
  });

  test("starts and begins checking market status", async () => {
    const handler = mock(async () => {});
    const market = createMockMarketStatus(false);
    scheduler = new Scheduler(handler, market, 100);

    await scheduler.start();

    expect(scheduler.isRunning).toBe(true);
    expect(market.isMarketInSession).toHaveBeenCalled();
  });

  test("detects closed→open transition", async () => {
    let isOpen = false;
    const handler = mock(async () => {});
    const market = {
      isMarketInSession: mock(async () => isOpen),
    } as unknown as MarketStatusChecker;

    scheduler = new Scheduler(handler, market, 50);
    await scheduler.start();

    // Wait for a poll cycle, then flip to open
    await new Promise((r) => setTimeout(r, 30));
    isOpen = true;

    // Wait for poll to detect the transition
    await new Promise((r) => setTimeout(r, 120));

    const calls = handler.mock.calls;
    const openEvent = calls.find(
      (c: unknown[]) => c[0] === SchedulerEvent.MARKET_OPEN,
    );
    expect(openEvent).toBeTruthy();
  });

  test("detects open→closed transition", async () => {
    let isOpen = true;
    const handler = mock(async () => {});
    const market = {
      isMarketInSession: mock(async () => isOpen),
    } as unknown as MarketStatusChecker;

    scheduler = new Scheduler(handler, market, 50);
    await scheduler.start();

    // Wait a poll cycle, then flip to closed
    await new Promise((r) => setTimeout(r, 30));
    isOpen = false;

    // Wait for poll to detect the transition
    await new Promise((r) => setTimeout(r, 120));

    const calls = handler.mock.calls;
    const closeEvent = calls.find(
      (c: unknown[]) => c[0] === SchedulerEvent.MARKET_CLOSE,
    );
    expect(closeEvent).toBeTruthy();
  });

  test("does not fire events when no transition occurs", async () => {
    const handler = mock(async () => {});
    const market = createMockMarketStatus(false);

    scheduler = new Scheduler(handler, market, 50);
    await scheduler.start();

    // Wait for a few poll cycles
    await new Promise((r) => setTimeout(r, 200));

    // No transitions should have fired
    expect(handler).not.toHaveBeenCalled();
  });

  test("stop clears all timers", async () => {
    const handler = mock(async () => {});
    const market = createMockMarketStatus(false);

    scheduler = new Scheduler(handler, market, 50);
    await scheduler.start();

    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  test("does not double-start", async () => {
    const handler = mock(async () => {});
    const market = createMockMarketStatus(false);

    scheduler = new Scheduler(handler, market, 100);
    await scheduler.start();
    await scheduler.start(); // second start is a no-op

    // isMarketInSession called only once for the initial seed
    expect(market.isMarketInSession).toHaveBeenCalledTimes(1);
  });
});
