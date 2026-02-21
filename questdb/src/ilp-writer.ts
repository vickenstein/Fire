import { Sender } from "@questdb/nodejs-client";
import type { QuestDBConfig, ILPWriterConfig } from "./types";

const FLUSH_TIMEOUT_MS = 30_000; // 30s max wait per flush

export class ILPWriter {
  private sender: Sender | null = null;
  private readonly config: ILPWriterConfig;
  private readonly questdbConfig: QuestDBConfig;
  private _rowsWritten = 0;
  private _rowsErrored = 0;
  private pendingRows = 0;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(questdbConfig: QuestDBConfig, config: ILPWriterConfig) {
    this.questdbConfig = questdbConfig;
    this.config = config;
  }

  get rowsWritten(): number {
    return this._rowsWritten;
  }

  get rowsErrored(): number {
    return this._rowsErrored;
  }

  /** Get or lazily create the ILP Sender (TCP connection). */
  async getSender(): Promise<Sender> {
    if (!this.sender) {
      const { host, port } = this.questdbConfig.ilp;
      this.sender = await Sender.fromConfig(
        `tcp::addr=${host}:${port};init_buf_size=4194304;`,
      );
      await this.sender.connect();

      if (this.config.autoFlushIntervalMs > 0) {
        this.flushTimer = setInterval(
          () => this.flush(),
          this.config.autoFlushIntervalMs,
        );
      }
    }
    return this.sender;
  }

  /** Track a row that was written to the sender. Call after sender.at(). */
  addPending(): void {
    this.pendingRows++;
  }

  /** Flush if we've hit the batch threshold. */
  async maybeFlush(): Promise<void> {
    if (this.pendingRows >= this.config.autoFlushRows) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.pendingRows === 0) return;

    const count = this.pendingRows;
    try {
      const sender = await this.getSender();
      await Promise.race([
        sender.flush(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`flush timed out after ${FLUSH_TIMEOUT_MS}ms`)),
            FLUSH_TIMEOUT_MS,
          ),
        ),
      ]);
      this._rowsWritten += count;
      this.pendingRows = 0;

      // Yield to the event loop so TCP drain events can process.
      // Prevents the socket write buffer from growing unbounded
      // when we produce data faster than QuestDB can consume.
      await new Promise((r) => setTimeout(r, 1));
    } catch (error) {
      console.error(
        `ILP flush error (${count} rows): ${error instanceof Error ? error.message : String(error)}`,
      );
      this._rowsErrored += count;
      this.pendingRows = 0;

      // Tear down the broken sender so the next call to getSender()
      // creates a fresh TCP connection with a clean buffer.
      await this.resetSender();
    }
  }

  private async resetSender(): Promise<void> {
    if (this.sender) {
      try {
        await this.sender.close();
      } catch {
        // ignore close errors on a broken sender
      }
      this.sender = null;
    }
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();

    if (this.sender) {
      await this.sender.close();
      this.sender = null;
    }
  }
}
