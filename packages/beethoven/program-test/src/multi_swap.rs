use {
    beethoven::{try_from_swap_context, Swap, SwapContext},
    pinocchio::{error::ProgramError, AccountView, ProgramResult},
};

/// Multi-swap instruction data layout (after discriminator):
///
/// [num_swaps: u8]
/// Per swap (repeated num_swaps times):
///   [in_amount: u64 LE]
///   [min_out_amount: u64 LE]
///   [extra_data: protocol determines length]
///
/// Accounts are flat concatenation. Each swap consumes its protocol's
/// known account count from the remaining slice.
pub fn process(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let num_swaps = data[0] as usize;
    let mut remaining_data = &data[1..];
    let mut remaining_accounts = accounts;

    for _ in 0..num_swaps {
        if remaining_data.len() < 16 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let in_amount = u64::from_le_bytes(
            remaining_data[..8]
                .try_into()
                .map_err(|_| ProgramError::InvalidInstructionData)?,
        );
        let min_out_amount = u64::from_le_bytes(
            remaining_data[8..16]
                .try_into()
                .map_err(|_| ProgramError::InvalidInstructionData)?,
        );
        remaining_data = &remaining_data[16..];

        let (ctx, next_accounts) = try_from_swap_context(remaining_accounts)?;
        let (swap_data, next_data) = ctx.try_from_swap_data(remaining_data)?;
        SwapContext::swap(&ctx, in_amount, min_out_amount, &swap_data)?;

        remaining_accounts = next_accounts;
        remaining_data = next_data;
    }

    Ok(())
}
