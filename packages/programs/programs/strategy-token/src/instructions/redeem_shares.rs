use pinocchio::{
    account::AccountView,
    address::Address,
    error::ProgramError,
    ProgramResult,
};

use crate::{
    cpi,
    error,
    state::strategy::{Strategy, STATUS_ACTIVE, STRATEGY_TYPE_YIELD},
    util,
};

const NAV_SCALE: u128 = 1_000_000_000;

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    // ----------------------------------------------------------------
    // 1. Parse instruction data: shares (u64 LE, 8 bytes)
    // ----------------------------------------------------------------

    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let shares = u64::from_le_bytes(data[0..8].try_into().unwrap());
    if shares == 0 {
        return Err(error::err(error::ERROR_ZERO_AMOUNT));
    }

    // ----------------------------------------------------------------
    // 2. Unpack accounts
    // ----------------------------------------------------------------

    if accounts.len() < 10 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let redeemer          = &accounts[0];
    let strategy_acc      = &accounts[1];
    let mint_acc          = &accounts[2];
    let redeemer_shares   = &accounts[3];
    let wallet_acc        = &accounts[4];
    let wallet_token_ata  = &accounts[5];
    let redeemer_token    = &accounts[6];
    let fee_receiver_ata  = &accounts[7];
    let _token_program    = &accounts[8];
    let _system_program   = &accounts[9];
    let remaining         = &accounts[10..];

    util::assert_signer(redeemer)?;
    util::assert_writable(redeemer)?;
    util::assert_writable(strategy_acc)?;
    util::assert_writable(mint_acc)?;
    util::assert_writable(redeemer_shares)?;
    util::assert_writable(wallet_acc)?;
    util::assert_writable(wallet_token_ata)?;
    util::assert_writable(redeemer_token)?;
    util::assert_writable(fee_receiver_ata)?;

    util::assert_owned_by(strategy_acc, program_id)?;

    // ----------------------------------------------------------------
    // 3. Read strategy data
    // ----------------------------------------------------------------

    let (
        strategy_type,
        total_shares,
        current_nav,
        total_deposits,
        high_water_mark,
        fee_bps,
        wallet_bump,
        authority_bytes,
        _name_bytes,
    ) = {
        let strat_data = strategy_acc.try_borrow()?;

        if !Strategy::check_discriminator(&strat_data) {
            return Err(error::err(error::ERROR_INVALID_DISCRIMINATOR));
        }

        if Strategy::status(&strat_data) != STATUS_ACTIVE {
            return Err(error::err(error::ERROR_STRATEGY_NOT_ACTIVE));
        }

        // Verify mint matches
        let strategy_mint = Strategy::mint(&strat_data);
        util::assert_keys_equal(
            mint_acc.address(),
            unsafe { &*(strategy_mint as *const [u8; 32] as *const Address) },
        )?;

        // Verify wallet matches
        let strategy_wallet = Strategy::wallet(&strat_data);
        util::assert_keys_equal(
            wallet_acc.address(),
            unsafe { &*(strategy_wallet as *const [u8; 32] as *const Address) },
        )?;

        let mut auth = [0u8; 32];
        auth.copy_from_slice(Strategy::authority(&strat_data));
        let mut name = [0u8; 32];
        name.copy_from_slice(Strategy::name(&strat_data));

        (
            Strategy::strategy_type(&strat_data),
            Strategy::total_shares(&strat_data),
            Strategy::current_nav(&strat_data),
            Strategy::total_deposits(&strat_data),
            Strategy::high_water_mark(&strat_data),
            Strategy::fee_bps(&strat_data),
            Strategy::wallet_bump(&strat_data),
            auth,
            name,
        )
    };

    // ----------------------------------------------------------------
    // 3b. Validate fee_receiver_ata owner matches strategy authority
    // ----------------------------------------------------------------

    {
        let fee_ata_data = fee_receiver_ata.try_borrow()?;
        // SPL token account: owner is at bytes 32..64
        let fee_ata_owner: &[u8; 32] = fee_ata_data[32..64].try_into().unwrap();
        util::assert_keys_equal(
            unsafe { &*(fee_ata_owner as *const [u8; 32] as *const Address) },
            unsafe { &*(authority_bytes.as_ref() as *const [u8] as *const [u8; 32] as *const Address) },
        )?;
    }

    // ----------------------------------------------------------------
    // 4. Validate redeemer has enough shares
    // ----------------------------------------------------------------

    {
        let ata_data = redeemer_shares.try_borrow()?;
        let balance = cpi::spl_token::read_token_amount(&ata_data);
        if balance < shares {
            return Err(error::err(error::ERROR_INSUFFICIENT_SHARES));
        }
    }

    // ----------------------------------------------------------------
    // 5. Calculate gross withdrawal
    // ----------------------------------------------------------------

    if total_shares == 0 {
        return Err(error::err(error::ERROR_ZERO_SHARES));
    }

    let gross_withdrawal = ((shares as u128)
        .checked_mul(current_nav as u128)
        .ok_or(error::err(error::ERROR_NAV_OVERFLOW))?
        / (total_shares as u128)) as u64;

    // ----------------------------------------------------------------
    // 6. Performance fee calculation
    // ----------------------------------------------------------------

    let fee: u64 = {
        // HWM is stored as per-share (1e9 scaled), same scale as nav_per_share
        let nav_per_share_now = (current_nav as u128)
            .checked_mul(NAV_SCALE)
            .ok_or(error::err(error::ERROR_NAV_OVERFLOW))?
            / (total_shares as u128);

        let hwm_per_share = high_water_mark as u128; // already stored as per-share (1e9 scaled)

        if nav_per_share_now > hwm_per_share && fee_bps > 0 {
            let profit_per_share = nav_per_share_now - hwm_per_share;
            let total_profit = profit_per_share
                .checked_mul(shares as u128)
                .ok_or(error::err(error::ERROR_NAV_OVERFLOW))?
                / NAV_SCALE;
            let fee_128 = total_profit
                .checked_mul(fee_bps as u128)
                .ok_or(error::err(error::ERROR_NAV_OVERFLOW))?
                / 10_000u128;
            fee_128 as u64
        } else {
            0
        }
    };

    let net_withdrawal = gross_withdrawal.saturating_sub(fee);

    // ----------------------------------------------------------------
    // 7. Burn shares (redeemer signs directly)
    // ----------------------------------------------------------------

    cpi::spl_token::burn(redeemer_shares, mint_acc, redeemer, shares)?;

    // ----------------------------------------------------------------
    // 8. Kamino withdraw for YIELD strategies
    // ----------------------------------------------------------------

    let wallet_bump_slice = [wallet_bump];
    let wallet_seeds: &[&[u8]] = &[
        b"wallet",
        strategy_acc.address().as_ref(),
        &wallet_bump_slice,
    ];

    if strategy_type == STRATEGY_TYPE_YIELD && !remaining.is_empty() {
        cpi::kamino_withdraw::withdraw_signed(remaining, gross_withdrawal, wallet_seeds)?;
    }

    // ----------------------------------------------------------------
    // 9. Transfer net_withdrawal to redeemer
    // ----------------------------------------------------------------

    cpi::spl_token::transfer(
        wallet_token_ata,
        redeemer_token,
        wallet_acc,
        net_withdrawal,
        wallet_seeds,
    )?;

    // ----------------------------------------------------------------
    // 10. Transfer fee to fee_receiver (if any)
    // ----------------------------------------------------------------

    if fee > 0 {
        cpi::spl_token::transfer(
            wallet_token_ata,
            fee_receiver_ata,
            wallet_acc,
            fee,
            wallet_seeds,
        )?;
    }

    // ----------------------------------------------------------------
    // 11. Update strategy state
    // ----------------------------------------------------------------

    {
        let strat_data = unsafe { strategy_acc.borrow_unchecked_mut() };

        let new_nav = current_nav.saturating_sub(gross_withdrawal);
        let new_deposits = total_deposits.saturating_sub(net_withdrawal);
        let new_shares = total_shares.saturating_sub(shares);

        Strategy::set_current_nav(strat_data, new_nav);
        Strategy::set_total_deposits(strat_data, new_deposits);
        Strategy::set_total_shares(strat_data, new_shares);

        // Update high water mark (per-share, 1e9 scaled) if current exceeds it
        if new_shares > 0 {
            let nav_ps = (new_nav as u128 * 1_000_000_000 / new_shares as u128) as u64;
            if nav_ps > high_water_mark {
                Strategy::set_high_water_mark(strat_data, nav_ps);
            }
        }
    }

    Ok(())
}
