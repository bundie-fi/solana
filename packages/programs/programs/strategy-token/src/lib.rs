// beethoven's transitive deps (solana-account-view -> solana-address -> curve25519-dalek)
// pull in std, making #![no_std] + nostd_panic_handler incompatible. We keep pinocchio's
// zero-copy account patterns but let std be linked normally.

pub mod error;
mod instructions;
pub mod state;
pub mod cpi;
mod util;

use pinocchio::{
    error::ProgramError,
    address::Address,
    account::AccountView,
    ProgramResult,
};

pinocchio::program_entrypoint!(process_instruction);

/// Strategy Token Program ID
pub const ID: Address = Address::new_from_array([
    7, 241, 15, 8, 33, 84, 211, 43,
    197, 41, 205, 236, 235, 230, 21, 118,
    161, 71, 101, 255, 213, 205, 62, 233,
    196, 171, 67, 154, 183, 193, 236, 12,
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
