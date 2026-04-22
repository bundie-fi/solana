#![no_std]

use {solana_instruction_view::cpi::Signer, solana_program_error::ProgramResult};

/// Core trait for swap operations across different DEX protocols.
///
/// Each protocol implements this trait with its specific account requirements,
/// instruction data format, and CPI logic.
pub trait Swap<'info> {
    /// Protocol-specific accounts required for the swap CPI
    type Accounts;

    /// Protocol-specific instruction data beyond in_amount and minimum_out_amount
    type Data;

    /// Execute a swap with PDA signing capability
    fn swap_signed(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult;

    /// Execute a swap without signing (user is direct signer)
    fn swap(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        data: &Self::Data,
    ) -> ProgramResult;
}

/// Core trait for deposit operations across different protocols.
///
/// Each protocol implements this trait with its specific account requirements and CPI logic.
pub trait Deposit<'info> {
    /// Protocol-specific accounts required for the deposit CPI
    type Accounts;

    /// Protocol-specific instruction data beyond amount
    type Data;

    /// Execute a deposit with PDA signing capability
    fn deposit_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult;

    /// Execute a deposit without signing (user is direct signer)
    fn deposit(ctx: &Self::Accounts, amount: u64, data: &Self::Data) -> ProgramResult;
}

/// Core trait for one-time position initialization across protocols.
///
/// Some protocols (Kamino, Marginfi, Drift) require per-user state accounts
/// — obligations, user metadata, margin accounts — to exist before any
/// deposit or borrow can be made. When the position owner is a PDA of a
/// wrapping program (a vault, strategy, etc.) the wrapping program signs
/// these setup CPIs via `init_signed`.
///
/// Implementations are expected to be idempotent in spirit: either the
/// caller tracks whether init has run, or the impl checks on-chain state
/// and skips already-initialised sub-operations.
pub trait DepositInit<'info> {
    /// Protocol-specific accounts required for the init CPI
    type Accounts;

    /// Run the setup CPI with PDA signing capability
    fn init_signed(
        ctx: &Self::Accounts,
        signer_seeds: &[Signer],
    ) -> ProgramResult;

    /// Run the setup CPI without signing (user is direct signer)
    fn init(ctx: &Self::Accounts) -> ProgramResult;
}

/// Core trait for perpetual-futures operations across protocols.
///
/// Perps instructions carry richer intent than deposit/swap: side (bid/ask),
/// size (base or quote lots), order type (market/limit/IOC), client id, etc.
/// That shape lives in the protocol-specific `Data`. Opening and closing a
/// position are both `place_order` calls from the protocol's perspective
/// (closing = opposite-side order), so this trait exposes a single op.
///
/// Some protocols (Drift) do expose dedicated close-position ixs. When a
/// protocol benefits from a distinct close path, it may provide
/// `close_signed`/`close` — the default delegates to `place_order_signed`.
pub trait Perps<'info> {
    /// Protocol-specific accounts required for the order CPI
    type Accounts;

    /// Protocol-specific order data (side, size, price, type, flags, …)
    type Data;

    /// Place an order with PDA signing capability (open or close)
    fn place_order_signed(
        ctx: &Self::Accounts,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult;

    /// Place an order without signing (user is direct signer)
    fn place_order(ctx: &Self::Accounts, data: &Self::Data) -> ProgramResult;
}
