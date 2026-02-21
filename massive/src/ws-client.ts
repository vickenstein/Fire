import { websocketClient } from "@polygon.io/client-js";
import { loadMassiveConfig } from "./config";
import { ConnectionState } from "./types";
import type { StockEvent } from "./types";

type EventHandler<T> = (event: T) => void;

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_RECONNECT_BASE_DELAY = 1000; // ms
const AUTH_TIMEOUT = 10_000; // ms

export interface WSClientOptions {
  apiKey?: string;
  baseUrl?: string;
  maxReconnectAttempts?: number;
  reconnectBaseDelay?: number;
}

export class WSClient {
  private readonly apiKey: string;
  private readonly baseUrl: string | undefined;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectBaseDelay: number;

  private ws: ReturnType<ReturnType<typeof websocketClient>["stocks"]> | null =
    null;
  private _state: ConnectionState = ConnectionState.DISCONNECTED;
  private _subscriptions = new Set<string>();
  private reconnectAttempts = 0;
  private intentionalClose = false;

  // Event handlers
  private handlers = new Map<string, EventHandler<any>[]>();
  private errorHandlers: EventHandler<Error>[] = [];
  private stateHandlers: EventHandler<ConnectionState>[] = [];

  // Stream controller (if stream() was called)
  private streamController: ReadableStreamDefaultController<StockEvent> | null =
    null;

  constructor(options?: WSClientOptions) {
    const config = loadMassiveConfig();
    this.apiKey = options?.apiKey ?? config.apiKey;
    this.baseUrl = options?.baseUrl;
    this.maxReconnectAttempts =
      options?.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.reconnectBaseDelay =
      options?.reconnectBaseDelay ?? DEFAULT_RECONNECT_BASE_DELAY;
  }

  get connectionState(): ConnectionState {
    return this._state;
  }

  get activeSubscriptions(): ReadonlySet<string> {
    return this._subscriptions;
  }

  /**
   * Primary streaming interface.
   * Connects, subscribes to channels, and returns a ReadableStream of events.
   * The stream stays open until disconnect() is called.
   */
  stream(channels: string | string[]): ReadableStream<StockEvent> {
    const channelList = Array.isArray(channels) ? channels : [channels];

    return new ReadableStream<StockEvent>({
      start: async (controller) => {
        this.streamController = controller;
        try {
          await this.connect();
          this.subscribe(channelList);
        } catch (err) {
          controller.error(err);
        }
      },
      cancel: () => {
        this.streamController = null;
        this.disconnect();
      },
    });
  }

  /**
   * Connect to Massive WebSocket for stocks.
   * Resolves when authenticated.
   */
  async connect(): Promise<void> {
    if (this._state === ConnectionState.AUTHENTICATED) return;

    this.setState(ConnectionState.CONNECTING);
    this.intentionalClose = false;

    return new Promise<void>((resolve, reject) => {
      const args: [string, ...string[]] = this.baseUrl
        ? [this.apiKey, this.baseUrl]
        : [this.apiKey];

      const client = websocketClient(...args);
      this.ws = client.stocks();

      const timeout = setTimeout(() => {
        reject(new Error("WebSocket connection timeout (10s)"));
      }, AUTH_TIMEOUT);

      this.ws.onmessage = (event: { data: string }) => {
        let messages: any[];
        try {
          const parsed = JSON.parse(event.data);
          messages = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          this.emitError(new Error(`Failed to parse WS message: ${event.data}`));
          return;
        }

        for (const msg of messages) {
          if (msg.ev === "status") {
            if (msg.status === "auth_success") {
              clearTimeout(timeout);
              this.setState(ConnectionState.AUTHENTICATED);
              this.reconnectAttempts = 0;
              resolve();
            } else if (msg.status === "auth_failed") {
              clearTimeout(timeout);
              reject(
                new Error(
                  "WebSocket authentication failed. Check your MASSIVE_API_KEY.",
                ),
              );
            }
            continue;
          }

          // Dispatch stock events
          if (msg.ev === "T" || msg.ev === "Q" || msg.ev === "AM") {
            this.dispatchEvent(msg as StockEvent);
          }
        }
      };

      this.ws.onerror = (err: Event) => {
        clearTimeout(timeout);
        const error = new Error(`WebSocket error: ${err}`);
        this.emitError(error);
        if (this._state === ConnectionState.CONNECTING) {
          reject(error);
        }
      };

      this.ws.onclose = () => {
        if (this._state === ConnectionState.CONNECTING) {
          clearTimeout(timeout);
          reject(new Error("WebSocket closed before authentication"));
        }

        this.setState(ConnectionState.DISCONNECTED);

        if (!this.intentionalClose) {
          this.attemptReconnect();
        }
      };
    });
  }

