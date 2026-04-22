use pinocchio::{
    account::AccountView,
    address::Address,
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    cpi, error,
    state::{nav_oracle::NavOracle, strategy::Strategy},
    util,
};

const NAV_SCALE: u128 = 1_000_000_000;

pub fn process(program_id: &Address, accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    // ----------------------------------------------------------------
    // 1. Unpack accounts
    // ----------------------------------------------------------------

    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let cranker = &accounts[0];
    let strategy_acc = &accounts[1];
    let nav_oracle_acc = &accounts[2];
    let wallet_token_ata = &accounts[3];

    util::assert_signer(cranker)?;
    util::assert_writable(strategy_acc)?;
    util::assert_writable(nav_oracle_acc)?;
    util::assert_owned_by(strategy_acc, program_id)?;
    util::assert_owned_by(nav_oracle_acc, program_id)?;

    // ----------------------------------------------------------------
    // 2. Read strategy data
    // ----------------------------------------------------------------

    let (total_shares, _current_nav, high_water_mark, twap_accumulator, twap_last_slot) = {
        let strat_data = strategy_acc.try_borrow()?;

        if !Strategy::check_discriminator(&strat_data) {
            return Err(error::err(error::ERROR_INVALID_DISCRIMINATOR));
        }

        (
            Strategy::total_shares(&strat_data),
            Strategy::current_nav(&strat_data),
            Strategy::high_water_mark(&strat_data),
            Strategy::nav_twap_accumulator(&strat_data),
            Strategy::twap_last_slot(&strat_data),
        )
    };

    // ----------------------------------------------------------------
    // 3. Read nav_oracle and validate
    // ----------------------------------------------------------------

    let (last_snapshot_slot, min_snapshot_interval, twap_window, snapshot_count) = {
        let oracle_data = nav_oracle_acc.try_borrow()?;

        if !NavOracle::check_discriminator(&oracle_data) {
            return Err(error::err(error::ERROR_INVALID_DISCRIMINATOR));
        }

        // Verify oracle.strategy == strategy address
        let oracle_strategy = NavOracle::strategy(&oracle_data);
        util::assert_keys_equal(
            unsafe { &*(oracle_strategy as *const [u8; 32] as *const Address) },
            strategy_acc.address(),
        )?;

        (
            NavOracle::last_snapshot_slot(&oracle_data),
            NavOracle::min_snapshot_interval(&oracle_data),
            NavOracle::twap_window(&oracle_data),
            NavOracle::snapshot_count(&oracle_data),
        )
    };

    // ----------------------------------------------------------------
    // 4. Get current slot and enforce min_snapshot_interval
    // ----------------------------------------------------------------

    let clock = Clock::get()?;
    let current_slot = clock.slot;

    let slots_since_last = current_slot.saturating_sub(last_snapshot_slot);
    if slots_since_last < min_snapshot_interval {
        return Err(error::err(error::ERROR_SNAPSHOT_TOO_SOON));
    }

    // ----------------------------------------------------------------
    // 5. Read portfolio value from wallet_token_ata
    //
    // TODO(C4): For yield strategies, this only reads the wallet ATA
    // balance and does not account for tokens deposited into Kamino
    // reserves. Full Kamino reserve exchange-rate read will be added
    // during devnet integration so the NAV reflects lent assets too.
    // ----------------------------------------------------------------

    let portfolio_value = {
        let ata_data = wallet_token_ata.try_borrow()?;
        cpi::spl_token::read_token_amount(&ata_data)
    };

    // ----------------------------------------------------------------
    // 6. Compute nav_per_share
    // ----------------------------------------------------------------

    let nav_per_share: u64 = if total_shares > 0 {
        let nps = (portfolio_value as u128)
            .checked_mul(NAV_SCALE)
            .ok_or(error::err(error::ERROR_NAV_OVERFLOW))?
            / (total_shares as u128);
        nps as u64
    } else {
        0
    };

    // ----------------------------------------------------------------
    // 7. TWAP calculation (EMA approach)
    // ----------------------------------------------------------------

    let slots_elapsed = current_slot.saturating_sub(twap_last_slot);

    // EMA: twap = (nav_per_share * weight + old_twap * complement) / twap_window
    // weight = min(slots_elapsed, twap_window), complement = twap_window - weight
    let old_twap = if twap_accumulator > 0 {
        twap_accumulator as u64
    } else {
        nav_per_share
    };

    let weight = slots_elapsed.min(twap_window);
    let complement = twap_window.saturating_sub(weight);

    let twap_value: u64 = if twap_window > 0 {
        ((nav_per_share as u128 * weight as u128 + old_twap as u128 * complement as u128)
            / twap_window as u128) as u64
    } else {
        nav_per_share
    };

    // Store current TWAP value in the accumulator field (repurposed as EMA state)
    let new_accumulator = twap_value as u128;

    // ----------------------------------------------------------------
    // 8. Write NavOracle
    // ----------------------------------------------------------------

    {
        let oracle_data = unsafe { nav_oracle_acc.borrow_unchecked_mut() };
        NavOracle::set_nav_per_share(oracle_data, nav_per_share);
        NavOracle::set_twap_value(oracle_data, twap_value);
        NavOracle::set_last_snapshot_slot(oracle_data, current_slot);
        NavOracle::set_snapshot_count(oracle_data, snapshot_count + 1);
    }

    // ----------------------------------------------------------------
    // 9. Write Strategy
    // ----------------------------------------------------------------

    {
        let strat_data = unsafe { strategy_acc.borrow_unchecked_mut() };

        Strategy::set_current_nav(strat_data, portfolio_value);
        Strategy::set_last_nav_slot(strat_data, current_slot);
        Strategy::set_nav_twap_accumulator(strat_data, new_accumulator);
        Strategy::set_twap_last_slot(strat_data, current_slot);

        // Update high water mark (per-share, 1e9 scaled) if current exceeds it
        if total_shares > 0 && nav_per_share > high_water_mark {
            Strategy::set_high_water_mark(strat_data, nav_per_share);
        }
    }

    Ok(())
}
