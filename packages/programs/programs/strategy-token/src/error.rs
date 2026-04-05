use pinocchio::error::ProgramError;

pub const ERROR_STRATEGY_NOT_ACTIVE: u32    = 0x1770_0000;
pub const ERROR_DEPOSIT_BELOW_MIN: u32      = 0x1770_0001;
pub const ERROR_INSUFFICIENT_SHARES: u32    = 0x1770_0002;
pub const ERROR_NAV_OVERFLOW: u32           = 0x1770_0003;
pub const ERROR_INVALID_ALLOCATIONS: u32    = 0x1770_0004;
pub const ERROR_SNAPSHOT_TOO_SOON: u32      = 0x1770_0005;
pub const ERROR_ZERO_SHARES: u32            = 0x1770_0006;
pub const ERROR_ZERO_AMOUNT: u32            = 0x1770_0007;
pub const ERROR_INVALID_AUTHORITY: u32      = 0x1770_0008;
pub const ERROR_INVALID_MINT: u32           = 0x1770_0009;
pub const ERROR_INVALID_STRATEGY_TYPE: u32  = 0x1770_000A;
pub const ERROR_INVALID_DISCRIMINATOR: u32  = 0x1770_000B;
pub const ERROR_INVALID_PDA: u32            = 0x1770_000C;
pub const ERROR_INVALID_PROTOCOL: u32       = 0x1770_000D;
pub const ERROR_ACCOUNT_NOT_WRITABLE: u32   = 0x1770_000E;
pub const ERROR_ACCOUNT_NOT_SIGNER: u32     = 0x1770_000F;

#[inline(always)]
pub fn err(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}
