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
        nav_oracle::{
            NavOracle, DEFAULT_MIN_SNAPSHOT_INTERVAL, DEFAULT_TWAP_WINDOW, NAV_ORACLE_LEN,
        },
        strategy::{Strategy, STATUS_ACTIVE, STRATEGY_LEN},
    },
    util,
};

/// SPL Token Mint account size (82 bytes).
const MINT_SIZE: usize = 82;

/// Mint decimals for strategy share tokens.
const SHARE_DECIMALS: u8 = 9;

pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // ----------------------------------------------------------------
    // 1. Parse & validate instruction data
    // ----------------------------------------------------------------

    if data.len() < 43 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let strategy_type = data[0];
    if strategy_type > 1 {
        return Err(error::err(error::ERROR_INVALID_STRATEGY_TYPE));
    }

    let fee_bps = u16::from_le_bytes(data[1..3].try_into().unwrap());
    if fee_bps > 10_000 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let min_deposit = u64::from_le_bytes(data[3..11].try_into().unwrap());

    let mut name = [0u8; 32];
    name.copy_from_slice(&data[11..43]);

    // ----------------------------------------------------------------
    // 2. Unpack accounts
    // ----------------------------------------------------------------

    let creator = &accounts[0];
    let strategy_acc = &accounts[1];
    let mint_acc = &accounts[2];
    let wallet_acc = &accounts[3];
    let nav_oracle = &accounts[4];
    let deposit_mint = &accounts[5];
    let protocol = &accounts[6];
    let reserve = &accounts[7];
    // accounts[8]  = token_program
    // accounts[9]  = system_program
    // accounts[10] = rent_sysvar

    util::assert_signer(creator)?;
    util::assert_writable(creator)?;

    // Validate deposit_mint is owned by SPL Token program
    util::assert_owned_by(deposit_mint, &cpi::spl_token::TOKEN_PROGRAM_ID)?;

    // ----------------------------------------------------------------
    // 3. Derive Strategy PDA
    // ----------------------------------------------------------------

    let (strategy_address, strategy_bump) = Address::find_program_address(
        &[b"strategy", creator.address().as_ref(), &name],
        program_id,
    );
    util::assert_keys_equal(strategy_acc.address(), &strategy_address)?;

    // ----------------------------------------------------------------
    // 4. Derive Wallet PDA (not created, just store bump)
    // ----------------------------------------------------------------

    let (wallet_address, wallet_bump) =
        Address::find_program_address(&[b"wallet", strategy_address.as_ref()], program_id);
    util::assert_keys_equal(wallet_acc.address(), &wallet_address)?;

    // ----------------------------------------------------------------
    // 5. Derive NavOracle PDA
    // ----------------------------------------------------------------

    let (nav_address, nav_bump) =
        Address::find_program_address(&[b"nav", strategy_address.as_ref()], program_id);
    util::assert_keys_equal(nav_oracle.address(), &nav_address)?;

    // ----------------------------------------------------------------
    // 6. Compute rent-exempt balances
    // ----------------------------------------------------------------

    let rent = Rent::get()?;
    let strategy_lamports = rent.minimum_balance_unchecked(STRATEGY_LEN);
    let mint_lamports = rent.minimum_balance_unchecked(MINT_SIZE);
    let oracle_lamports = rent.minimum_balance_unchecked(NAV_ORACLE_LEN);

    // ----------------------------------------------------------------
    // 7. Create Strategy account (PDA)
    // ----------------------------------------------------------------

    let strategy_bump_slice = [strategy_bump];
    cpi::system::create_account(
        creator,
        strategy_acc,
        strategy_lamports,
        STRATEGY_LEN as u64,
        program_id,
        &[
            b"strategy",
            creator.address().as_ref(),
            &name,
            &strategy_bump_slice,
        ],
    )?;

    // ----------------------------------------------------------------
    // 8. Create Mint account (keypair signer, not a PDA)
    // ----------------------------------------------------------------

    cpi::system::create_account(
        creator,
        mint_acc,
        mint_lamports,
        MINT_SIZE as u64,
        &cpi::spl_token::TOKEN_PROGRAM_ID,
        &[], // mint is a normal keypair
    )?;

    // ----------------------------------------------------------------
    // 9. Initialize mint — strategy PDA is the mint authority
    // ----------------------------------------------------------------

    cpi::spl_token::init_mint2(
        mint_acc,
        SHARE_DECIMALS,
        &strategy_address, // mint authority
        None,              // no freeze authority
        &[],               // no PDA signing needed for InitMint2
    )?;

    // ----------------------------------------------------------------
    // 10. Create NavOracle account (PDA)
    // ----------------------------------------------------------------

    let nav_bump_slice = [nav_bump];
    cpi::system::create_account(
        creator,
        nav_oracle,
        oracle_lamports,
        NAV_ORACLE_LEN as u64,
        program_id,
        &[b"nav", strategy_address.as_ref(), &nav_bump_slice],
    )?;

    // ----------------------------------------------------------------
    // 11. Get clock for timestamps
    // ----------------------------------------------------------------

    let clock = Clock::get()?;

    // ----------------------------------------------------------------
    // 12. Write Strategy fields
    // ----------------------------------------------------------------

    {
        let strat_data = unsafe { strategy_acc.borrow_unchecked_mut() };
        Strategy::set_discriminator(strat_data);
        Strategy::set_authority(strat_data, creator.address().as_ref().try_into().unwrap());
        Strategy::set_mint(strat_data, mint_acc.address().as_ref().try_into().unwrap());
        Strategy::set_wallet(
            strat_data,
            wallet_acc.address().as_ref().try_into().unwrap(),
        );
        Strategy::set_deposit_mint(
            strat_data,
            deposit_mint.address().as_ref().try_into().unwrap(),
        );
        Strategy::set_protocol(strat_data, protocol.address().as_ref().try_into().unwrap());
        Strategy::set_reserve(strat_data, reserve.address().as_ref().try_into().unwrap());
        Strategy::set_name(strat_data, &name);
        Strategy::set_strategy_type(strat_data, strategy_type);
        Strategy::set_status(strat_data, STATUS_ACTIVE);
        Strategy::set_fee_bps(strat_data, fee_bps);
        Strategy::set_total_deposits(strat_data, 0);
        Strategy::set_current_nav(strat_data, 0);
        Strategy::set_total_shares(strat_data, 0);
        Strategy::set_total_investors(strat_data, 0);
        Strategy::set_high_water_mark(strat_data, 0);
        Strategy::set_min_deposit(strat_data, min_deposit);
        Strategy::set_last_nav_slot(strat_data, clock.slot);
        Strategy::set_nav_twap_accumulator(strat_data, 0);
        Strategy::set_twap_last_slot(strat_data, clock.slot);
        Strategy::set_created_at(strat_data, clock.unix_timestamp);
        Strategy::set_bump(strat_data, strategy_bump);
        Strategy::set_wallet_bump(strat_data, wallet_bump);
    }

    // ----------------------------------------------------------------
    // 13. Write NavOracle fields
    // ----------------------------------------------------------------

    {
        let oracle_data = unsafe { nav_oracle.borrow_unchecked_mut() };
        NavOracle::set_discriminator(oracle_data);
        NavOracle::set_strategy(
            oracle_data,
            strategy_acc.address().as_ref().try_into().unwrap(),
        );
        NavOracle::set_nav_per_share(oracle_data, 0);
        NavOracle::set_twap_value(oracle_data, 0);
        NavOracle::set_snapshot_count(oracle_data, 0);
        NavOracle::set_last_snapshot_slot(oracle_data, clock.slot);
        NavOracle::set_min_snapshot_interval(oracle_data, DEFAULT_MIN_SNAPSHOT_INTERVAL);
        NavOracle::set_twap_window(oracle_data, DEFAULT_TWAP_WINDOW);
        NavOracle::set_bump(oracle_data, nav_bump);
    }

    Ok(())
}
