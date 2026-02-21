import { describe, it, expect } from "bun:test";
import { WSClient } from "../src/ws-client";
import { ConnectionState } from "../src/types";

// Unit tests — no network required
describe("WSClient", () => {
  const makeClient = () =>
    new WSClient({
      apiKey: "test-key",
      maxReconnectAttempts: 3,
      reconnectBaseDelay: 100,
    });

  describe("construction", () => {
    it("initializes in DISCONNECTED state", () => {
      const client = makeClient();
      expect(client.connectionState).toBe(ConnectionState.DISCONNECTED);
    });

    it("starts with empty subscriptions", () => {
      const client = makeClient();
      expect(client.activeSubscriptions.size).toBe(0);
    });
  });

  describe("subscription tracking", () => {
    it("tracks subscribed channels", () => {
      const client = makeClient();
      client.subscribe("AM.AAPL");
      expect(client.activeSubscriptions.has("AM.AAPL")).toBe(true);
    });

    it("tracks multiple channels", () => {
      const client = makeClient();
      client.subscribe(["AM.AAPL", "T.MSFT", "Q.GOOG"]);
      expect(client.activeSubscriptions.size).toBe(3);
    });

    it("removes unsubscribed channels", () => {
      const client = makeClient();
      client.subscribe(["AM.AAPL", "T.MSFT"]);
      client.unsubscribe("AM.AAPL");
      expect(client.activeSubscriptions.has("AM.AAPL")).toBe(false);
      expect(client.activeSubscriptions.has("T.MSFT")).toBe(true);
    });

    it("handles unsubscribe of non-existent channel", () => {
      const client = makeClient();
      client.unsubscribe("AM.AAPL"); // should not throw
      expect(client.activeSubscriptions.size).toBe(0);
    });
  });

  describe("event handlers", () => {
    it("registers and unregisters typed handlers", () => {
      const client = makeClient();
      const events: any[] = [];

      const unsub = client.on("AM", (event) => events.push(event));
      expect(typeof unsub).toBe("function");

      unsub(); // should not throw
    });

    it("registers and unregisters error handlers", () => {
      const client = makeClient();
      const errors: Error[] = [];

      const unsub = client.onError((err) => errors.push(err));
      expect(typeof unsub).toBe("function");

      unsub();
    });

    it("registers and unregisters state change handlers", () => {
      const client = makeClient();
      const states: ConnectionState[] = [];

      const unsub = client.onStateChange((state) => states.push(state));
      expect(typeof unsub).toBe("function");

      unsub();
    });
  });

  describe("stream", () => {
    it("returns a ReadableStream", () => {
      const client = makeClient();
      const stream = client.stream("AM.AAPL");
      expect(stream).toBeInstanceOf(ReadableStream);

      // Cancel to prevent dangling connection attempt
      stream.cancel();
    });
  });

  describe("disconnect", () => {
    it("clears subscriptions on disconnect", async () => {
      const client = makeClient();
      client.subscribe(["AM.AAPL", "T.MSFT"]);
      await client.disconnect();
      expect(client.activeSubscriptions.size).toBe(0);
      expect(client.connectionState).toBe(ConnectionState.DISCONNECTED);
    });
  });
});

// Integration tests — require live WebSocket access
const INTEGRATION = process.env.TEST_INTEGRATION === "true";

(INTEGRATION ? describe : describe.skip)("WSClient integration", () => {
  it("connects and authenticates", async () => {
    const client = new WSClient();
    await client.connect();
    expect(client.connectionState).toBe(ConnectionState.AUTHENTICATED);
    await client.disconnect();
  }, 15_000);

  it("receives events after subscribing", async () => {
    const client = new WSClient();
    const events: any[] = [];

    client.on("AM", (event) => events.push(event));
    await client.connect();
    client.subscribe("AM.*");

    // Wait up to 120s for at least one event (minute aggs fire once per minute)
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (events.length > 0) {
          clearInterval(check);
          resolve();
        }
      }, 1000);

      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 120_000);
    });

    await client.disconnect();

    // During market hours we should get events; outside hours, skip
    if (events.length > 0) {
      expect(events[0].ev).toBe("AM");
      expect(typeof events[0].sym).toBe("string");
    }
  }, 130_000);
});
