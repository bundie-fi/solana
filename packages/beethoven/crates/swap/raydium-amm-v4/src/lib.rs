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

pub const RAYDIUM_AMM_V4_PROGRAM_ID: Address =
    Address::from_str_const("DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav");

// Borsh enum tag for `swap_base_in` (variant 9). NOT an Anchor sighash.
const SWAP_BASE_IN_TAG: u8 = 9;

// tag(1) + amount_in(8) + minimum_amount_out(8)
const DATA_LEN: usize = 17;

pub struct RaydiumAmmV4;

impl RaydiumAmmV4SwapAccounts<'_> {
    pub const NUM_ACCOUNTS: usize = 18;
}

pub struct RaydiumAmmV4SwapAccounts<'info> {
    pub raydium_amm_v4_program: &'info AccountView,
    pub token_program: &'info AccountView,
    pub amm_id: &'info AccountView,
    pub amm_authority: &'info AccountView,
    pub amm_open_orders: &'info AccountView,
    pub amm_target_orders: &'info AccountView,
    pub pool_coin_token_account: &'info AccountView,
    pub pool_pc_token_account: &'info AccountView,
    pub serum_program_id: &'info AccountView,
    pub serum_market: &'info AccountView,
    pub serum_bids: &'info AccountView,
    pub serum_asks: &'info AccountView,
    pub serum_event_queue: &'info AccountView,
    pub serum_coin_vault_account: &'info AccountView,
    pub serum_pc_vault_account: &'info AccountView,
    pub serum_vault_signer: &'info AccountView,
    pub user_source_token_account: &'info AccountView,
    pub user_destination_token_account: &'info AccountView,
    pub user_source_owner: &'info AccountView,
}

impl<'info> TryFrom<&'info [AccountView]> for RaydiumAmmV4SwapAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [raydium_amm_v4_program, token_program, amm_id, amm_authority, amm_open_orders, amm_target_orders, pool_coin_token_account, pool_pc_token_account, serum_program_id, serum_market, serum_bids, serum_asks, serum_event_queue, serum_coin_vault_account, serum_pc_vault_account, serum_vault_signer, user_source_token_account, user_destination_token_account, user_source_owner, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(RaydiumAmmV4SwapAccounts {
            raydium_amm_v4_program,
            token_program,
            amm_id,
            amm_authority,
            amm_open_orders,
            amm_target_orders,
            pool_coin_token_account,
            pool_pc_token_account,
            serum_program_id,
            serum_market,
            serum_bids,
            serum_asks,
            serum_event_queue,
            serum_coin_vault_account,
            serum_pc_vault_account,
            serum_vault_signer,
            user_source_token_account,
            user_destination_token_account,
            user_source_owner,
        })
    }
}

impl<'info> Swap<'info> for RaydiumAmmV4 {
    type Accounts = RaydiumAmmV4SwapAccounts<'info>;
    type Data = ();

    fn swap_signed(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        _data: &(),
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let accounts = [
            InstructionAccount::readonly(ctx.token_program.address()),
            InstructionAccount::writable(ctx.amm_id.address()),
            InstructionAccount::readonly(ctx.amm_authority.address()),
            InstructionAccount::writable(ctx.amm_open_orders.address()),
            InstructionAccount::writable(ctx.amm_target_orders.address()),
            InstructionAccount::writable(ctx.pool_coin_token_account.address()),
            InstructionAccount::writable(ctx.pool_pc_token_account.address()),
            InstructionAccount::readonly(ctx.serum_program_id.address()),
            InstructionAccount::writable(ctx.serum_market.address()),
            InstructionAccount::writable(ctx.serum_bids.address()),
            InstructionAccount::writable(ctx.serum_asks.address()),
            InstructionAccount::writable(ctx.serum_event_queue.address()),
            InstructionAccount::writable(ctx.serum_coin_vault_account.address()),
            InstructionAccount::writable(ctx.serum_pc_vault_account.address()),
            InstructionAccount::readonly(ctx.serum_vault_signer.address()),
            InstructionAccount::writable(ctx.user_source_token_account.address()),
            InstructionAccount::writable(ctx.user_destination_token_account.address()),
            InstructionAccount::readonly_signer(ctx.user_source_owner.address()),
        ];

        let account_infos = [
            ctx.token_program,
            ctx.amm_id,
            ctx.amm_authority,
            ctx.amm_open_orders,
            ctx.amm_target_orders,
            ctx.pool_coin_token_account,
            ctx.pool_pc_token_account,
            ctx.serum_program_id,
            ctx.serum_market,
            ctx.serum_bids,
            ctx.serum_asks,
            ctx.serum_event_queue,
            ctx.serum_coin_vault_account,
            ctx.serum_pc_vault_account,
            ctx.serum_vault_signer,
            ctx.user_source_token_account,
            ctx.user_destination_token_account,
            ctx.user_source_owner,
        ];

        let mut instruction_data = MaybeUninit::<[u8; DATA_LEN]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;
            *ptr = SWAP_BASE_IN_TAG;
            core::ptr::copy_nonoverlapping(in_amount.to_le_bytes().as_ptr(), ptr.add(1), 8);
            core::ptr::copy_nonoverlapping(
                minimum_out_amount.to_le_bytes().as_ptr(),
                ptr.add(9),
                8,
            );
        }

        let instruction = InstructionView {
            program_id: &RAYDIUM_AMM_V4_PROGRAM_ID,
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
