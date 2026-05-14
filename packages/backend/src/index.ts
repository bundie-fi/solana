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
import { rateLimit, startRateLimitGc } from "./v1/rate-limit.js";

const app = new Hono();

// CORS — explicit allowlist in production; wildcard only in dev.
// Set BUNDIE_CORS_ALLOWLIST as comma-separated origins (e.g.
// "https://app.solana.bundie.fi,https://docs.bundie.fi") to lock down.
const corsAllowlist = process.env.BUNDIE_CORS_ALLOWLIST
  ? process.env.BUNDIE_CORS_ALLOWLIST.split(",").map((s) => s.trim())
  : null;
app.use(
  "*",
  cors({
    origin: corsAllowlist ?? "*",
    credentials: false,
  }),
);

// Per-IP rate limiting on the public v1 surface. Free endpoints get
// a moderate cap; x402-priced endpoints inherit a higher cap because
// paying traffic is self-rate-limited.
startRateLimitGc();
app.use(
  "/v1/events",
  rateLimit("v1.events", {
    capacity: 60,
    refillPerSecond: 1, // 60 burst, 1 rps steady-state
    label: "events-list",
  }),
);
app.use(
  "/v1/event-price",
  rateLimit("v1.event-price", {
    capacity: 600,
    refillPerSecond: 5, // 600 burst, 5 rps steady-state (~300/min)
    label: "event-price",
  }),
);
app.use(
  "/v1/event-detail",
  rateLimit("v1.event-detail", {
    capacity: 120,
    refillPerSecond: 1,
    label: "event-detail",
  }),
);

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
