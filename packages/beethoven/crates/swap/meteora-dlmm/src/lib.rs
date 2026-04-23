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

pub const METEORA_DLMM_PROGRAM_ID: Address =
    Address::from_str_const("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

// sha256("global:swap")[..8]
const SWAP_DISCRIMINATOR: [u8; 8] = [248, 198, 158, 145, 225, 117, 135, 200];

/// Maximum number of `bin_array` accounts forwarded as remaining_accounts.
/// DLMM swaps usually need 1–3 bin arrays depending on price-range crossed.
pub const MAX_BIN_ARRAYS: usize = 4;

pub struct MeteoraDlmm;

/// Extra data for DLMM swap. The wire format only needs `amount_in` +
/// `min_amount_out` (both supplied by the Beethoven Swap trait), so this
/// struct is purely a marker — kept as a unit-like type for API parity with
/// other crates and so a future `swap_with_price_impact` variant can extend
/// it without breaking dispatch.
pub struct MeteoraDlmmSwapData;

impl MeteoraDlmmSwapData {
    pub const DATA_LEN: usize = 0;
}

impl TryFrom<&[u8]> for MeteoraDlmmSwapData {
    type Error = ProgramError;

    fn try_from(_data: &[u8]) -> Result<Self, Self::Error> {
        Ok(Self)
    }
}

impl MeteoraDlmmSwapAccounts<'_> {
    /// Fixed accounts (excludes program + bin_array remaining accounts).
    /// `bin_array_bitmap_extension` and `host_fee_in` are slotted as the
    /// program ID when not present (Anchor's optional-account convention).
    pub const NUM_ACCOUNTS: usize = 15;
}

pub struct MeteoraDlmmSwapAccounts<'info> {
    pub meteora_dlmm_program: &'info AccountView,
    pub lb_pair: &'info AccountView,
    /// Optional. Pass the program ID account when absent (Anchor pattern).
    pub bin_array_bitmap_extension: &'info AccountView,
    pub reserve_x: &'info AccountView,
    pub reserve_y: &'info AccountView,
    pub user_token_in: &'info AccountView,
    pub user_token_out: &'info AccountView,
    pub token_x_mint: &'info AccountView,
    pub token_y_mint: &'info AccountView,
    pub oracle: &'info AccountView,
    /// Optional. Pass the program ID account when absent.
    pub host_fee_in: &'info AccountView,
    pub user: &'info AccountView,
    pub token_x_program: &'info AccountView,
    pub token_y_program: &'info AccountView,
    pub event_authority: &'info AccountView,
    pub bin_arrays: &'info [AccountView],
}

impl<'info> TryFrom<&'info [AccountView]> for MeteoraDlmmSwapAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [meteora_dlmm_program, lb_pair, bin_array_bitmap_extension, reserve_x, reserve_y, user_token_in, user_token_out, token_x_mint, token_y_mint, oracle, host_fee_in, user, token_x_program, token_y_program, event_authority, bin_arrays @ ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(MeteoraDlmmSwapAccounts {
            meteora_dlmm_program,
            lb_pair,
            bin_array_bitmap_extension,
            reserve_x,
            reserve_y,
            user_token_in,
            user_token_out,
            token_x_mint,
            token_y_mint,
            oracle,
            host_fee_in,
            user,
            token_x_program,
            token_y_program,
            event_authority,
            bin_arrays,
        })
    }
}

impl<'info> Swap<'info> for MeteoraDlmm {
    type Accounts = MeteoraDlmmSwapAccounts<'info>;
    type Data = MeteoraDlmmSwapData;

