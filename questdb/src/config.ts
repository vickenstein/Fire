import type { QuestDBConfig, ILPWriterConfig, PipelineConfig } from "./types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function loadQuestDBConfig(): QuestDBConfig {
  return {
    ilp: {
      host: process.env.QUESTDB_ILP_HOST ?? "localhost",
      port: Number(process.env.QUESTDB_ILP_PORT) || 9009,
    },
    pg: {
      host: process.env.QUESTDB_PG_HOST ?? "localhost",
      port: Number(process.env.QUESTDB_PG_PORT) || 8812,
      user: process.env.QUESTDB_PG_USER ?? "admin",
      password: process.env.QUESTDB_PG_PASSWORD ?? "quest",
    },
  };
}

const BACKFILL_ILP: ILPWriterConfig = {
  autoFlushRows: 10_000,
  autoFlushIntervalMs: 0,
};

const LIVE_ILP: ILPWriterConfig = {
  autoFlushRows: 500,
  autoFlushIntervalMs: 500,
};

export function loadConfig(): PipelineConfig {
  return {
    questdb: loadQuestDBConfig(),
    ilp: {
      backfill: BACKFILL_ILP,
      live: LIVE_ILP,
    },
    massive: {
      apiKey: requireEnv("MASSIVE_API_KEY"),
    },
  };
}
