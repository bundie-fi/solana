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

// ───────────────────────────────────────────────────────────────────────────
// NAV reader — value of an mSOL position in SOL lamports.
//
// `state.msol_price` is a Q32.32 fixed-point value stored as `u64` (units:
// lamports of SOL per mSOL × 2^32). To value an mSOL balance:
//
//     sol_lamports = (msol_balance * msol_price) >> 32
//
// Layout source: marinade-finance/liquid-staking-program,
// programs/marinade-finance/src/state/mod.rs (`State` account).
//
// The exact byte offset of `msol_price` within the State account is
// non-trivial because `StakeSystem`, `ValidatorSystem`, and `LiqPool` have
// nested fixed-size sub-structs. The published Marinade SDK reads
// `msol_price` via Anchor codegen which we cannot reuse here under
// `#![no_std]`. Devnet integration must verify the offset against a live
// dump of the Marinade State PDA (`8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC`
// on devnet, see scripts/marinade-probe-devnet.mjs) before this reader can
// be trusted.
// ───────────────────────────────────────────────────────────────────────────

/// Compute the SOL-lamport value of `msol_amount` mSOL given the raw
/// Marinade State account data.
///
/// TODO(NAV-MARINADE): replace `unimplemented!()` with the verified byte
/// offset of `msol_price` in `State`. Source of truth:
/// <https://github.com/marinade-finance/liquid-staking-program/blob/main/programs/marinade-finance/src/state/mod.rs>.
/// Until then this function will panic at runtime, which is intentional —
/// silently returning 0 (or a wrong offset) would corrupt strategy NAV.
pub fn read_msol_value(_state_data: &[u8], msol_amount: u64) -> Result<u64, ProgramError> {
    if msol_amount == 0 {
        return Ok(0);
    }
    // Once the offset is verified, the body becomes:
    //
    //     const MSOL_PRICE_OFFSET: usize = <verified>;
    //     if _state_data.len() < MSOL_PRICE_OFFSET + 8 {
    //         return Err(ProgramError::InvalidAccountData);
    //     }
    //     let msol_price = u64::from_le_bytes(
    //         _state_data[MSOL_PRICE_OFFSET..MSOL_PRICE_OFFSET + 8]
    //             .try_into()
    //             .map_err(|_| ProgramError::InvalidAccountData)?,
    //     );
    //     let value = ((msol_amount as u128) * (msol_price as u128)) >> 32;
    //     if value > u64::MAX as u128 {
    //         return Err(ProgramError::ArithmeticOverflow);
    //     }
    //     Ok(value as u64)
    unimplemented!("Marinade msol_price offset not yet verified — see TODO(NAV-MARINADE)")
}

/// Marinade Finance program ID — same on devnet and mainnet-beta.
/// Verified live on devnet (slot 285395436): `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD`.
pub const MARINADE_PROGRAM_ID: Address =
    Address::from_str_const("MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD");

/// Anchor discriminator for the `deposit` instruction.
/// `sha256("global:deposit")[..8]`.
pub const DEPOSIT_DISCRIMINATOR: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];

/// Wire-format size of the `deposit` instruction data: 8-byte Anchor
/// discriminator + 8-byte little-endian `lamports: u64`.
pub const DEPOSIT_DATA_LEN: usize = 16;

pub struct Marinade;

/// Marinade `deposit` takes a single u64 (lamports) — there are no extra
/// args, but we keep the typed-data slot for symmetry with other Deposit
/// implementations and forward-compat (e.g. routing flags).
pub struct MarinadeDepositData;

impl MarinadeDepositData {
    pub const DATA_LEN: usize = 0;
}

impl TryFrom<&[u8]> for MarinadeDepositData {
    type Error = ProgramError;

    fn try_from(_data: &[u8]) -> Result<Self, Self::Error> {
        Ok(Self)
    }
}

