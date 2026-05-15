/**
 * v1 — WebSocket live price stream for AI agents.
 *
 *   WS  /v1/event-price/stream
 *
 * Protocol (JSON-encoded text frames in both directions):
 *
 *   Client → Server
 *     { "op": "subscribe",   "event_ids": ["usdc_depeg_5pct", "kamino_..."] }
 *     { "op": "unsubscribe", "event_ids": [...] }
 *     { "op": "ping" }
 *
 *   Server → Client
 *     // Initial snapshot fired once per subscribed event_id after subscribe:
 *     { "op": "snapshot", "data": { event_id, price, as_of, signed_attestation } }
 *
 *     // Push fired whenever the LMSR price moves for a subscribed event_id:
 *     { "op": "update",   "data": { event_id, price, as_of, signed_attestation } }
 *
 *     { "op": "pong" }
 *     { "op": "error", "error": "<reason>" }
 *
 * Same ed25519 signing key as the REST /v1/event-price endpoint. Payloads
 * are signed over the four-field minimal shape (event_id, price, as_of —
 * the signed_attestation field itself is excluded from canonicalisation,
 * same as REST).
 *
 * Hook: the indexer's refresh() loop calls emitPriceUpdate(eventId) when
 * a new buy/sell trade is observed for the event's market. Track-record
 * bumps from the resolver runner DO NOT fire updates — only LMSR price
 * moves do.
 */

import { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { minimalPriceSnapshot } from "./event-price.js";
import { onPriceUpdate } from "./price-emitter.js";

interface ClientMessage {
  op: "subscribe" | "unsubscribe" | "ping";
  event_ids?: string[];
}

/**
 * Build the WS sub-router. The Node `upgradeWebSocket` helper comes from
 * the caller (createNodeWebSocket lives at the top-level server boot so
 * the same instance can be injected into `serve()`).
 */
export function buildStreamRouter(
  upgradeWebSocket: UpgradeWebSocket,
): Hono {
  const stream = new Hono();

  stream.get(
    "/stream",
    upgradeWebSocket(() => {
      // Per-connection subscription set. Bounded by client behaviour;
      // a malicious client subscribing to every event still costs O(N)
      // memory per socket which is fine for the v1 surface.
      const subscribed = new Set<string>();
      let unsubscribeEmitter: (() => void) | null = null;

      return {
        async onOpen(_evt, ws) {
          // Wire the price-update listener once per socket. The listener
          // filters by the per-socket subscription set so one shared
          // emitter fans out cleanly to N sockets.
          unsubscribeEmitter = onPriceUpdate(async (eventId) => {
            if (!subscribed.has(eventId)) return;
            try {
              const snap = await minimalPriceSnapshot(eventId);
              if (!snap) return;
              ws.send(JSON.stringify({ op: "update", data: snap }));
            } catch {
              // Don't kill the socket on a single failed push; the
              // next trade or a fresh subscribe will retry.
            }
          });
        },

        async onMessage(evt, ws) {
          let msg: ClientMessage;
          try {
            const raw =
              typeof evt.data === "string"
                ? evt.data
                : new TextDecoder().decode(evt.data as ArrayBuffer);
            msg = JSON.parse(raw) as ClientMessage;
          } catch {
            ws.send(JSON.stringify({ op: "error", error: "Invalid JSON" }));
            return;
          }

          if (msg.op === "ping") {
            ws.send(JSON.stringify({ op: "pong" }));
            return;
          }

          if (msg.op === "subscribe") {
            const ids = Array.isArray(msg.event_ids) ? msg.event_ids : [];
            if (ids.length === 0) {
              ws.send(
                JSON.stringify({
                  op: "error",
                  error: "subscribe requires non-empty event_ids[]",
                }),
              );
              return;
            }
            // Cap per-connection subscriptions to keep memory bounded.
            const CAP = 200;
            for (const id of ids) {
              if (typeof id !== "string" || id.length === 0) continue;
              if (subscribed.size >= CAP) break;
              subscribed.add(id);
            }
            // Fire initial snapshots in parallel; unknown event_ids
            // get an error frame instead of being silently dropped.
            await Promise.all(
              ids.map(async (id) => {
                if (typeof id !== "string" || !subscribed.has(id)) return;
                try {
                  const snap = await minimalPriceSnapshot(id);
                  if (!snap) {
                    ws.send(
                      JSON.stringify({
                        op: "error",
                        error: `Unknown event_id: ${id}`,
                      }),
                    );
                    subscribed.delete(id);
                    return;
                  }
                  ws.send(JSON.stringify({ op: "snapshot", data: snap }));
                } catch (err) {
                  ws.send(
                    JSON.stringify({
                      op: "error",
                      error: `snapshot failed for ${id}: ${(err as Error).message}`,
                    }),
                  );
                }
              }),
            );
            return;
          }

          if (msg.op === "unsubscribe") {
            const ids = Array.isArray(msg.event_ids) ? msg.event_ids : [];
            for (const id of ids) {
              if (typeof id === "string") subscribed.delete(id);
            }
            return;
          }

          ws.send(
            JSON.stringify({
              op: "error",
              error: `Unknown op: ${String((msg as { op: unknown }).op)}`,
            }),
          );
        },

        onClose() {
          subscribed.clear();
          if (unsubscribeEmitter) {
            unsubscribeEmitter();
            unsubscribeEmitter = null;
          }
        },

        onError(err) {
          const msg =
            err instanceof Error
              ? err.message
              : typeof err === "object" && err !== null && "type" in err
                ? String((err as { type: unknown }).type)
                : String(err);
          console.warn(`[event-price-stream] socket error: ${msg}`);
        },
      };
    }),
  );

  return stream;
}
