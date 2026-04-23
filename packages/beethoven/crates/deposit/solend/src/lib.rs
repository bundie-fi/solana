#![no_std]

//! Solend (rebranded "Save") `DepositReserveLiquidity` CPI for Beethoven.
//!
//! Solend is NOT an Anchor program — it uses a single `u8` Borsh enum tag
//! (no 8-byte discriminator). `DepositReserveLiquidity` is variant `4`.
//!
//! Source verified against the SPL token-lending fork maintained by Solend:
//! https://github.com/solendprotocol/solana-program-library/blob/master/token-lending/program/src/instruction.rs
//!
//! Instruction layout:
//!   - data: `[tag: u8 = 4][liquidity_amount: u64 LE]`  (9 bytes total)
//!
//! Account list (10 accounts, in order — also verified against
//! `token-lending/program/src/instruction.rs`):
//!   0. source_liquidity              (writable)        — user's USDC token account
//!   1. destination_collateral        (writable)        — user's cToken account
//!   2. reserve                       (writable)
//!   3. reserve_liquidity_supply      (writable)
//!   4. reserve_collateral_mint       (writable)
//!   5. lending_market                (readonly)
//!   6. lending_market_authority      (readonly)        — derived PDA
//!   7. user_transfer_authority       (readonly signer) — the wallet
//!   8. clock_sysvar                  (readonly)        — SysvarC1ock1111…
//!   9. token_program                 (readonly)
//!
//! NOTE: This is the bare-minimum deposit. Solend requires the reserve to
//! have been refreshed in the same slot (`RefreshReserve`, variant 3). That
//! is composed by the caller as a separate Beethoven step or upstream tx —
//! it is intentionally outside this crate's responsibility.

use {
    beethoven_core::Deposit,
    core::mem::MaybeUninit,
    solana_account_view::AccountView,
    solana_address::Address,
    solana_instruction_view::{
        cpi::{invoke_signed, Signer},
        InstructionAccount, InstructionView,
    },
    solana_program_error::{ProgramError, ProgramResult},
};

/// Solend (Save) lending program — devnet.
///
/// `ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx`
pub const SOLEND_PROGRAM_ID: Address =
    Address::from_str_const("ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx");

/// `LendingInstruction::DepositReserveLiquidity` Borsh tag.
/// See SPL token-lending instruction.rs (Solend fork).
pub const DEPOSIT_RESERVE_LIQUIDITY_TAG: u8 = 4;

/// Total ix data length: 1 byte tag + 8 byte u64 amount.
pub const DEPOSIT_DATA_LEN: usize = 9;

/// Number of accounts consumed by `DepositReserveLiquidity`.
pub const NUM_ACCOUNTS: usize = 10;

pub struct Solend;

pub struct SolendDepositAccounts<'info> {
    pub source_liquidity: &'info AccountView,
    pub destination_collateral: &'info AccountView,
    pub reserve: &'info AccountView,
    pub reserve_liquidity_supply: &'info AccountView,
    pub reserve_collateral_mint: &'info AccountView,
    pub lending_market: &'info AccountView,
    pub lending_market_authority: &'info AccountView,
    pub user_transfer_authority: &'info AccountView,
    pub clock_sysvar: &'info AccountView,
    pub token_program: &'info AccountView,
}

impl<'info> TryFrom<&'info [AccountView]> for SolendDepositAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [source_liquidity, destination_collateral, reserve, reserve_liquidity_supply, reserve_collateral_mint, lending_market, lending_market_authority, user_transfer_authority, clock_sysvar, token_program, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(SolendDepositAccounts {
            source_liquidity,
            destination_collateral,
            reserve,
            reserve_liquidity_supply,
            reserve_collateral_mint,
            lending_market,
            lending_market_authority,
            user_transfer_authority,
            clock_sysvar,
            token_program,
        })
    }
}

impl<'info> Deposit<'info> for Solend {
    type Accounts = SolendDepositAccounts<'info>;
    type Data = ();

    fn deposit_signed(
        ctx: &SolendDepositAccounts<'info>,
        amount: u64,
        _data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let accounts = [
            InstructionAccount::writable(ctx.source_liquidity.address()),
            InstructionAccount::writable(ctx.destination_collateral.address()),
            InstructionAccount::writable(ctx.reserve.address()),
            InstructionAccount::writable(ctx.reserve_liquidity_supply.address()),
            InstructionAccount::writable(ctx.reserve_collateral_mint.address()),
            InstructionAccount::readonly(ctx.lending_market.address()),
            InstructionAccount::readonly(ctx.lending_market_authority.address()),
            InstructionAccount::readonly_signer(ctx.user_transfer_authority.address()),
            InstructionAccount::readonly(ctx.clock_sysvar.address()),
            InstructionAccount::readonly(ctx.token_program.address()),
        ];

        let account_infos = [
            ctx.source_liquidity,
            ctx.destination_collateral,
            ctx.reserve,
            ctx.reserve_liquidity_supply,
            ctx.reserve_collateral_mint,
            ctx.lending_market,
            ctx.lending_market_authority,
            ctx.user_transfer_authority,
            ctx.clock_sysvar,
            ctx.token_program,
        ];

        // Encode: [tag: u8 = 4][liquidity_amount: u64 LE]
        let mut instruction_data = MaybeUninit::<[u8; DEPOSIT_DATA_LEN]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;
            *ptr = DEPOSIT_RESERVE_LIQUIDITY_TAG;
            core::ptr::copy_nonoverlapping(amount.to_le_bytes().as_ptr(), ptr.add(1), 8);
        }

        let deposit_ix = InstructionView {
            program_id: &SOLEND_PROGRAM_ID,
            accounts: &accounts,
            data: unsafe { instruction_data.assume_init_ref() },
        };

        invoke_signed(&deposit_ix, &account_infos, signer_seeds)?;

        Ok(())
    }

    fn deposit(
        ctx: &SolendDepositAccounts<'info>,
        amount: u64,
        data: &Self::Data,
    ) -> ProgramResult {
        Self::deposit_signed(ctx, amount, data, &[])
    }
}
