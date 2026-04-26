import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { markets } from "./routes/markets.js";
import { portfolio } from "./routes/portfolio.js";
import { tx } from "./routes/tx.js";
import { faucet } from "./routes/faucet.js";
import { agents } from "./routes/agents.js";

const app = new Hono();

// CORS — allow all origins in dev
app.use("*", cors({ origin: "*" }));

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// Route groups
app.route("/api/markets", markets);
app.route("/api/portfolio", portfolio);
app.route("/api/tx", tx);
// faucet routes self-mount under /api/faucet/* (full paths inside)
app.route("/", faucet);
// agent routes self-mount under /api/agents/* (full paths inside)
app.route("/", agents);

const port = Number(process.env.PORT) || 3001;

console.log(`Bundie backend listening on port ${port}`);

serve({ fetch: app.fetch, port });

export default app;
