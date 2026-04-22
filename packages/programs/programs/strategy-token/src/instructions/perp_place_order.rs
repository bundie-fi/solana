//! perp_place_order — open or close a perp position via Beethoven::Perps.
//!
//! Single dispatch byte covers both open and close: closing a long is
//! `place_order(side=Ask, reduce_only=true, …)`; opening a long is
//! `place_order(side=Bid, reduce_only=false, …)`. This matches the
//! Beethoven `Perps` trait design (one op, side+reduce_only carry intent).
//!
//! Accounts:
//!   [0] authority (signer)                   — caller (must match strategy.authority)
//!   [1] strategy  (writable, program-owned)  — wallet PDA bump source
//!   [2..] remaining_accounts                 — perps protocol manifest
//!         (first account = protocol detector, e.g. Mango v4 program id)
//!
//! Instruction data (44 bytes, after the dispatch byte stripped by lib.rs):
//!   [00..01] side          : u8  (0=Bid 1=Ask)
//!   [01..09] price_lots    : i64 LE
//!   [09..17] max_base_lots : i64 LE
//!   [17..25] max_quote_lots: i64 LE
//!   [25..33] client_order_id: u64 LE
//!   [33..34] order_type    : u8  (0=Limit 1=IOC 2=PostOnly 3=Market 4=PostOnlySlide)
//!   [34..35] reduce_only   : u8  (0/1)
//!   [35..43] expiry_ts     : u64 LE (0 = no expiry)
//!   [43..44] limit         : u8  (book-iteration cap)

use core::mem::MaybeUninit;

use pinocchio::{
    account::AccountView,
    address::Address,
    cpi::{Seed, Signer},
    error::ProgramError,
    ProgramResult,
};

use crate::{error, state::strategy::{Strategy, STATUS_ACTIVE}, util};

const DATA_LEN: usize = 44;

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if data.len() != DATA_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }

    let authority    = &accounts[0];
    let strategy_acc = &accounts[1];
    let remaining    = &accounts[2..];

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
        util::assert_keys_equal(
            authority.address(),
            unsafe { &*(stored_authority as *const [u8; 32] as *const Address) },
        )?;

        Strategy::wallet_bump(&strat_data)
    };

    // ── Wallet PDA signer (inline MaybeUninit — see init_position.rs) ────
    let wallet_bump_slice = [wallet_bump];
    let wallet_seeds: &[&[u8]] = &[
        b"wallet",
        strategy_acc.address().as_ref(),
        &wallet_bump_slice,
    ];

    let mut buf: [MaybeUninit<Seed>; 16] = [
        MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(),
        MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(),
        MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(),
        MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(),
    ];
    let len = wallet_seeds.len();
    for i in 0..len {
        buf[i].write(Seed::from(wallet_seeds[i]));
    }
    let seeds = unsafe { core::slice::from_raw_parts(buf.as_ptr() as *const Seed<'_>, len) };
    let signer = Signer::from(seeds);

    // ── Decode data + dispatch via beethoven ─────────────────────────────
    let order_data = beethoven::PerpsData::Mango(beethoven::mango::MangoPlaceOrderData {
        side:             data[0],
        price_lots:       i64::from_le_bytes(data[1..9].try_into().unwrap()),
        max_base_lots:    i64::from_le_bytes(data[9..17].try_into().unwrap()),
        max_quote_lots:   i64::from_le_bytes(data[17..25].try_into().unwrap()),
        client_order_id:  u64::from_le_bytes(data[25..33].try_into().unwrap()),
        order_type:       data[33],
        reduce_only:      data[34] != 0,
        expiry_timestamp: u64::from_le_bytes(data[35..43].try_into().unwrap()),
        limit:            data[43],
    });

    let perps_ctx = beethoven::try_from_perps_context(remaining)?;
    <beethoven::PerpsContext as beethoven::Perps>::place_order_signed(
        &perps_ctx,
        &order_data,
        &[signer],
    )?;

    Ok(())
}
