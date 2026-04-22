//! init_position — permissionless one-shot per-strategy protocol setup.
//!
//! Routes remaining_accounts through `beethoven::try_from_deposit_init_context`
//! so the wrapping program's wallet PDA can own Kamino UserMetadata +
//! Obligation accounts. Strategy-token signs the Kamino CPIs with the
//! wallet PDA seeds; the caller (`authority`) is the external fee payer
//! for the created accounts' rent.
//!
//! Accounts:
//!   [0] authority (signer, writable) — fee payer
//!   [1] strategy  (read, program-owned)
//!   [2..] remaining — protocol-specific init accounts, detected by
//!         first-account program id (Kamino today; Marginfi/Drift later
//!         once their DepositInit impls are filled in).
//!
//! No instruction data.
//!
//! This is the Beethoven-routed equivalent of the direct klend-sdk init
//! flow we validated in packages/programs/scripts/kamino-test-deposit.mjs.

use core::mem::MaybeUninit;

use pinocchio::{
    account::AccountView,
    address::Address,
    cpi::{Seed, Signer},
    error::ProgramError,
    ProgramResult,
};

use crate::{error, state::strategy::Strategy, util};

pub fn process(program_id: &Address, accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let authority = &accounts[0];
    let strategy_acc = &accounts[1];
    let remaining = &accounts[2..];

    util::assert_signer(authority)?;
    util::assert_writable(authority)?;
    util::assert_owned_by(strategy_acc, program_id)?;

    if remaining.is_empty() {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let wallet_bump = {
        let strat_data = strategy_acc.try_borrow()?;

        if !Strategy::check_discriminator(&strat_data) {
            return Err(error::err(error::ERROR_INVALID_DISCRIMINATOR));
        }

        Strategy::wallet_bump(&strat_data)
    };

    // Build wallet PDA signer inline — same pattern as buy_shares.rs.
    // Keeping `buf` in this stack frame (not in a helper) ensures the
    // Signer's seed-slice pointer stays valid through the CPI call.
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

    let init_ctx = beethoven::try_from_deposit_init_context(remaining)?;
    <beethoven::DepositInitContext as beethoven::DepositInit>::init_signed(&init_ctx, &[signer])?;

    Ok(())
}
