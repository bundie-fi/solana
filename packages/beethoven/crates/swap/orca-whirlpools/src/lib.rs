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

pub const ORCA_WHIRLPOOLS_PROGRAM_ID: Address =
    Address::from_str_const("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

// sha256("global:swap_v2")[..8]
const SWAP_V2_DISCRIMINATOR: [u8; 8] = [43, 4, 237, 11, 26, 201, 30, 98];

pub struct OrcaWhirlpools;

/// Extra args for Whirlpools `swap_v2` that don't fit the generic
/// `(in_amount, minimum_out_amount)` Beethoven trait surface.
///
/// The wire layout (after discriminator + amount + other_amount_threshold) is:
///   sqrt_price_limit:        u128  (16 bytes, little-endian)
///   amount_specified_is_input: bool (1 byte)
///   a_to_b:                  bool  (1 byte)
///   remaining_accounts_info: Option<RemainingAccountsInfo> — always None (1 byte = 0)
pub struct OrcaWhirlpoolsSwapData {
    pub sqrt_price_limit: u128,
    pub amount_specified_is_input: bool,
    pub a_to_b: bool,
}

impl OrcaWhirlpoolsSwapData {
    pub const DATA_LEN: usize = 18;

    /// Sane default: no price limit, exact-in, swap A → B.
    pub const fn a_to_b_exact_in() -> Self {
        Self {
            sqrt_price_limit: 0,
            amount_specified_is_input: true,
            a_to_b: true,
        }
    }

    /// Sane default: no price limit, exact-in, swap B → A.
    pub const fn b_to_a_exact_in() -> Self {
        Self {
            sqrt_price_limit: 0,
            amount_specified_is_input: true,
            a_to_b: false,
        }
    }
}

impl TryFrom<&[u8]> for OrcaWhirlpoolsSwapData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.len() < Self::DATA_LEN {
            return Err(ProgramError::InvalidInstructionData);
        }
        let mut sqrt_bytes = [0u8; 16];
        sqrt_bytes.copy_from_slice(&data[0..16]);
        Ok(Self {
            sqrt_price_limit: u128::from_le_bytes(sqrt_bytes),
            amount_specified_is_input: data[16] != 0,
            a_to_b: data[17] != 0,
        })
    }
}

impl OrcaWhirlpoolsSwapAccounts<'_> {
    pub const NUM_ACCOUNTS: usize = 16;
}

pub struct OrcaWhirlpoolsSwapAccounts<'info> {
    pub orca_whirlpools_program: &'info AccountView,
    pub token_program_a: &'info AccountView,
    pub token_program_b: &'info AccountView,
    pub memo_program: &'info AccountView,
    pub token_authority: &'info AccountView,
    pub whirlpool: &'info AccountView,
    pub token_mint_a: &'info AccountView,
    pub token_mint_b: &'info AccountView,
    pub token_owner_account_a: &'info AccountView,
    pub token_vault_a: &'info AccountView,
    pub token_owner_account_b: &'info AccountView,
    pub token_vault_b: &'info AccountView,
    pub tick_array_0: &'info AccountView,
    pub tick_array_1: &'info AccountView,
    pub tick_array_2: &'info AccountView,
    pub oracle: &'info AccountView,
}

impl<'info> TryFrom<&'info [AccountView]> for OrcaWhirlpoolsSwapAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [orca_whirlpools_program, token_program_a, token_program_b, memo_program, token_authority, whirlpool, token_mint_a, token_mint_b, token_owner_account_a, token_vault_a, token_owner_account_b, token_vault_b, tick_array_0, tick_array_1, tick_array_2, oracle, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(OrcaWhirlpoolsSwapAccounts {
            orca_whirlpools_program,
            token_program_a,
            token_program_b,
            memo_program,
            token_authority,
            whirlpool,
            token_mint_a,
            token_mint_b,
            token_owner_account_a,
            token_vault_a,
            token_owner_account_b,
            token_vault_b,
            tick_array_0,
            tick_array_1,
            tick_array_2,
            oracle,
        })
    }
}

impl<'info> Swap<'info> for OrcaWhirlpools {
    type Accounts = OrcaWhirlpoolsSwapAccounts<'info>;
    type Data = OrcaWhirlpoolsSwapData;

    fn swap_signed(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let accounts = [
            InstructionAccount::readonly(ctx.token_program_a.address()),
            InstructionAccount::readonly(ctx.token_program_b.address()),
            InstructionAccount::readonly(ctx.memo_program.address()),
            InstructionAccount::readonly_signer(ctx.token_authority.address()),
            InstructionAccount::writable(ctx.whirlpool.address()),
            InstructionAccount::readonly(ctx.token_mint_a.address()),
            InstructionAccount::readonly(ctx.token_mint_b.address()),
            InstructionAccount::writable(ctx.token_owner_account_a.address()),
            InstructionAccount::writable(ctx.token_vault_a.address()),
            InstructionAccount::writable(ctx.token_owner_account_b.address()),
            InstructionAccount::writable(ctx.token_vault_b.address()),
            InstructionAccount::writable(ctx.tick_array_0.address()),
            InstructionAccount::writable(ctx.tick_array_1.address()),
            InstructionAccount::writable(ctx.tick_array_2.address()),
            InstructionAccount::writable(ctx.oracle.address()),
        ];

        let account_infos = [
            ctx.token_program_a,
            ctx.token_program_b,
            ctx.memo_program,
            ctx.token_authority,
            ctx.whirlpool,
            ctx.token_mint_a,
            ctx.token_mint_b,
            ctx.token_owner_account_a,
            ctx.token_vault_a,
            ctx.token_owner_account_b,
            ctx.token_vault_b,
            ctx.tick_array_0,
            ctx.tick_array_1,
            ctx.tick_array_2,
            ctx.oracle,
        ];

        // Wire layout (43 bytes):
        //   [0..8)    discriminator
        //   [8..16)   amount (u64 LE)                 = in_amount
        //   [16..24)  other_amount_threshold (u64 LE) = minimum_out_amount
        //   [24..40)  sqrt_price_limit (u128 LE)
        //   [40]      amount_specified_is_input (bool)
        //   [41]      a_to_b (bool)
        //   [42]      Option<RemainingAccountsInfo> tag = 0 (None)
        let mut instruction_data = MaybeUninit::<[u8; 43]>::uninit();
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
                data.sqrt_price_limit.to_le_bytes().as_ptr(),
                ptr.add(24),
                16,
            );
            core::ptr::write(ptr.add(40), data.amount_specified_is_input as u8);
            core::ptr::write(ptr.add(41), data.a_to_b as u8);
            core::ptr::write(ptr.add(42), 0u8); // remaining_accounts_info: None
        }

        let instruction = InstructionView {
            program_id: &ORCA_WHIRLPOOLS_PROGRAM_ID,
            accounts: &accounts,
            data: unsafe {
                core::slice::from_raw_parts(instruction_data.as_ptr() as *const u8, 43)
            },
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
