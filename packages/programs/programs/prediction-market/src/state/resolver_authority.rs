//! ResolverAuthority — pinned-resolver PDA for event markets.
//!
//! Each event market (kind 7/8/9 in `market.rs`) has exactly one
//! ResolverAuthority PDA derived from `["resolver_auth", market.key()]`.
//! `resolve_event` requires the transaction to be signed by the pubkey
//! recorded here, so the off-chain resolver bound at create-time is the
//! only key that can move the market to Resolved.
//!
//! `config_hash` pins the off-chain resolver's source configuration: the
//! blake3 hash of the resolver's entry in `scripts/resolvers/sources.json`.
//! Storing it on-chain means the resolver cannot be silently re-pointed at
//! a different feed mid-window — clients can verify the hash before they
//! trust the resolution.

use anchor_lang::prelude::*;

/// PDA seed prefix for ResolverAuthority. Concatenated with the market
/// pubkey: `[b"resolver_auth", market.key().as_ref()]`.
pub const RESOLVER_AUTH_SEED: &[u8] = b"resolver_auth";

#[account]
#[derive(InitSpace)]
pub struct ResolverAuthority {
    /// The pubkey allowed to sign `resolve_event` for this market.
    /// Set at create-time via `create_event`; immutable thereafter
    /// (v1 ships no rotation ix — that lands when the dispute layer does).
    pub resolver: Pubkey,
    /// blake3 hash of the resolver's `scripts/resolvers/sources.json` entry.
    /// Off-chain resolvers verify this before signing — if it doesn't match
    /// their loaded config, they refuse to resolve.
    pub config_hash: [u8; 32],
    /// The market this resolver is bound to. Defence-in-depth — a stale
    /// PDA passed by a malicious client is rejected on key mismatch.
    pub market: Pubkey,
    /// PDA bump.
    pub bump: u8,
}