    fn swap_signed(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        _data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        // 15 fixed accounts (incl. event_authority + program) followed by up
        // to MAX_BIN_ARRAYS bin_arrays as remaining accounts. We allocate a
        // fixed-size infos array so `invoke_signed` (which requires a
        // `&[&AccountView; N]`) gets a const-sized reference — unused tail
        // slots are filled with `meteora_dlmm_program` (a harmless readonly
        // duplicate), matching the Kamino refresh-obligation pattern.
        const TOTAL: usize = 15 + MAX_BIN_ARRAYS;

        // Build instruction-meta list. Fixed prefix is always present; bin
        // arrays are appended as writable remaining accounts.
        let mut metas = MaybeUninit::<[InstructionAccount; TOTAL]>::uninit();
        let metas_ptr = metas.as_mut_ptr() as *mut InstructionAccount;
        unsafe {
            core::ptr::write(metas_ptr, InstructionAccount::writable(ctx.lb_pair.address()));
            core::ptr::write(
                metas_ptr.add(1),
                InstructionAccount::writable(ctx.bin_array_bitmap_extension.address()),
            );
            core::ptr::write(
                metas_ptr.add(2),
                InstructionAccount::writable(ctx.reserve_x.address()),
            );
            core::ptr::write(
                metas_ptr.add(3),
                InstructionAccount::writable(ctx.reserve_y.address()),
            );
            core::ptr::write(
                metas_ptr.add(4),
                InstructionAccount::writable(ctx.user_token_in.address()),
            );
            core::ptr::write(
                metas_ptr.add(5),
                InstructionAccount::writable(ctx.user_token_out.address()),
            );
            core::ptr::write(
                metas_ptr.add(6),
                InstructionAccount::readonly(ctx.token_x_mint.address()),
            );
            core::ptr::write(
                metas_ptr.add(7),
                InstructionAccount::readonly(ctx.token_y_mint.address()),
            );
            core::ptr::write(
                metas_ptr.add(8),
                InstructionAccount::writable(ctx.oracle.address()),
            );
            core::ptr::write(
                metas_ptr.add(9),
                InstructionAccount::writable(ctx.host_fee_in.address()),
            );
            core::ptr::write(
                metas_ptr.add(10),
                InstructionAccount::readonly_signer(ctx.user.address()),
            );
            core::ptr::write(
                metas_ptr.add(11),
                InstructionAccount::readonly(ctx.token_x_program.address()),
            );
            core::ptr::write(
                metas_ptr.add(12),
                InstructionAccount::readonly(ctx.token_y_program.address()),
            );
            core::ptr::write(
                metas_ptr.add(13),
                InstructionAccount::readonly(ctx.event_authority.address()),
            );
            core::ptr::write(
                metas_ptr.add(14),
                InstructionAccount::readonly(ctx.meteora_dlmm_program.address()),
            );

            let n = ctx.bin_arrays.len().min(MAX_BIN_ARRAYS);
            for i in 0..n {
                core::ptr::write(
                    metas_ptr.add(15 + i),
                    InstructionAccount::writable(ctx.bin_arrays[i].address()),
                );
            }
        }

        let n_bin_arrays = ctx.bin_arrays.len().min(MAX_BIN_ARRAYS);
        let total_metas = 15 + n_bin_arrays;
        let metas_slice = unsafe {
            core::slice::from_raw_parts(metas_ptr as *const InstructionAccount, total_metas)
        };

        // Build account infos as a fixed-size array. Tail slots beyond the
        // active count get filled with `meteora_dlmm_program` (a readonly
        // sentinel). The runtime only walks slots referenced by metas_slice.
        let mut account_infos: [&AccountView; TOTAL] = [ctx.meteora_dlmm_program; TOTAL];
        account_infos[0] = ctx.lb_pair;
        account_infos[1] = ctx.bin_array_bitmap_extension;
        account_infos[2] = ctx.reserve_x;
        account_infos[3] = ctx.reserve_y;
        account_infos[4] = ctx.user_token_in;
        account_infos[5] = ctx.user_token_out;
        account_infos[6] = ctx.token_x_mint;
        account_infos[7] = ctx.token_y_mint;
        account_infos[8] = ctx.oracle;
        account_infos[9] = ctx.host_fee_in;
        account_infos[10] = ctx.user;
        account_infos[11] = ctx.token_x_program;
        account_infos[12] = ctx.token_y_program;
        account_infos[13] = ctx.event_authority;
        account_infos[14] = ctx.meteora_dlmm_program;
        for i in 0..n_bin_arrays {
            account_infos[15 + i] = &ctx.bin_arrays[i];
        }

        // Wire layout (24 bytes): disc(8) + amount_in(8) + min_amount_out(8)
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
            program_id: &METEORA_DLMM_PROGRAM_ID,
            accounts: metas_slice,
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