  /**
   * Gracefully disconnect. Unsubscribes all, closes socket.
   */
  async disconnect(): Promise<void> {
    this.intentionalClose = true;

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Already closed
      }
      this.ws = null;
    }

    this._subscriptions.clear();
    this.setState(ConnectionState.DISCONNECTED);

    if (this.streamController) {
      try {
        this.streamController.close();
      } catch {
        // Already closed
      }
      this.streamController = null;
    }
  }

  /**
   * Subscribe to one or more channels.
   * Channel format: "AM.AAPL", "T.MSFT", "Q.*", etc.
   */
  subscribe(channels: string | string[]): void {
    const channelList = Array.isArray(channels) ? channels : [channels];

    for (const ch of channelList) {
      this._subscriptions.add(ch);
    }

    if (this.ws && this._state === ConnectionState.AUTHENTICATED) {
      this.sendSubscribe(channelList);
    }
  }

  /**
   * Unsubscribe from one or more channels.
   */
  unsubscribe(channels: string | string[]): void {
    const channelList = Array.isArray(channels) ? channels : [channels];

    for (const ch of channelList) {
      this._subscriptions.delete(ch);
    }

    if (this.ws && this._state === ConnectionState.AUTHENTICATED) {
      this.sendUnsubscribe(channelList);
    }
  }

  /**
   * Register a handler for a specific event type.
   * Returns an unsubscribe function.
   */
  on(
    eventType: "AM" | "T" | "Q",
    handler: EventHandler<StockEvent>,
  ): () => void {
    const handlers = this.handlers.get(eventType) ?? [];
    handlers.push(handler);
    this.handlers.set(eventType, handlers);

    return () => {
      const list = this.handlers.get(eventType);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
  }

  /** Register handler for all events. */
  onAny(handler: EventHandler<StockEvent>): () => void {
    const handlers = this.handlers.get("*") ?? [];
    handlers.push(handler);
    this.handlers.set("*", handlers);

    return () => {
      const list = this.handlers.get("*");
      if (list) {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
  }

  /** Register error handler. */
  onError(handler: EventHandler<Error>): () => void {
    this.errorHandlers.push(handler);
    return () => {
      const idx = this.errorHandlers.indexOf(handler);
      if (idx !== -1) this.errorHandlers.splice(idx, 1);
    };
  }

  /** Register connection state change handler. */
  onStateChange(handler: EventHandler<ConnectionState>): () => void {
    this.stateHandlers.push(handler);
    return () => {
      const idx = this.stateHandlers.indexOf(handler);
      if (idx !== -1) this.stateHandlers.splice(idx, 1);
    };
  }

  // --- Private ---

  private dispatchEvent(event: StockEvent): void {
    // Push to stream if active
    if (this.streamController) {
      try {
        this.streamController.enqueue(event);
      } catch {
        // Stream may be closed
      }
    }

    // Typed handlers
    const handlers = this.handlers.get(event.ev);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          this.emitError(
            new Error(`Handler error for ${event.ev}: ${err}`),
          );
        }
      }
    }

    // Firehose handlers (stored under '*')
    const anyHandlers = this.handlers.get("*");
    if (anyHandlers) {
      for (const handler of anyHandlers) {
        try {
          handler(event);
        } catch {
          // Swallow firehose handler errors
        }
      }
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      const err = new Error(
        `Max reconnection attempts (${this.maxReconnectAttempts}) exceeded`,
      );
      this.emitError(err);

      if (this.streamController) {
        try {
          this.streamController.error(err);
        } catch {
          // Already errored/closed
        }
        this.streamController = null;
      }
      return;
    }

    this.setState(ConnectionState.RECONNECTING);
    this.reconnectAttempts++;

    const delay =
      this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = delay * 0.2 * Math.random();
    await new Promise((r) => setTimeout(r, delay + jitter));

    try {
      await this.connect();
      // Re-subscribe to all tracked channels
      if (this._subscriptions.size > 0) {
        this.sendSubscribe([...this._subscriptions]);
      }
    } catch {
      this.attemptReconnect();
    }
  }

  private sendSubscribe(channels: string[]): void {
    if (!this.ws) return;
    this.ws.send(
      JSON.stringify({ action: "subscribe", params: channels.join(",") }),
    );
  }

  private sendUnsubscribe(channels: string[]): void {
    if (!this.ws) return;
    this.ws.send(
      JSON.stringify({ action: "unsubscribe", params: channels.join(",") }),
    );
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    for (const handler of this.stateHandlers) {
      try {
        handler(state);
      } catch {
        // Swallow state handler errors
      }
    }
  }

  private emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch {
        // Swallow error handler errors
      }
    }
    if (this.errorHandlers.length === 0) {
      console.error(`ws-client: ${error.message}`);
    }
  }
}
