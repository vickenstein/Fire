import { SQL } from "bun";
import type { QuestDBConfig } from "./types";

export class QuestDBClient {
  private readonly sql: SQL;

  constructor(config: QuestDBConfig) {
    this.sql = new SQL({
      hostname: config.pg.host,
      port: config.pg.port,
      username: config.pg.user,
      password: config.pg.password,
      database: "qdb",
    });
  }

  async health(): Promise<{ status: string }> {
    try {
      await this.sql`SELECT 1`;
      return { status: "ok" };
    } catch (error) {
      throw new Error(
        `QuestDB health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getLatestTimestamp(): Promise<Date | null> {
    try {
      const rows = await this.sql`SELECT max(timestamp) as latest FROM minute_bars`;
      const latest = rows[0]?.latest;
      return latest ? new Date(latest) : null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // Table may not exist yet on first run
      if (message.includes("does not exist") || message.includes("table not found")) {
        return null;
      }
      throw error;
    }
  }

  async execute(query: string): Promise<void> {
    await this.sql.unsafe(query);
  }

  async query<T = Record<string, unknown>>(query: string): Promise<T[]> {
    return await this.sql.unsafe(query) as T[];
  }

  async close(): Promise<void> {
    await this.sql.close();
  }
}
