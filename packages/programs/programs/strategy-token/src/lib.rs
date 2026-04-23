// beethoven's transitive deps (solana-account-view -> solana-address -> curve25519-dalek)
// pull in std, making #![no_std] + nostd_panic_handler incompatible. We keep pinocchio's
// zero-copy account patterns but let std be linked normally.

pub mod cpi;
pub mod error;
mod instructions;
pub mod nav_readers;
pub mod state;
mod util;

use pinocchio::{account::AccountView, address::Address, error::ProgramError, ProgramResult};

pinocchio::program_entrypoint!(process_instruction);

/// Strategy Token Program ID — `Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm`
pub const ID: Address = Address::new_from_array([
    162, 26, 7, 87, 249, 8, 100, 213, 180, 17, 125, 234, 45, 168, 44, 50, 84, 184, 53, 8, 233,
    206, 146, 225, 18, 196, 241, 232, 131, 217, 106, 60,
]);

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    let (disc, rest) = data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    match disc {
        0 => instructions::create_strategy::process(program_id, accounts, rest),
        1 => instructions::buy_shares::process(program_id, accounts, rest),
        2 => instructions::redeem_shares::process(program_id, accounts, rest),
        3 => instructions::update_nav::process(program_id, accounts, rest),
        4 => instructions::rebalance::process(program_id, accounts, rest),
        5 => instructions::snapshot_positions::process(program_id, accounts, rest),
        6 => instructions::init_position::process(program_id, accounts, rest),
        7 => instructions::perp_place_order::process(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
