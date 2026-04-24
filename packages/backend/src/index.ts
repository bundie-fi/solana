import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { markets } from "./routes/markets.js";
import { portfolio } from "./routes/portfolio.js";
import { tx } from "./routes/tx.js";

const app = new Hono();

// CORS — allow all origins in dev
app.use("*", cors({ origin: "*" }));

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// Route groups
app.route("/api/markets", markets);
app.route("/api/portfolio", portfolio);
app.route("/api/tx", tx);

const port = Number(process.env.PORT) || 3001;

console.log(`Bundie backend listening on port ${port}`);

serve({ fetch: app.fetch, port });

export default app;
