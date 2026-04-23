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

pub const MARGINFI_PROGRAM_ID: Address =
    Address::from_str_const("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
pub const LENDING_ACCOUNT_DEPOSIT_DISCRIMINATOR: [u8; 8] = [171, 94, 235, 103, 82, 64, 212, 140];
pub const DEPOSIT_DATA_LEN: usize = 18;

// ───────────────────────────────────────────────────────────────────────────
// NAV reader — value of a marginfi `MarginfiAccount` in underlying tokens.
//
// `MarginfiAccount.lending_account.balances[]` holds up to 16 `Balance`
// entries, each with `bank_pk: Pubkey`, `asset_shares: WrappedI80F48`,
// `liability_shares: WrappedI80F48`, plus emissions/state fields. Net
// asset value per balance =
//
//     asset_shares * Bank::asset_share_value
//
// where `Bank::asset_share_value` is also a `WrappedI80F48` (I80F48
// fixed-point) read from the bank account.
//
// Layout source: mrgnlabs/marginfi-v2,
// programs/marginfi/src/state/marginfi_account.rs (MarginfiAccount, 2304
// bytes incl. discriminator) and
// programs/marginfi/src/state/marginfi_group.rs (Bank).
//
// TODO(NAV-MARGINFI): implement once strategy-token has a verified
// marginfi deposit on devnet. Like Drift, this needs the position account
// (MarginfiAccount) AND each referenced Bank, so the wire format will
// need to grow to N accounts per marginfi position.
// ───────────────────────────────────────────────────────────────────────────

/// Compute the underlying-token value of a marginfi account.
///
/// TODO(NAV-MARGINFI): see module-level note. Currently panics at runtime
/// so callers don't silently report zero deployed capital.
pub fn read_marginfi_value(_account_data: &[u8]) -> Result<u64, ProgramError> {
    unimplemented!(
        "marginfi NAV reader not implemented — see TODO(NAV-MARGINFI). \
         Source: mrgnlabs/marginfi-v2 programs/marginfi/src/state/marginfi_account.rs"
    )
}

pub struct Marginfi;

pub struct MarginfiDepositData {
    pub deposit_up_to_amount: Option<u8>,
}

impl MarginfiDepositData {
    pub const DATA_LEN: usize = 2;
}

impl TryFrom<&[u8]> for MarginfiDepositData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.len() < Self::DATA_LEN {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(Self {
            deposit_up_to_amount: if data[0] == 0 { None } else { Some(data[1]) },
        })
    }
}

pub struct MarginfiDepositAccounts<'info> {
    pub marginfi_program: &'info AccountView,
    pub group: &'info AccountView,
    pub marginfi_account: &'info AccountView,
    pub authority: &'info AccountView,
    pub bank: &'info AccountView,
    pub signer_token_account: &'info AccountView,
    pub liquidity_vault: &'info AccountView,
    pub token_program: &'info AccountView,
}

impl<'info> TryFrom<&'info [AccountView]> for MarginfiDepositAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [marginfi_program, group, marginfi_account, authority, bank, signer_token_account, liquidity_vault, token_program, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(MarginfiDepositAccounts {
            marginfi_program,
            group,
            marginfi_account,
            authority,
            bank,
            signer_token_account,
            liquidity_vault,
            token_program,
        })
    }
}

impl<'info> Deposit<'info> for Marginfi {
    type Accounts = MarginfiDepositAccounts<'info>;
    type Data = MarginfiDepositData;

    fn deposit_signed(
        ctx: &MarginfiDepositAccounts<'info>,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let accounts = [
            InstructionAccount::readonly(ctx.group.address()),
            InstructionAccount::writable(ctx.marginfi_account.address()),
            InstructionAccount::writable_signer(ctx.authority.address()),
            InstructionAccount::writable(ctx.bank.address()),
            InstructionAccount::writable(ctx.signer_token_account.address()),
            InstructionAccount::writable(ctx.liquidity_vault.address()),
            InstructionAccount::readonly(ctx.token_program.address()),
        ];

        let account_infos = [
            ctx.group,
            ctx.marginfi_account,
            ctx.authority,
            ctx.bank,
            ctx.signer_token_account,
            ctx.liquidity_vault,
            ctx.token_program,
        ];

