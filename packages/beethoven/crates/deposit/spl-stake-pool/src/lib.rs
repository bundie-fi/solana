#![no_std]

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

/// SPL Stake Pool program ID (same on mainnet + devnet).
pub const SPL_STAKE_POOL_PROGRAM_ID: Address =
    Address::from_str_const("SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy");

/// Borsh ordinal of the `DepositSol` variant in `StakePoolInstruction`
/// (the 15th variant: Initialize=0, AddValidatorToPool=1, …, SetStaker=13,
/// DepositSol=14). Borsh serialises the enum tag as a single u8.
pub const DEPOSIT_SOL_DISCRIMINATOR: u8 = 14;

/// Wire size of `DepositSol(u64)`: 1-byte variant tag + 8-byte LE lamports.
pub const DEPOSIT_DATA_LEN: usize = 9;

/// Account count when the pool has NO `sol_deposit_authority` (most common).
pub const NUM_ACCOUNTS: usize = 10;

/// Account count when the pool DOES have a `sol_deposit_authority` (extra
/// readonly signer appended in slot 10).
pub const NUM_ACCOUNTS_WITH_AUTHORITY: usize = 11;

pub struct SplStakePool;

/// Caller-supplied per-deposit data.
///
/// `has_sol_deposit_authority` selects between the 10-account and 11-account
/// layouts described above. When `true`, the `sol_deposit_authority` field on
/// the accounts struct must be `Some` and that account must sign the tx.
pub struct SplStakePoolDepositSolData {
    pub has_sol_deposit_authority: bool,
}

impl SplStakePoolDepositSolData {
    /// Caller passes a single byte: 0 = no authority, non-zero = authority.
    pub const DATA_LEN: usize = 1;
}

impl TryFrom<&[u8]> for SplStakePoolDepositSolData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.len() < Self::DATA_LEN {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(Self {
            has_sol_deposit_authority: data[0] != 0,
        })
    }
}

/// Account inputs for `DepositSol`. The trailing `sol_deposit_authority` is
/// only forwarded to the CPI when `data.has_sol_deposit_authority == true`.
pub struct SplStakePoolDepositSolAccounts<'info> {
    pub stake_pool_program: &'info AccountView,
    pub stake_pool: &'info AccountView,
    pub withdraw_authority: &'info AccountView,
    pub reserve_stake: &'info AccountView,
    pub lamports_from: &'info AccountView,
    pub pool_tokens_to: &'info AccountView,
    pub manager_fee_account: &'info AccountView,
    pub referrer_pool_tokens_account: &'info AccountView,
    pub pool_mint: &'info AccountView,
    pub system_program: &'info AccountView,
    pub token_program: &'info AccountView,
    /// Optional: only present when the stake pool has a SOL deposit authority
    /// configured. When supplied this account must be a signer.
    pub sol_deposit_authority: Option<&'info AccountView>,
}

impl<'info> TryFrom<&'info [AccountView]> for SplStakePoolDepositSolAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        // Parse 11 required slots; the 11th is `sol_deposit_authority`. If
        // the pool doesn't use one, the caller MUST still supply a sentinel
        // account here (e.g. the program ID itself) — `Data` controls whether
        // it gets forwarded into the CPI. This mirrors the marginfi/kamino
        // pattern of using a fixed slot count parsed up-front.
        let [stake_pool_program, stake_pool, withdraw_authority, reserve_stake, lamports_from, pool_tokens_to, manager_fee_account, referrer_pool_tokens_account, pool_mint, system_program, token_program, sol_deposit_authority, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(SplStakePoolDepositSolAccounts {
            stake_pool_program,
            stake_pool,
            withdraw_authority,
            reserve_stake,
            lamports_from,
            pool_tokens_to,
            manager_fee_account,
            referrer_pool_tokens_account,
            pool_mint,
            system_program,
            token_program,
            sol_deposit_authority: Some(sol_deposit_authority),
        })
    }
}

impl<'info> Deposit<'info> for SplStakePool {
    type Accounts = SplStakePoolDepositSolAccounts<'info>;
    type Data = SplStakePoolDepositSolData;

