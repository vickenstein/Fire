import { Orchestrator } from "./src/orchestrator";

const orchestrator = new Orchestrator();

// Graceful shutdown on SIGINT (Ctrl+C) and SIGTERM (Docker stop)
async function shutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down...`);
  await orchestrator.stop();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log("Fire Orchestrator starting...");
await orchestrator.start();
console.log("Orchestrator is running. Press Ctrl+C to stop.");
