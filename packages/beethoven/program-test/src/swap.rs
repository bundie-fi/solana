use {
    beethoven::{try_from_swap_context, Swap, SwapContext, SwapData},
    pinocchio::{error::ProgramError, AccountView, ProgramResult},
};

/// Instruction data for Swap
///
/// Layout:
/// [0..8]  - in_amount (u64, little-endian)
/// [8..16] - minimum_out_amount (u64, little-endian)
/// [16..]  - protocol-specific data (parsed via SwapContext::try_from_swap_data)
pub struct SwapInstructionData<'a> {
    pub in_amount: u64,
    pub minimum_out_amount: u64,
    pub extra_data: &'a [u8],
}

impl<'a> TryFrom<&'a [u8]> for SwapInstructionData<'a> {
    type Error = ProgramError;

    fn try_from(data: &'a [u8]) -> Result<Self, Self::Error> {
        if data.len() < 16 {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(Self {
            in_amount: u64::from_le_bytes(data[0..8].try_into().unwrap()),
            minimum_out_amount: u64::from_le_bytes(data[8..16].try_into().unwrap()),
            extra_data: &data[16..],
        })
    }
}

pub struct SwapInstruction<'a> {
    pub accounts: SwapContext<'a>,
    pub data: SwapData<'a>,
    pub in_amount: u64,
    pub minimum_out_amount: u64,
}

impl<'a> TryFrom<(&'a [AccountView], &'a [u8])> for SwapInstruction<'a> {
    type Error = ProgramError;

    fn try_from((accounts, data): (&'a [AccountView], &'a [u8])) -> Result<Self, Self::Error> {
        let instruction_data = SwapInstructionData::try_from(data)?;
        let (ctx, _remaining_accounts) = try_from_swap_context(accounts)?;
        let (swap_data, _remaining_data) = ctx.try_from_swap_data(instruction_data.extra_data)?;

        Ok(Self {
            accounts: ctx,
            data: swap_data,
            in_amount: instruction_data.in_amount,
            minimum_out_amount: instruction_data.minimum_out_amount,
        })
    }
}

impl<'a> SwapInstruction<'a> {
    pub fn process(&self) -> ProgramResult {
        SwapContext::swap(
            &self.accounts,
            self.in_amount,
            self.minimum_out_amount,
            &self.data,
        )
    }
}

pub fn process(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    SwapInstruction::try_from((accounts, data))?.process()
}