    fn deposit_signed(
        ctx: &SplStakePoolDepositSolAccounts<'info>,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        // ─── Build account metas ────────────────────────────────────────
        // Order from canonical SPL stake-pool instruction.rs DepositSol docs:
        //   0. [w]  stake_pool
        //   1. [ ]  stake_pool_withdraw_authority
        //   2. [w]  reserve_stake
        //   3. [s]  lamports_from              (writable signer — wallet)
        //   4. [w]  pool_tokens_to
        //   5. [w]  manager_fee_account
        //   6. [w]  referrer_pool_tokens_account
        //   7. [w]  pool_mint
        //   8. [ ]  system_program
        //   9. [ ]  token_program
        //  10. [s]  sol_deposit_authority      (optional readonly signer)
        //
        // We size both arrays for the maximal 11-account case; when there's
        // no `sol_deposit_authority` we slice down to 10 before invoking.
        // The slot-10 placeholder writes (overwritten below if used) keep
        // both arrays fully-initialised either way.
        let auth = ctx.sol_deposit_authority.unwrap_or(ctx.stake_pool_program);

        let mut metas = [
            InstructionAccount::writable(ctx.stake_pool.address()),
            InstructionAccount::readonly(ctx.withdraw_authority.address()),
            InstructionAccount::writable(ctx.reserve_stake.address()),
            InstructionAccount::writable_signer(ctx.lamports_from.address()),
            InstructionAccount::writable(ctx.pool_tokens_to.address()),
            InstructionAccount::writable(ctx.manager_fee_account.address()),
            InstructionAccount::writable(ctx.referrer_pool_tokens_account.address()),
            InstructionAccount::writable(ctx.pool_mint.address()),
            InstructionAccount::readonly(ctx.system_program.address()),
            InstructionAccount::readonly(ctx.token_program.address()),
            InstructionAccount::readonly(ctx.stake_pool_program.address()),
        ];
        let mut infos: [&AccountView; NUM_ACCOUNTS_WITH_AUTHORITY] = [
            ctx.stake_pool,
            ctx.withdraw_authority,
            ctx.reserve_stake,
            ctx.lamports_from,
            ctx.pool_tokens_to,
            ctx.manager_fee_account,
            ctx.referrer_pool_tokens_account,
            ctx.pool_mint,
            ctx.system_program,
            ctx.token_program,
            ctx.stake_pool_program,
        ];

        let total_accounts = if data.has_sol_deposit_authority {
            // Caller must supply the authority account when the pool requires
            // one — otherwise the CPI would silently lose its signer.
            if ctx.sol_deposit_authority.is_none() {
                return Err(ProgramError::NotEnoughAccountKeys);
            }
            metas[10] = InstructionAccount::readonly_signer(auth.address());
            infos[10] = auth;
            NUM_ACCOUNTS_WITH_AUTHORITY
        } else {
            NUM_ACCOUNTS
        };

        // Metas slice tracks the actual account count (10 or 11).
        // Infos is passed as the full fixed-size array — the CPI runtime
        // looks at the first `metas.len()` entries (same trick kamino's
        // refresh_obligation uses with MAX_REFRESH_OBLIGATION_ACCOUNTS).
        let metas_slice = &metas[..total_accounts];

        // ─── Build instruction data: [tag(1) | lamports_le(8)] ─────────
        let mut instruction_data = MaybeUninit::<[u8; DEPOSIT_DATA_LEN]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;
            *ptr = DEPOSIT_SOL_DISCRIMINATOR;
            core::ptr::copy_nonoverlapping(amount.to_le_bytes().as_ptr(), ptr.add(1), 8);
        }

        let deposit_ix = InstructionView {
            program_id: &SPL_STAKE_POOL_PROGRAM_ID,
            accounts: metas_slice,
            data: unsafe {
                core::slice::from_raw_parts(
                    instruction_data.as_ptr() as *const u8,
                    DEPOSIT_DATA_LEN,
                )
            },
        };

        invoke_signed(&deposit_ix, &infos, signer_seeds)?;

        Ok(())
    }

    fn deposit(
        ctx: &SplStakePoolDepositSolAccounts<'info>,
        amount: u64,
        data: &Self::Data,
    ) -> ProgramResult {
        Self::deposit_signed(ctx, amount, data, &[])
    }
}
