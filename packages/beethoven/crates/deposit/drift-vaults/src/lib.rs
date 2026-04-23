#![no_std]

use {
    beethoven_core::Deposit,
    core::mem::MaybeUninit,
    solana_account_view::AccountView,
    solana_address::Address,
    solana_instruction_view::{
        cpi::{invoke_signed_with_bounds, Signer},
        InstructionAccount, InstructionView,
    },
    solana_program_error::{ProgramError, ProgramResult},
};

/// Drift Vaults program (devnet + mainnet share the same address).
/// Source: https://github.com/drift-labs/drift-vaults
pub const DRIFT_VAULTS_PROGRAM_ID: Address =
    Address::from_str_const("vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR");

/// Anchor discriminator for `global:deposit` on the Drift Vaults program.
/// sha256("global:deposit")[..8].
const DEPOSIT_DISCRIMINATOR: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];

/// Instruction data: discriminator (8) + amount: u64 (8).
const DEPOSIT_DATA_LEN: usize = 16;

/// Fixed accounts in the Drift Vaults `deposit` ix is 11. The Anchor program
/// also accepts a variable tail of remaining_accounts (vault_protocol PDA,
/// fuel_overflow PDA, fee_update PDA, plus the spot/perp/oracle account maps).
/// Cap the total at 32 to leave headroom without blowing the stack.
const MAX_DEPOSIT_ACCOUNTS: usize = 32;

/// Number of fixed accounts above the remaining_accounts tail.
const FIXED_ACCOUNTS: usize = 11;

pub struct DriftVaults;

pub struct DriftVaultsDepositAccounts<'info> {
    pub drift_vaults_program: &'info AccountView,
    pub vault: &'info AccountView,
    pub vault_depositor: &'info AccountView,
    pub authority: &'info AccountView,
    pub vault_token_account: &'info AccountView,
    pub drift_user_stats: &'info AccountView,
    pub drift_user: &'info AccountView,
    pub drift_state: &'info AccountView,
    pub drift_spot_market_vault: &'info AccountView,
    pub user_token_account: &'info AccountView,
    pub drift_program: &'info AccountView,
    pub token_program: &'info AccountView,
    /// Tail accounts forwarded to the CPI (oracles, spot markets, perp markets,
    /// vault_protocol, fuel_overflow, fee_update). Their writable/signer flags
    /// are inherited from the calling instruction via `InstructionAccount::from`.
    pub remaining_accounts: &'info [AccountView],
}

impl<'info> TryFrom<&'info [AccountView]> for DriftVaultsDepositAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [drift_vaults_program, vault, vault_depositor, authority, vault_token_account, drift_user_stats, drift_user, drift_state, drift_spot_market_vault, user_token_account, drift_program, token_program, remaining_accounts @ ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(Self {
            drift_vaults_program,
            vault,
            vault_depositor,
            authority,
            vault_token_account,
            drift_user_stats,
            drift_user,
            drift_state,
            drift_spot_market_vault,
            user_token_account,
            drift_program,
            token_program,
            remaining_accounts,
        })
    }
}

impl<'info> Deposit<'info> for DriftVaults {
    type Accounts = DriftVaultsDepositAccounts<'info>;
    type Data = ();

    fn deposit_signed(
        ctx: &DriftVaultsDepositAccounts<'info>,
        amount: u64,
        _data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let total_accounts = FIXED_ACCOUNTS + ctx.remaining_accounts.len();
        if total_accounts > MAX_DEPOSIT_ACCOUNTS {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let mut account_metas = MaybeUninit::<[InstructionAccount; MAX_DEPOSIT_ACCOUNTS]>::uninit();
        let account_metas_ptr = account_metas.as_mut_ptr() as *mut InstructionAccount;

        // Order matches `pub struct Deposit<'info>` in
        // drift-vaults/programs/drift_vaults/src/instructions/deposit.rs
        unsafe {
            core::ptr::write(
                account_metas_ptr,
                InstructionAccount::writable(ctx.vault.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(1),
                InstructionAccount::writable(ctx.vault_depositor.address()),
            );
            // `authority: Signer<'info>` — readonly signer.
            core::ptr::write(
                account_metas_ptr.add(2),
                InstructionAccount::readonly_signer(ctx.authority.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(3),
                InstructionAccount::writable(ctx.vault_token_account.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(4),
                InstructionAccount::writable(ctx.drift_user_stats.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(5),
                InstructionAccount::writable(ctx.drift_user.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(6),
                InstructionAccount::readonly(ctx.drift_state.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(7),
                InstructionAccount::writable(ctx.drift_spot_market_vault.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(8),
                InstructionAccount::writable(ctx.user_token_account.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(9),
                InstructionAccount::readonly(ctx.drift_program.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(10),
                InstructionAccount::readonly(ctx.token_program.address()),
            );

            for (index, account) in ctx.remaining_accounts.iter().enumerate() {
                core::ptr::write(
                    account_metas_ptr.add(FIXED_ACCOUNTS + index),
                    InstructionAccount::from(account),
                );
            }
        }

        let account_metas =
            unsafe { core::slice::from_raw_parts(account_metas_ptr, total_accounts) };

        let mut account_infos = [ctx.vault; MAX_DEPOSIT_ACCOUNTS];
        account_infos[1] = ctx.vault_depositor;
        account_infos[2] = ctx.authority;
        account_infos[3] = ctx.vault_token_account;
        account_infos[4] = ctx.drift_user_stats;
        account_infos[5] = ctx.drift_user;
        account_infos[6] = ctx.drift_state;
        account_infos[7] = ctx.drift_spot_market_vault;
        account_infos[8] = ctx.user_token_account;
        account_infos[9] = ctx.drift_program;
        account_infos[10] = ctx.token_program;
        for (index, account) in ctx.remaining_accounts.iter().enumerate() {
            account_infos[FIXED_ACCOUNTS + index] = account;
        }
        let account_infos = &account_infos[..total_accounts];

        // Instruction data: discriminator(8) + amount: u64(8).
        let mut instruction_data = MaybeUninit::<[u8; DEPOSIT_DATA_LEN]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;
            core::ptr::copy_nonoverlapping(DEPOSIT_DISCRIMINATOR.as_ptr(), ptr, 8);
            core::ptr::copy_nonoverlapping(amount.to_le_bytes().as_ptr(), ptr.add(8), 8);
        }

        let deposit_ix = InstructionView {
            program_id: &DRIFT_VAULTS_PROGRAM_ID,
            accounts: account_metas,
            data: unsafe { instruction_data.assume_init_ref() },
        };

        invoke_signed_with_bounds::<MAX_DEPOSIT_ACCOUNTS>(
            &deposit_ix,
            account_infos,
            signer_seeds,
        )?;

        Ok(())
    }

    fn deposit(
        ctx: &DriftVaultsDepositAccounts<'info>,
        amount: u64,
        data: &Self::Data,
    ) -> ProgramResult {
        Self::deposit_signed(ctx, amount, data, &[])
    }
}
