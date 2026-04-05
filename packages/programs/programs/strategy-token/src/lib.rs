#![no_std]

mod error;
mod instructions;
mod state;
mod cpi;
mod util;

use pinocchio::{
    error::ProgramError,
    address::Address,
    account::AccountView,
    ProgramResult,
};

pinocchio::no_allocator!();
pinocchio::nostd_panic_handler!();
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
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
