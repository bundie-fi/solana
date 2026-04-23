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

pub const METEORA_VAULTS_PROGRAM_ID: Address =
    Address::from_str_const("24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi");

// sha256("global:deposit")[..8]
pub const DEPOSIT_DISCRIMINATOR: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];
pub const DEPOSIT_DATA_LEN: usize = 24;

pub struct MeteoraVaults;

/// Per-call data for Meteora dynamic vault deposits.
///
/// The Beethoven `Deposit` trait surfaces only `amount`. The vault SDK's
/// `deposit` ix wants `(token_amount, minimum_lp_token_amount)`, so the
/// minimum-LP slippage bound is stashed here. Set to `0` to accept any
/// non-zero LP amount (no slippage protection).
pub struct MeteoraVaultsDepositData {
    pub minimum_lp_token_amount: u64,
}

impl MeteoraVaultsDepositData {
    pub const DATA_LEN: usize = 8;

    pub const fn no_slippage() -> Self {
        Self {
            minimum_lp_token_amount: 0,
        }
    }
}

impl TryFrom<&[u8]> for MeteoraVaultsDepositData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.len() < Self::DATA_LEN {
            return Err(ProgramError::InvalidInstructionData);
        }
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&data[0..8]);
        Ok(Self {
            minimum_lp_token_amount: u64::from_le_bytes(buf),
        })
    }
}

pub struct MeteoraVaultsDepositAccounts<'info> {
    pub meteora_vaults_program: &'info AccountView,
    pub vault: &'info AccountView,
    pub token_vault: &'info AccountView,
    pub lp_mint: &'info AccountView,
    pub user_token: &'info AccountView,
    pub user_lp: &'info AccountView,
    pub user: &'info AccountView,
    pub token_program: &'info AccountView,
}

impl MeteoraVaultsDepositAccounts<'_> {
    pub const NUM_ACCOUNTS: usize = 8;
}

impl<'info> TryFrom<&'info [AccountView]> for MeteoraVaultsDepositAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [meteora_vaults_program, vault, token_vault, lp_mint, user_token, user_lp, user, token_program, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(MeteoraVaultsDepositAccounts {
            meteora_vaults_program,
            vault,
            token_vault,
            lp_mint,
            user_token,
            user_lp,
            user,
            token_program,
        })
    }
}

impl<'info> Deposit<'info> for MeteoraVaults {
    type Accounts = MeteoraVaultsDepositAccounts<'info>;
    type Data = MeteoraVaultsDepositData;

    fn deposit_signed(
        ctx: &MeteoraVaultsDepositAccounts<'info>,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let accounts = [
            InstructionAccount::writable(ctx.vault.address()),
            InstructionAccount::writable(ctx.token_vault.address()),
            InstructionAccount::writable(ctx.lp_mint.address()),
            InstructionAccount::writable(ctx.user_token.address()),
            InstructionAccount::writable(ctx.user_lp.address()),
            InstructionAccount::readonly_signer(ctx.user.address()),
            InstructionAccount::readonly(ctx.token_program.address()),
        ];

        let account_infos = [
            ctx.vault,
            ctx.token_vault,
            ctx.lp_mint,
            ctx.user_token,
            ctx.user_lp,
            ctx.user,
            ctx.token_program,
        ];

        // Wire layout (24 bytes): disc(8) + token_amount(8) + minimum_lp_token_amount(8)
        let mut instruction_data = MaybeUninit::<[u8; DEPOSIT_DATA_LEN]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;
            core::ptr::copy_nonoverlapping(DEPOSIT_DISCRIMINATOR.as_ptr(), ptr, 8);
            core::ptr::copy_nonoverlapping(amount.to_le_bytes().as_ptr(), ptr.add(8), 8);
            core::ptr::copy_nonoverlapping(
                data.minimum_lp_token_amount.to_le_bytes().as_ptr(),
                ptr.add(16),
                8,
            );
        }

        let deposit_ix = InstructionView {
            program_id: &METEORA_VAULTS_PROGRAM_ID,
            accounts: &accounts,
            data: unsafe { instruction_data.assume_init_ref() },
        };

        invoke_signed(&deposit_ix, &account_infos, signer_seeds)?;

        Ok(())
    }

    fn deposit(
        ctx: &MeteoraVaultsDepositAccounts<'info>,
        amount: u64,
        data: &Self::Data,
    ) -> ProgramResult {
        Self::deposit_signed(ctx, amount, data, &[])
    }
}
