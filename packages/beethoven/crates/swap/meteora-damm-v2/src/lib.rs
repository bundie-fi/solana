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

pub const METEORA_DAMM_V2_PROGRAM_ID: Address =
    Address::from_str_const("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

// sha256("global:swap")[..8]
const SWAP_DISCRIMINATOR: [u8; 8] = [248, 198, 158, 145, 225, 117, 135, 200];

pub struct MeteoraDammV2;

/// Marker data type. The DAMM v2 swap instruction only needs `amount_in` +
/// `minimum_amount_out`, both already supplied by the Swap trait.
pub struct MeteoraDammV2SwapData;

impl MeteoraDammV2SwapData {
    pub const DATA_LEN: usize = 0;
}

impl TryFrom<&[u8]> for MeteoraDammV2SwapData {
    type Error = ProgramError;

    fn try_from(_data: &[u8]) -> Result<Self, Self::Error> {
        Ok(Self)
    }
}

impl MeteoraDammV2SwapAccounts<'_> {
    /// Total fixed accounts (incl. program account, excl. optional referral).
    /// `referral_token_account` is slotted as the program ID when not present.
    pub const NUM_ACCOUNTS: usize = 14;
}

pub struct MeteoraDammV2SwapAccounts<'info> {
    pub meteora_damm_v2_program: &'info AccountView,
    pub pool_authority: &'info AccountView,
    pub pool: &'info AccountView,
    pub input_token_account: &'info AccountView,
    pub output_token_account: &'info AccountView,
    pub token_a_vault: &'info AccountView,
    pub token_b_vault: &'info AccountView,
    pub token_a_mint: &'info AccountView,
    pub token_b_mint: &'info AccountView,
    pub payer: &'info AccountView,
    pub token_a_program: &'info AccountView,
    pub token_b_program: &'info AccountView,
    /// Optional. Pass the program ID account when absent (Anchor pattern).
    pub referral_token_account: &'info AccountView,
    pub event_authority: &'info AccountView,
}

impl<'info> TryFrom<&'info [AccountView]> for MeteoraDammV2SwapAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [meteora_damm_v2_program, pool_authority, pool, input_token_account, output_token_account, token_a_vault, token_b_vault, token_a_mint, token_b_mint, payer, token_a_program, token_b_program, referral_token_account, event_authority, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(MeteoraDammV2SwapAccounts {
            meteora_damm_v2_program,
            pool_authority,
            pool,
            input_token_account,
            output_token_account,
            token_a_vault,
            token_b_vault,
            token_a_mint,
            token_b_mint,
            payer,
            token_a_program,
            token_b_program,
            referral_token_account,
            event_authority,
        })
    }
}

impl<'info> Swap<'info> for MeteoraDammV2 {
    type Accounts = MeteoraDammV2SwapAccounts<'info>;
    type Data = MeteoraDammV2SwapData;

    fn swap_signed(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        _data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let accounts = [
            InstructionAccount::readonly(ctx.pool_authority.address()),
            InstructionAccount::writable(ctx.pool.address()),
            InstructionAccount::writable(ctx.input_token_account.address()),
            InstructionAccount::writable(ctx.output_token_account.address()),
            InstructionAccount::writable(ctx.token_a_vault.address()),
            InstructionAccount::writable(ctx.token_b_vault.address()),
            InstructionAccount::readonly(ctx.token_a_mint.address()),
            InstructionAccount::readonly(ctx.token_b_mint.address()),
            InstructionAccount::readonly_signer(ctx.payer.address()),
            InstructionAccount::readonly(ctx.token_a_program.address()),
            InstructionAccount::readonly(ctx.token_b_program.address()),
            InstructionAccount::writable(ctx.referral_token_account.address()),
            InstructionAccount::readonly(ctx.event_authority.address()),
            InstructionAccount::readonly(ctx.meteora_damm_v2_program.address()),
        ];

        let account_infos = [
            ctx.pool_authority,
            ctx.pool,
            ctx.input_token_account,
            ctx.output_token_account,
            ctx.token_a_vault,
            ctx.token_b_vault,
            ctx.token_a_mint,
            ctx.token_b_mint,
            ctx.payer,
            ctx.token_a_program,
            ctx.token_b_program,
            ctx.referral_token_account,
            ctx.event_authority,
            ctx.meteora_damm_v2_program,
        ];

        // Wire layout (24 bytes): disc(8) + amount_in(8) + minimum_amount_out(8)
        let mut instruction_data = MaybeUninit::<[u8; 24]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;
            core::ptr::copy_nonoverlapping(SWAP_DISCRIMINATOR.as_ptr(), ptr, 8);
            core::ptr::copy_nonoverlapping(in_amount.to_le_bytes().as_ptr(), ptr.add(8), 8);
            core::ptr::copy_nonoverlapping(
                minimum_out_amount.to_le_bytes().as_ptr(),
                ptr.add(16),
                8,
            );
        }

        let instruction = InstructionView {
            program_id: &METEORA_DAMM_V2_PROGRAM_ID,
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
