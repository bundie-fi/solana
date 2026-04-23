#![no_std]

use {
    beethoven_core::Swap,
    core::mem::MaybeUninit,
    solana_account_view::AccountView,
    solana_address::Address,
    solana_instruction_view::{
        cpi::{invoke_signed, Signer},
        InstructionAccount, InstructionView,
    },
    solana_program_error::{ProgramError, ProgramResult},
};

pub const RAYDIUM_CLMM_PROGRAM_ID: Address =
    Address::from_str_const("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");

// sha256("global:swap_v2")[:8]
const SWAP_V2_DISCRIMINATOR: [u8; 8] = [43, 4, 237, 11, 26, 201, 30, 98];

// disc(8) + amount(8) + other_amount_threshold(8) + sqrt_price_limit_x64(16) + is_base_input(1)
const DATA_LEN: usize = 41;

pub struct RaydiumClmm;

pub struct RaydiumClmmData {
    pub sqrt_price_limit_x64: u128,
    pub is_base_input: bool,
}

impl RaydiumClmmData {
    /// Wire format: u128 LE sqrt_price_limit_x64 (16 bytes) + bool is_base_input (1 byte).
    pub const DATA_LEN: usize = 17;

    /// Sane default for an exact-input swap with no price limit.
    pub const fn exact_in() -> Self {
        Self {
            sqrt_price_limit_x64: 0,
            is_base_input: true,
        }
    }
}

impl TryFrom<&[u8]> for RaydiumClmmData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.len() < Self::DATA_LEN {
            return Err(ProgramError::InvalidInstructionData);
        }
        let mut limit_bytes = [0u8; 16];
        limit_bytes.copy_from_slice(&data[..16]);
        Ok(Self {
            sqrt_price_limit_x64: u128::from_le_bytes(limit_bytes),
            is_base_input: data[16] != 0,
        })
    }
}

impl RaydiumClmmSwapAccounts<'_> {
    pub const NUM_ACCOUNTS: usize = 14;
}

pub struct RaydiumClmmSwapAccounts<'info> {
    pub raydium_clmm_program: &'info AccountView,
    pub payer: &'info AccountView,
    pub amm_config: &'info AccountView,
    pub pool_state: &'info AccountView,
    pub input_token_account: &'info AccountView,
    pub output_token_account: &'info AccountView,
    pub input_vault: &'info AccountView,
    pub output_vault: &'info AccountView,
    pub observation_state: &'info AccountView,
    pub token_program: &'info AccountView,
    pub token_program_2022: &'info AccountView,
    pub memo_program: &'info AccountView,
    pub input_vault_mint: &'info AccountView,
    pub output_vault_mint: &'info AccountView,
}

impl<'info> TryFrom<&'info [AccountView]> for RaydiumClmmSwapAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [raydium_clmm_program, payer, amm_config, pool_state, input_token_account, output_token_account, input_vault, output_vault, observation_state, token_program, token_program_2022, memo_program, input_vault_mint, output_vault_mint, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(RaydiumClmmSwapAccounts {
            raydium_clmm_program,
            payer,
            amm_config,
            pool_state,
            input_token_account,
            output_token_account,
            input_vault,
            output_vault,
            observation_state,
            token_program,
            token_program_2022,
            memo_program,
            input_vault_mint,
            output_vault_mint,
        })
    }
}

impl<'info> Swap<'info> for RaydiumClmm {
    type Accounts = RaydiumClmmSwapAccounts<'info>;
    type Data = RaydiumClmmData;

    fn swap_signed(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        data: &RaydiumClmmData,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let accounts = [
            InstructionAccount::readonly_signer(ctx.payer.address()),
            InstructionAccount::readonly(ctx.amm_config.address()),
            InstructionAccount::writable(ctx.pool_state.address()),
            InstructionAccount::writable(ctx.input_token_account.address()),
            InstructionAccount::writable(ctx.output_token_account.address()),
            InstructionAccount::writable(ctx.input_vault.address()),
            InstructionAccount::writable(ctx.output_vault.address()),
            InstructionAccount::writable(ctx.observation_state.address()),
            InstructionAccount::readonly(ctx.token_program.address()),
            InstructionAccount::readonly(ctx.token_program_2022.address()),
            InstructionAccount::readonly(ctx.memo_program.address()),
            InstructionAccount::readonly(ctx.input_vault_mint.address()),
            InstructionAccount::readonly(ctx.output_vault_mint.address()),
        ];

        let account_infos = [
            ctx.payer,
            ctx.amm_config,
            ctx.pool_state,
            ctx.input_token_account,
            ctx.output_token_account,
            ctx.input_vault,
            ctx.output_vault,
            ctx.observation_state,
            ctx.token_program,
            ctx.token_program_2022,
            ctx.memo_program,
            ctx.input_vault_mint,
            ctx.output_vault_mint,
        ];

        let mut instruction_data = MaybeUninit::<[u8; DATA_LEN]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;
            core::ptr::copy_nonoverlapping(SWAP_V2_DISCRIMINATOR.as_ptr(), ptr, 8);
            core::ptr::copy_nonoverlapping(in_amount.to_le_bytes().as_ptr(), ptr.add(8), 8);
            core::ptr::copy_nonoverlapping(
                minimum_out_amount.to_le_bytes().as_ptr(),
                ptr.add(16),
                8,
            );
            core::ptr::copy_nonoverlapping(
                data.sqrt_price_limit_x64.to_le_bytes().as_ptr(),
                ptr.add(24),
                16,
            );
            *ptr.add(40) = data.is_base_input as u8;
        }

        let instruction = InstructionView {
            program_id: &RAYDIUM_CLMM_PROGRAM_ID,
            accounts: &accounts,
            data: unsafe { instruction_data.assume_init_ref() },
        };

        invoke_signed(&instruction, &account_infos, signer_seeds)
    }

    fn swap(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        data: &Self::Data,
    ) -> ProgramResult {
        Self::swap_signed(ctx, in_amount, minimum_out_amount, data, &[])
    }
}
