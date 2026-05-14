import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { markets } from "./routes/markets.js";
import { portfolio } from "./routes/portfolio.js";
import { surfpoolActivity } from "./routes/surfpool-activity.js";
import { tx } from "./routes/tx.js";
import { faucet } from "./routes/faucet.js";
import { agents } from "./routes/agents.js";
import { pnl } from "./routes/pnl.js";
import { stats } from "./routes/stats.js";
import { v1 } from "./v1/event-price.js";
import { x402 } from "./v1/x402.js";

const app = new Hono();

// CORS — allow all origins in dev
app.use("*", cors({ origin: "*" }));

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// Route groups
app.route("/api/markets", markets);
app.route("/api/portfolio", portfolio);
app.route("/api/agent", surfpoolActivity);
app.route("/api/tx", tx);
// faucet routes self-mount under /api/faucet/* (full paths inside)
app.route("/", faucet);
// agent routes self-mount under /api/agents/* (full paths inside)
app.route("/", agents);
// pnl routes self-mount under /api/agents/:sns/pnl (full paths inside)
app.route("/", pnl);
// stats routes self-mount under /api/stats/* (full paths inside)
app.route("/", stats);

// v1 public oracle API — x402-priced in production; free during devnet.
// Endpoints: /v1/events, /v1/event-price, /v1/event-detail
// x402 middleware logs would-charge amounts in dev; enforces payment in prod.
app.use("/v1/*", x402());
app.route("/v1", v1);

const port = Number(process.env.PORT) || 3001;

console.log(`Bundie backend listening on port ${port}`);

serve({ fetch: app.fetch, port });

export default app;
