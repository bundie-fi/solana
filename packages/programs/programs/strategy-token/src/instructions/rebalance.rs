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
    state::strategy::{Strategy, STATUS_ACTIVE},
    util,
};

// Step action discriminators
const ACTION_DEPOSIT: u8 = 0;
const ACTION_WITHDRAW: u8 = 1;
const ACTION_SWAP: u8 = 2;

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    // ----------------------------------------------------------------
    // 1. Parse instruction data
    // ----------------------------------------------------------------

    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let num_steps = data[0];
    if num_steps == 0 {
        return Err(ProgramError::InvalidInstructionData);
    }

    // ----------------------------------------------------------------
    // 2. Unpack accounts
    // ----------------------------------------------------------------

    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let authority    = &accounts[0];
    let strategy_acc = &accounts[1];
    let remaining    = &accounts[2..];

    util::assert_signer(authority)?;
    util::assert_writable(strategy_acc)?;

    // Strategy must be owned by our program
    util::assert_owned_by(strategy_acc, program_id)?;

    // ----------------------------------------------------------------
    // 3. Read strategy data and validate
    // ----------------------------------------------------------------

    let wallet_bump = {
        let strat_data = strategy_acc.try_borrow()?;

        if !Strategy::check_discriminator(&strat_data) {
            return Err(error::err(error::ERROR_INVALID_DISCRIMINATOR));
        }

        if Strategy::status(&strat_data) != STATUS_ACTIVE {
            return Err(error::err(error::ERROR_STRATEGY_NOT_ACTIVE));
        }

        // Verify authority matches
        let stored_authority = Strategy::authority(&strat_data);
        util::assert_keys_equal(
            authority.address(),
            unsafe { &*(stored_authority as *const [u8; 32] as *const Address) },
        )?;

        Strategy::wallet_bump(&strat_data)
    };

    // ----------------------------------------------------------------
    // 4. Build wallet PDA signer seeds
    // ----------------------------------------------------------------

    let wallet_bump_slice = [wallet_bump];
    let wallet_seeds: &[&[u8]] = &[
        b"wallet",
        strategy_acc.address().as_ref(),
        &wallet_bump_slice,
    ];

    // ----------------------------------------------------------------
    // 5. Parse and execute steps
    // ----------------------------------------------------------------

    let mut cursor = 1usize; // skip num_steps byte

    for _ in 0..num_steps {
        if cursor >= data.len() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let action = data[cursor];
        cursor += 1;

        // Read amount (8 bytes, LE)
        if cursor + 8 > data.len() {
            return Err(ProgramError::InvalidInstructionData);
        }
        let amount = u64::from_le_bytes(data[cursor..cursor + 8].try_into().unwrap());
        cursor += 8;

        match action {
            ACTION_DEPOSIT => {
                // Build signer for wallet PDA
                let signer = build_signer(wallet_seeds);

                let deposit_ctx = beethoven::try_from_deposit_context(remaining)?;
                let (deposit_data, _) = deposit_ctx.try_from_deposit_data(&[])?;
                <beethoven::DepositContext as beethoven::Deposit>::deposit_signed(
                    &deposit_ctx,
                    amount,
                    &deposit_data,
                    &[signer],
                )?;
            }

            ACTION_WITHDRAW => {
                cpi::kamino_withdraw::withdraw_signed(remaining, amount, wallet_seeds)?;
            }

            ACTION_SWAP => {
                // Read min_out (8 bytes, LE)
                if cursor + 8 > data.len() {
                    return Err(ProgramError::InvalidInstructionData);
                }
                let min_out = u64::from_le_bytes(data[cursor..cursor + 8].try_into().unwrap());
                cursor += 8;

                let signer = build_signer(wallet_seeds);

                let (swap_ctx, _rest) = beethoven::try_from_swap_context(remaining)?;
                let (swap_data, _) = swap_ctx.try_from_swap_data(&[])?;
                <beethoven::SwapContext as beethoven::Swap>::swap_signed(
                    &swap_ctx,
                    amount,
                    min_out,
                    &swap_data,
                    &[signer],
                )?;
            }

            _ => {
                return Err(ProgramError::InvalidInstructionData);
            }
        }

        // For this hackathon version: single-step rebalance only.
        // After the first step, stop processing remaining steps.
        break;
    }

    Ok(())
}

/// Build a `Signer` from a slice of seed byte slices using `MaybeUninit`.
/// Supports up to 16 seed components.
#[inline(always)]
fn build_signer<'a>(seeds: &[&'a [u8]]) -> Signer<'a, 'a> {
    let mut buf: [MaybeUninit<Seed<'a>>; 16] = [
        MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(),
        MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(),
        MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(),
        MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(),
    ];
    let len = seeds.len().min(16);
    for i in 0..len {
        buf[i].write(Seed::from(seeds[i]));
    }
    let seed_slice = unsafe { core::slice::from_raw_parts(buf.as_ptr() as *const Seed<'_>, len) };
    Signer::from(seed_slice)
}
