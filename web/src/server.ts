import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { api } from "./api/routes";

const app = new Hono();

// API routes
app.route("/api", api);

// Serve static assets in production
app.use("/*", serveStatic({ root: "./dist/client" }));

// SPA fallback — serve index.html for all non-API, non-static routes
app.get("*", serveStatic({ path: "./dist/client/index.html" }));

const port = Number(process.env.PORT) || 3000;

console.log(`Fire Web running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 120,
};
