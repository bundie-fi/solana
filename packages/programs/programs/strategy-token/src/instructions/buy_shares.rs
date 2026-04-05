use core::mem::MaybeUninit;

use pinocchio::{
    account::AccountView,
    address::Address,
    cpi::{Seed, Signer},
    error::ProgramError,
    ProgramResult,
};

use crate::{
    cpi,
    error,
    state::strategy::{Strategy, STATUS_ACTIVE, STRATEGY_TYPE_YIELD},
    util,
};

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    // ----------------------------------------------------------------
    // 1. Parse instruction data: amount (u64 LE, 8 bytes)
    // ----------------------------------------------------------------

    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    if amount == 0 {
        return Err(error::err(error::ERROR_ZERO_AMOUNT));
    }

    // ----------------------------------------------------------------
    // 2. Unpack accounts
    // ----------------------------------------------------------------

    if accounts.len() < 10 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let buyer            = &accounts[0];
    let strategy_acc     = &accounts[1];
    let mint_acc         = &accounts[2];
    let buyer_shares_ata = &accounts[3];
    let wallet_acc       = &accounts[4];
    let wallet_token_ata = &accounts[5];
    let buyer_token_ata  = &accounts[6];
    let token_program    = &accounts[7];
    let system_program   = &accounts[8];
    let _ata_program     = &accounts[9];
    let remaining        = &accounts[10..];

    util::assert_signer(buyer)?;
    util::assert_writable(buyer)?;
    util::assert_writable(strategy_acc)?;
    util::assert_writable(mint_acc)?;
    util::assert_writable(buyer_shares_ata)?;
    util::assert_writable(wallet_token_ata)?;
    util::assert_writable(buyer_token_ata)?;

    // Strategy must be owned by our program
    util::assert_owned_by(strategy_acc, program_id)?;

    // ----------------------------------------------------------------
    // 3. Read strategy data and validate
    // ----------------------------------------------------------------

    let (
        strategy_type,
        total_shares,
        current_nav,
        total_deposits,
        high_water_mark,
        bump,
        wallet_bump,
        authority_bytes,
        name_bytes,
    ) = {
        let strat_data = strategy_acc.try_borrow()?;

        if !Strategy::check_discriminator(&strat_data) {
            return Err(error::err(error::ERROR_INVALID_DISCRIMINATOR));
        }

        if Strategy::status(&strat_data) != STATUS_ACTIVE {
            return Err(error::err(error::ERROR_STRATEGY_NOT_ACTIVE));
        }

        let min_deposit = Strategy::min_deposit(&strat_data);
        if amount < min_deposit {
            return Err(error::err(error::ERROR_DEPOSIT_BELOW_MIN));
        }

        // Verify mint matches the strategy's mint
        let strategy_mint = Strategy::mint(&strat_data);
        util::assert_keys_equal(
            mint_acc.address(),
            unsafe { &*(strategy_mint as *const [u8; 32] as *const Address) },
        )?;

        // Verify wallet matches the strategy's wallet
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
            Strategy::bump(&strat_data),
            Strategy::wallet_bump(&strat_data),
            auth,
            name,
        )
    };

    // ----------------------------------------------------------------
    // 4. Create buyer's share ATA if needed (idempotent)
    // ----------------------------------------------------------------

    cpi::associated_token::create_idempotent(
        buyer,
        buyer_shares_ata,
        buyer,
        mint_acc,
        system_program,
        token_program,
    )?;

    // ----------------------------------------------------------------
    // 5. Transfer deposit tokens from buyer to wallet's ATA
    // ----------------------------------------------------------------

    // buyer signs directly (not a PDA), so empty signer_seeds
    cpi::spl_token::transfer(
        buyer_token_ata,
        wallet_token_ata,
        buyer,
        amount,
        &[],
    )?;

    // ----------------------------------------------------------------
    // 6. Beethoven deposit for YIELD strategies
    // ----------------------------------------------------------------

    if strategy_type == STRATEGY_TYPE_YIELD && !remaining.is_empty() {
        // Build wallet PDA signer for Beethoven CPI
        let wallet_bump_slice = [wallet_bump];
        let wallet_seeds: &[&[u8]] = &[
            b"wallet",
            strategy_acc.address().as_ref(),
            &wallet_bump_slice,
        ];

        // Build the Signer from wallet seeds
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

        let deposit_ctx = beethoven::try_from_deposit_context(remaining)?;
        let (deposit_data, _) = deposit_ctx.try_from_deposit_data(&[])?;
        <beethoven::DepositContext as beethoven::Deposit>::deposit_signed(&deposit_ctx, amount, &deposit_data, &[signer])?;
    }

    // ----------------------------------------------------------------
    // 7. Calculate shares to mint
    // ----------------------------------------------------------------

    let shares_to_mint: u64 = if total_shares == 0 || current_nav == 0 {
        // First deposit: 1:1
        amount
    } else {
        // Proportional: shares = amount * total_shares / current_nav
        let numerator = (amount as u128).checked_mul(total_shares as u128)
            .ok_or(error::err(error::ERROR_NAV_OVERFLOW))?;
        let shares_128 = numerator.checked_div(current_nav as u128)
            .ok_or(error::err(error::ERROR_NAV_OVERFLOW))?;
        if shares_128 > u64::MAX as u128 {
            return Err(error::err(error::ERROR_NAV_OVERFLOW));
        }
        shares_128 as u64
    };

    if shares_to_mint == 0 {
        return Err(error::err(error::ERROR_ZERO_SHARES));
    }

    // ----------------------------------------------------------------
    // 8. Mint shares to buyer's ATA (strategy PDA is mint authority)
    // ----------------------------------------------------------------

    let strategy_bump_slice = [bump];
    cpi::spl_token::mint_to(
        mint_acc,
        buyer_shares_ata,
        strategy_acc,
        shares_to_mint,
        &[b"strategy", &authority_bytes, &name_bytes, &strategy_bump_slice],
    )?;

    // ----------------------------------------------------------------
    // 9. Update strategy state
    // ----------------------------------------------------------------

    {
        let strat_data = unsafe { strategy_acc.borrow_unchecked_mut() };

        let new_total_deposits = total_deposits
            .checked_add(amount)
            .ok_or(error::err(error::ERROR_NAV_OVERFLOW))?;
        let new_nav = current_nav
            .checked_add(amount)
            .ok_or(error::err(error::ERROR_NAV_OVERFLOW))?;
        let new_total_shares = total_shares
            .checked_add(shares_to_mint)
            .ok_or(error::err(error::ERROR_NAV_OVERFLOW))?;

        Strategy::set_total_deposits(strat_data, new_total_deposits);
        Strategy::set_current_nav(strat_data, new_nav);
        Strategy::set_total_shares(strat_data, new_total_shares);

        if high_water_mark == 0 {
            Strategy::set_high_water_mark(strat_data, new_nav);
        }
    }

    Ok(())
}
