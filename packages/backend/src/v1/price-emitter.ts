/**
 * In-process event emitter for LMSR price moves.
 *
 * Producers: the indexer's `refresh()` loop calls `emitPriceUpdate(eventId)`
 * whenever a new trade is observed for a market. The WS stream handler
 * subscribes per-event_id and pushes signed snapshots to connected clients.
 *
 * Why in-process: the backend is single-process per Railway service
 * (per CLAUDE.md). No Redis / Kafka / cross-instance pubsub needed —
 * a Node EventEmitter is the right tool for the v1 surface.
 *
 * Track-record bumps from the resolver runner DO NOT go through this
 * emitter. Only actual LMSR price moves (i.e. share-count changes from
 * buy_event_shares / sell_event_shares) fire updates.
 */

import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
// Streams can have hundreds of subscribed events; unbounded is fine
// since each subscription is bounded by client count, not event count.
emitter.setMaxListeners(0);

const PRICE_UPDATE = "price-update";

export type PriceUpdateListener = (eventId: string) => void;

/** Signal that the LMSR price for `eventId` may have moved. */
export function emitPriceUpdate(eventId: string): void {
  emitter.emit(PRICE_UPDATE, eventId);
}

/** Subscribe to ALL price updates; the WS handler filters by subscription set. */
export function onPriceUpdate(listener: PriceUpdateListener): () => void {
  emitter.on(PRICE_UPDATE, listener);
  return () => emitter.off(PRICE_UPDATE, listener);
}
