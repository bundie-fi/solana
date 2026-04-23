//! perp_open — minimal-payload Drift `place_perp_order` (long or short market).
//!
//! Distinct from dispatch byte 7 (`perp_place_order`, the generic
//! Mango/Zeta path) because Drift's `OrderParams` Borsh layout is too
//! different from Mango's flat 44-byte arg list to share an encoder. This
//! ix carries only the three values the caller actually picks
//! (market_index, base_amount, direction); everything else (Market type,
//! Perp market, no triggers, no auctions) is hard-coded in the Beethoven
//! adapter's byte template.
//!
//! Accounts:
//!   [0] authority (signer)                    — caller (must match strategy.authority)
//!   [1] strategy  (writable, program-owned)   — wallet PDA bump source
//!   [2..] remaining_accounts                  — Drift perps manifest:
//!         [0] drift_program (detector), [1] state, [2] user,
//!         [3] authority = wallet PDA, [4..] perp_market + oracle (+ extras)
//!
//! Instruction data (11 bytes, after the dispatch byte stripped by lib.rs):
//!   [00..02] market_index : u16 LE  (0 = SOL-PERP)
//!   [02..10] base_amount  : u64 LE  (Drift base precision)
//!   [10..11] direction    : u8      (0 = Long, 1 = Short)

use core::mem::MaybeUninit;

use pinocchio::{
    account::AccountView,
    address::Address,
    cpi::{Seed, Signer},
    error::ProgramError,
    ProgramResult,
};

use crate::{
    error,
    state::strategy::{Strategy, STATUS_ACTIVE},
    util,
};

const DATA_LEN: usize = 11;

pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if data.len() != DATA_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }

    let authority = &accounts[0];
    let strategy_acc = &accounts[1];
    let remaining = &accounts[2..];

    util::assert_signer(authority)?;
    util::assert_writable(strategy_acc)?;
    util::assert_owned_by(strategy_acc, program_id)?;

    if remaining.is_empty() {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    // ── Validate strategy + authority ─────────────────────────────────────
    let wallet_bump = {
        let strat_data = strategy_acc.try_borrow()?;

        if !Strategy::check_discriminator(&strat_data) {
            return Err(error::err(error::ERROR_INVALID_DISCRIMINATOR));
        }
        if Strategy::status(&strat_data) != STATUS_ACTIVE {
            return Err(error::err(error::ERROR_STRATEGY_NOT_ACTIVE));
        }
        let stored_authority = Strategy::authority(&strat_data);
        util::assert_keys_equal(authority.address(), unsafe {
            &*(stored_authority as *const [u8; 32] as *const Address)
        })?;

        Strategy::wallet_bump(&strat_data)
    };

    // ── Wallet PDA signer (inline MaybeUninit — see init_position.rs) ────
    // Per memory note (Pinocchio inline signer pattern), we MUST keep the
    // Seed/Signer construction inline in this stack frame. Extracting it
    // to a helper invalidates the seed-slice pointer when the helper
    // returns, leading to garbage signers + InvalidSeeds at the CPI.
    let wallet_bump_slice = [wallet_bump];
    let wallet_seeds: &[&[u8]] = &[
        b"wallet",
        strategy_acc.address().as_ref(),
        &wallet_bump_slice,
    ];

    let mut buf: [MaybeUninit<Seed>; 16] = [
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
    ];
    let len = wallet_seeds.len();
    for i in 0..len {
        buf[i].write(Seed::from(wallet_seeds[i]));
    }
    let seeds = unsafe { core::slice::from_raw_parts(buf.as_ptr() as *const Seed<'_>, len) };
    let signer = Signer::from(seeds);

    // ── Decode data + dispatch via beethoven Drift perps adapter ─────────
    let order_data = beethoven::PerpsData::Drift(beethoven::drift_perps::DriftPlacePerpOrderData {
        market_index: u16::from_le_bytes(data[0..2].try_into().unwrap()),
        base_asset_amount: u64::from_le_bytes(data[2..10].try_into().unwrap()),
        direction: data[10],
    });

    let perps_ctx = beethoven::try_from_perps_context(remaining)?;
    <beethoven::PerpsContext as beethoven::Perps>::place_order_signed(
        &perps_ctx,
        &order_data,
        &[signer],
    )?;

    Ok(())
}