        let mut instruction_data = MaybeUninit::<[u8; DEPOSIT_DATA_LEN]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;
            core::ptr::copy_nonoverlapping(LENDING_ACCOUNT_DEPOSIT_DISCRIMINATOR.as_ptr(), ptr, 8);
            core::ptr::copy_nonoverlapping(amount.to_le_bytes().as_ptr(), ptr.add(8), 8);
            match data.deposit_up_to_amount {
                None => {
                    *ptr.add(16) = 0;
                    *ptr.add(17) = 0;
                }
                Some(v) => {
                    *ptr.add(16) = 1;
                    *ptr.add(17) = v;
                }
            }
        }

        let deposit_ix = InstructionView {
            program_id: &MARGINFI_PROGRAM_ID,
            accounts: &accounts,
            data: unsafe { instruction_data.assume_init_ref() },
        };

        invoke_signed(&deposit_ix, &account_infos, signer_seeds)?;

        Ok(())
    }

    fn deposit(
        ctx: &MarginfiDepositAccounts<'info>,
        amount: u64,
        data: &Self::Data,
    ) -> ProgramResult {
        Self::deposit_signed(ctx, amount, data, &[])
    }
}

// ─── DepositInit: marginfi_account_initialize ────────────────────────────
//
// Marginfi requires a `MarginfiAccount` to exist for an authority before any
// `lending_account_deposit`. The new account itself signs the create — this
// works whether the account is a fresh keypair or a PDA derived by the
// wrapping program (which would pass its seeds via `signer_seeds`).
//
// Choice: PDA-derived `marginfi_account`. The wrapping program (strategy-
// token) has a single deterministic wallet PDA per strategy and derives
// the marginfi account as a sub-PDA underneath it (e.g.
// `["marginfi", strategy, group]`), then passes the wallet PDA's signer
// seeds. Caller-supplied keypairs would force the off-chain CLI to retain
// secret material across runs, which we explicitly avoid.
//
// Account ordering verified against mrgnlabs/marginfi-v2
// `programs/marginfi/src/instructions/marginfi_account/initialize.rs`
// (struct `MarginfiAccountInitialize`, main branch @ 2026-04). Cross-
// checked with `@mrgnlabs/marginfi-client-v2` IDL `marginfi.json`.

use beethoven_core::DepositInit;

/// Anchor disc for `marginfi_account_initialize`.
/// From sha256("global:marginfi_account_initialize")[..8].
pub const MARGINFI_ACCOUNT_INITIALIZE_DISCRIMINATOR: [u8; 8] = [43, 78, 61, 255, 148, 52, 249, 154];

pub struct MarginfiInitAccounts<'info> {
    pub marginfi_program: &'info AccountView,
    pub group: &'info AccountView,
    pub marginfi_account: &'info AccountView,
    pub authority: &'info AccountView,
    pub fee_payer: &'info AccountView,
    pub system_program: &'info AccountView,
}

impl<'info> TryFrom<&'info [AccountView]> for MarginfiInitAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [marginfi_program, group, marginfi_account, authority, fee_payer, system_program] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(MarginfiInitAccounts {
            marginfi_program,
            group,
            marginfi_account,
            authority,
            fee_payer,
            system_program,
        })
    }
}

impl<'info> DepositInit<'info> for Marginfi {
    type Accounts = MarginfiInitAccounts<'info>;

    fn init_signed(ctx: &Self::Accounts, signer_seeds: &[Signer]) -> ProgramResult {
        // Account roles (from marginfi-v2 MarginfiAccountInitialize):
        //   group            readonly
        //   marginfi_account writable signer  (the new account; PDA-signed
        //                                      via signer_seeds when needed)
        //   authority        readonly signer
        //   fee_payer        writable signer
        //   system_program   readonly
        let accounts = [
            InstructionAccount::readonly(ctx.group.address()),
            InstructionAccount::writable_signer(ctx.marginfi_account.address()),
            InstructionAccount::readonly_signer(ctx.authority.address()),
            InstructionAccount::writable_signer(ctx.fee_payer.address()),
            InstructionAccount::readonly(ctx.system_program.address()),
        ];

        let infos = [
            ctx.group,
            ctx.marginfi_account,
            ctx.authority,
            ctx.fee_payer,
            ctx.system_program,
        ];

        let ix = InstructionView {
            program_id: &MARGINFI_PROGRAM_ID,
            accounts: &accounts,
            data: &MARGINFI_ACCOUNT_INITIALIZE_DISCRIMINATOR,
        };

        invoke_signed(&ix, &infos, signer_seeds)
    }

    fn init(ctx: &Self::Accounts) -> ProgramResult {
        Self::init_signed(ctx, &[])
    }
}
