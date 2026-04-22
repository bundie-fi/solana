//! snapshot_positions — permissionless keeper instruction.
//!
//! Reads the strategy's current composition (protocol, reserve, portfolio value,
//! shares, NAV) and writes it into the PositionSnapshots PDA. On first call for
//! a given strategy, the PDA is created. On subsequent calls, the interval
//! between calls must be at least MIN_SNAPSHOT_INTERVAL_SLOTS (~24h).
//!
//! Accounts:
//!   [0] keeper (signer, writable) — funds the account on first call
//!   [1] strategy (read, program-owned)
//!   [2] position_snapshots (writable, PDA ["position_snapshots", strategy])
//!   [3] system_program
//!
//! No instruction data — the keeper just triggers a read-and-write.
//!
//! v5 spec §5.6.

use pinocchio::{
    account::AccountView,
    address::Address,
    error::ProgramError,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::{
    cpi, error,
    state::{
        position_snapshots::{
            PositionSnapshots, MIN_SNAPSHOT_INTERVAL_SLOTS, POSITION_SNAPSHOTS_LEN,
        },
        strategy::Strategy,
    },
    util,
};

pub fn process(program_id: &Address, accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    // ----------------------------------------------------------------
    // 1. Unpack accounts
    // ----------------------------------------------------------------

    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let keeper = &accounts[0];
    let strategy_acc = &accounts[1];
    let snapshots = &accounts[2];
    // accounts[3] = system_program (unused here, required by create_account CPI)

    util::assert_signer(keeper)?;
    util::assert_writable(keeper)?;
    util::assert_writable(snapshots)?;
    util::assert_owned_by(strategy_acc, program_id)?;

    // ----------------------------------------------------------------
    // 2. Derive and verify PositionSnapshots PDA
    // ----------------------------------------------------------------

    let (snapshots_address, snapshots_bump) = Address::find_program_address(
        &[b"position_snapshots", strategy_acc.address().as_ref()],
        program_id,
    );
    util::assert_keys_equal(snapshots.address(), &snapshots_address)?;

    // ----------------------------------------------------------------
    // 3. Read strategy fields
    // ----------------------------------------------------------------

    let (protocol, reserve, portfolio_value, total_shares, nav_per_share, high_water_mark) = {
        let strat_data = strategy_acc.try_borrow()?;

        if !Strategy::check_discriminator(&strat_data) {
            return Err(error::err(error::ERROR_INVALID_DISCRIMINATOR));
        }

        let total_shares = Strategy::total_shares(&strat_data);
        let portfolio_value = Strategy::current_nav(&strat_data);
        // nav_per_share is stored per-share, derive from twap_accumulator which
        // holds the latest TWAP value (kept in sync by update_nav).
        let nav_per_share = Strategy::nav_twap_accumulator(&strat_data) as u64;

        (
            *Strategy::protocol(&strat_data),
            *Strategy::reserve(&strat_data),
            portfolio_value,
            total_shares,
            nav_per_share,
            Strategy::high_water_mark(&strat_data),
        )
    };

    // ----------------------------------------------------------------
    // 4. Get current clock
    // ----------------------------------------------------------------

    let clock = Clock::get()?;
    let current_slot = clock.slot;
    let now = clock.unix_timestamp;

    // ----------------------------------------------------------------
    // 5. Init PDA on first call, otherwise enforce the 24h interval
    // ----------------------------------------------------------------

    let is_first_call = snapshots.data_len() == 0;

    if is_first_call {
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance_unchecked(POSITION_SNAPSHOTS_LEN);
        let bump_slice = [snapshots_bump];
        cpi::system::create_account(
            keeper,
            snapshots,
            lamports,
            POSITION_SNAPSHOTS_LEN as u64,
            program_id,
            &[
                b"position_snapshots",
                strategy_acc.address().as_ref(),
                &bump_slice,
            ],
        )?;
    } else {
        // Must already be a PositionSnapshots account — validate the discriminator.
        let data = snapshots.try_borrow()?;
        if !PositionSnapshots::check_discriminator(&data) {
            return Err(error::err(error::ERROR_INVALID_DISCRIMINATOR));
        }

        // Verify this snapshot account belongs to this strategy.
        let stored_strategy = PositionSnapshots::strategy(&data);
        util::assert_keys_equal(
            unsafe { &*(stored_strategy as *const [u8; 32] as *const Address) },
            strategy_acc.address(),
        )?;

        // Enforce 24h min interval between writes.
        let last_slot = PositionSnapshots::snapshot_slot(&data);
        let slots_since = current_slot.saturating_sub(last_slot);
        if slots_since < MIN_SNAPSHOT_INTERVAL_SLOTS {
            return Err(error::err(error::ERROR_SNAPSHOT_TOO_SOON));
        }
    }

    // ----------------------------------------------------------------
    // 6. Write fields
    // ----------------------------------------------------------------

    let prev_count = if is_first_call {
        0
    } else {
        let data = snapshots.try_borrow()?;
        PositionSnapshots::snapshot_count(&data)
    };

    {
        let data = unsafe { snapshots.borrow_unchecked_mut() };
        if is_first_call {
            PositionSnapshots::set_discriminator(data);
            PositionSnapshots::set_strategy(
                data,
                strategy_acc.address().as_ref().try_into().unwrap(),
            );
            PositionSnapshots::set_bump(data, snapshots_bump);
        }
        PositionSnapshots::set_snapshot_at(data, now);
        PositionSnapshots::set_snapshot_slot(data, current_slot);
        PositionSnapshots::set_protocol(data, &protocol);
        PositionSnapshots::set_reserve(data, &reserve);
        PositionSnapshots::set_portfolio_value(data, portfolio_value);
        PositionSnapshots::set_total_shares(data, total_shares);
        PositionSnapshots::set_nav_per_share(data, nav_per_share);
        PositionSnapshots::set_high_water_mark(data, high_water_mark);
        PositionSnapshots::set_snapshot_count(data, prev_count + 1);
    }

    Ok(())
}