/// Account layout for `marinade::deposit` (verified against
/// `@marinade.finance/marinade-ts-sdk` v5 — see
/// `marinade-probe-devnet.mjs`).
///
/// Order matters and must match the SDK's `keys[]` exactly.
pub struct MarinadeDepositAccounts<'info> {
    pub marinade_program: &'info AccountView,
    pub state: &'info AccountView,
    pub msol_mint: &'info AccountView,
    pub liq_pool_sol_leg_pda: &'info AccountView,
    pub liq_pool_msol_leg: &'info AccountView,
    pub liq_pool_msol_leg_authority: &'info AccountView,
    pub reserve_pda: &'info AccountView,
    pub transfer_from: &'info AccountView,
    pub mint_to: &'info AccountView,
    pub msol_mint_authority: &'info AccountView,
    pub system_program: &'info AccountView,
    pub token_program: &'info AccountView,
}

impl MarinadeDepositAccounts<'_> {
    /// 12 = 11 program-required accounts + the Marinade program account
    /// itself (passed in so `invoke_signed` can resolve it without an
    /// extra getAccount on the host side).
    pub const NUM_ACCOUNTS: usize = 12;
}

impl<'info> TryFrom<&'info [AccountView]> for MarinadeDepositAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [marinade_program, state, msol_mint, liq_pool_sol_leg_pda, liq_pool_msol_leg, liq_pool_msol_leg_authority, reserve_pda, transfer_from, mint_to, msol_mint_authority, system_program, token_program, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(MarinadeDepositAccounts {
            marinade_program,
            state,
            msol_mint,
            liq_pool_sol_leg_pda,
            liq_pool_msol_leg,
            liq_pool_msol_leg_authority,
            reserve_pda,
            transfer_from,
            mint_to,
            msol_mint_authority,
            system_program,
            token_program,
        })
    }
}

impl<'info> Deposit<'info> for Marinade {
    type Accounts = MarinadeDepositAccounts<'info>;
    type Data = MarinadeDepositData;

    fn deposit_signed(
        ctx: &MarinadeDepositAccounts<'info>,
        amount: u64,
        _data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        // Account roles, mirrored from the Marinade SDK `deposit` instruction
        // builder. `transfer_from` is the only signer; it pays SOL into
        // `reserve_pda` (or the liq-pool SOL leg) via the system program and
        // receives mSOL minted into `mint_to`.
        let accounts = [
            InstructionAccount::writable(ctx.state.address()),
            InstructionAccount::writable(ctx.msol_mint.address()),
            InstructionAccount::writable(ctx.liq_pool_sol_leg_pda.address()),
            InstructionAccount::writable(ctx.liq_pool_msol_leg.address()),
            InstructionAccount::readonly(ctx.liq_pool_msol_leg_authority.address()),
            InstructionAccount::writable(ctx.reserve_pda.address()),
            InstructionAccount::writable_signer(ctx.transfer_from.address()),
            InstructionAccount::writable(ctx.mint_to.address()),
            InstructionAccount::readonly(ctx.msol_mint_authority.address()),
            InstructionAccount::readonly(ctx.system_program.address()),
            InstructionAccount::readonly(ctx.token_program.address()),
        ];

        let account_infos = [
            ctx.state,
            ctx.msol_mint,
            ctx.liq_pool_sol_leg_pda,
            ctx.liq_pool_msol_leg,
            ctx.liq_pool_msol_leg_authority,
            ctx.reserve_pda,
            ctx.transfer_from,
            ctx.mint_to,
            ctx.msol_mint_authority,
            ctx.system_program,
            ctx.token_program,
        ];

        // Layout: disc(8) || lamports: u64 LE (8) = 16 bytes.
        let mut instruction_data = MaybeUninit::<[u8; DEPOSIT_DATA_LEN]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;
            core::ptr::copy_nonoverlapping(DEPOSIT_DISCRIMINATOR.as_ptr(), ptr, 8);
            core::ptr::copy_nonoverlapping(amount.to_le_bytes().as_ptr(), ptr.add(8), 8);
        }

        let deposit_ix = InstructionView {
            program_id: &MARINADE_PROGRAM_ID,
            accounts: &accounts,
            data: unsafe { instruction_data.assume_init_ref() },
        };

        invoke_signed(&deposit_ix, &account_infos, signer_seeds)?;

        Ok(())
    }

    fn deposit(
        ctx: &MarinadeDepositAccounts<'info>,
        amount: u64,
        data: &Self::Data,
    ) -> ProgramResult {
        Self::deposit_signed(ctx, amount, data, &[])
    }
}
