#![no_std]

use {
    beethoven_core::Deposit,
    core::mem::MaybeUninit,
    solana_account_view::AccountView,
    solana_address::Address,
    solana_instruction_view::{
        cpi::{invoke_signed, invoke_signed_with_bounds, Signer},
        InstructionAccount, InstructionView,
    },
    solana_program_error::{ProgramError, ProgramResult},
};

pub const DRIFT_PROGRAM_ID: Address =
    Address::from_str_const("dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH");
const DEPOSIT_DISCRIMINATOR: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];
const DEPOSIT_DATA_LEN: usize = 19;
// balanced estimation without blowing the stack
const MAX_DEPOSIT_ACCOUNTS: usize = 16;

// ───────────────────────────────────────────────────────────────────────────
// NAV reader — value of a Drift User account in USDC-equivalent.
//
// Drift's `User` account contains 8 `SpotPosition` entries, each with a
// `scaled_balance: u128`, `market_index: u16`, and `balance_type: u8`
// (Deposit/Borrow). To value the user, sum every Deposit position's
// `scaled_balance * spot_market.cumulative_deposit_interest` (a Q64.64
// fixed point) for the USDC market, then convert to underlying via the
// spot market's `mint_decimals`.
//
// Layout source: drift-labs/protocol-v2,
// programs/drift/src/state/user.rs (User struct, ~4376 bytes) and
// programs/drift/src/state/spot_market.rs (SpotMarket struct).
//
// TODO(NAV-DRIFT): implement once the strategy-token has a verified Drift
// integration on devnet. Drift requires reading both the User account AND
// each referenced SpotMarket account for the cumulative-interest index, so
// the wire format may need to grow to N accounts per Drift position rather
// than the standard 2.
// ───────────────────────────────────────────────────────────────────────────

/// Compute the USDC-equivalent value of a Drift user position.
///
/// TODO(NAV-DRIFT): see module-level note. Currently panics at runtime so
/// callers don't silently report zero deployed capital.
pub fn read_user_value(_user_data: &[u8]) -> Result<u64, ProgramError> {
    unimplemented!(
        "Drift NAV reader not implemented — see TODO(NAV-DRIFT). \
         Source: drift-labs/protocol-v2 programs/drift/src/state/user.rs"
    )
}

pub struct Drift;

pub struct DriftDepositData {
    pub market_index: u16,
    pub reduce_only: u8,
}

impl DriftDepositData {
    // 2 - market index
    // 1 - reduce only
    pub const DATA_LEN: usize = 3;
}

impl TryFrom<&[u8]> for DriftDepositData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.len() < Self::DATA_LEN {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(Self {
            market_index: u16::from_le_bytes(data[0..2].try_into().unwrap()),
            reduce_only: data[2],
        })
    }
}

pub struct DriftDepositAccounts<'info> {
    pub drift_program: &'info AccountView,
    pub state: &'info AccountView,
    pub user: &'info AccountView,
    pub user_stats: &'info AccountView,
    pub authority: &'info AccountView,
    pub spot_market_vault: &'info AccountView,
    pub user_token_account: &'info AccountView,
    pub token_program: &'info AccountView,
    pub remaining_accounts: &'info [AccountView],
}

impl<'info> TryFrom<&'info [AccountView]> for DriftDepositAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [drift_program, state, user, user_stats, authority, spot_market_vault, user_token_account, token_program, remaining_accounts @ ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(Self {
            drift_program,
            state,
            user,
            user_stats,
            authority,
            spot_market_vault,
            user_token_account,
            token_program,
            remaining_accounts,
        })
    }
}

impl<'info> Deposit<'info> for Drift {
    type Accounts = DriftDepositAccounts<'info>;
    type Data = DriftDepositData;

    fn deposit_signed(
        ctx: &DriftDepositAccounts<'info>,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let total_accounts = 7 + ctx.remaining_accounts.len();
        if total_accounts > MAX_DEPOSIT_ACCOUNTS {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let mut account_metas = MaybeUninit::<[InstructionAccount; MAX_DEPOSIT_ACCOUNTS]>::uninit();
        let account_metas_ptr = account_metas.as_mut_ptr() as *mut InstructionAccount;

        unsafe {
            core::ptr::write(
                account_metas_ptr,
                InstructionAccount::readonly(ctx.state.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(1),
                InstructionAccount::writable(ctx.user.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(2),
                InstructionAccount::writable(ctx.user_stats.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(3),
                InstructionAccount::writable_signer(ctx.authority.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(4),
                InstructionAccount::writable(ctx.spot_market_vault.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(5),
                InstructionAccount::writable(ctx.user_token_account.address()),
            );
            core::ptr::write(
                account_metas_ptr.add(6),
                InstructionAccount::readonly(ctx.token_program.address()),
            );

            for (index, account) in ctx.remaining_accounts.iter().enumerate() {
                core::ptr::write(
                    account_metas_ptr.add(7 + index),
                    InstructionAccount::from(account),
                );
            }
        }

        let account_metas =
            unsafe { core::slice::from_raw_parts(account_metas_ptr, total_accounts) };

        let mut account_infos = [ctx.state; MAX_DEPOSIT_ACCOUNTS];
        account_infos[1] = ctx.user;
        account_infos[2] = ctx.user_stats;
        account_infos[3] = ctx.authority;
        account_infos[4] = ctx.spot_market_vault;
        account_infos[5] = ctx.user_token_account;
        account_infos[6] = ctx.token_program;
        for (index, account) in ctx.remaining_accounts.iter().enumerate() {
            account_infos[7 + index] = account;
        }
        let account_infos = &account_infos[..total_accounts];

        let mut instruction_data = MaybeUninit::<[u8; DEPOSIT_DATA_LEN]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;
            core::ptr::copy_nonoverlapping(DEPOSIT_DISCRIMINATOR.as_ptr(), ptr, 8);
            core::ptr::copy_nonoverlapping(data.market_index.to_le_bytes().as_ptr(), ptr.add(8), 2);
            core::ptr::copy_nonoverlapping(amount.to_le_bytes().as_ptr(), ptr.add(10), 8);
            *ptr.add(18) = data.reduce_only;
        }

        let deposit_ix = InstructionView {
            program_id: &DRIFT_PROGRAM_ID,
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

    fn deposit(ctx: &DriftDepositAccounts<'info>, amount: u64, data: &Self::Data) -> ProgramResult {
        Self::deposit_signed(ctx, amount, data, &[])
    }
}

// ─── DepositInit: initialize_user_stats + initialize_user ─────────────────
//
// Drift requires two per-authority PDAs before the first deposit:
//   1. `user_stats` — singleton per authority, holds aggregate stats
//   2. `user` — one per (authority, sub_account_id), holds positions
//
// Both are Anchor-init'd via separate ixs. We CPI both back-to-back from
// `init_signed`. The wrapping program (e.g. strategy-token) provides its
// PDA seeds so the authority can be a PDA.

use beethoven_core::DepositInit;

/// Anchor disc for `initialize_user_stats`. From sha256("global:initialize_user_stats")[..8].
pub const INITIALIZE_USER_STATS_DISCRIMINATOR: [u8; 8] =
    [254, 243, 72, 98, 251, 130, 168, 213];

/// Anchor disc for `initialize_user`. From sha256("global:initialize_user")[..8].
pub const INITIALIZE_USER_DISCRIMINATOR: [u8; 8] = [111, 17, 185, 250, 60, 122, 38, 254];

/// Data layout for `initialize_user`: disc(8) + sub_account_id: u16 + name: [u8; 32]
const INITIALIZE_USER_DATA_LEN: usize = 8 + 2 + 32;

pub struct DriftInitAccounts<'info> {
    pub drift_program: &'info AccountView,
    pub user: &'info AccountView,
    pub user_stats: &'info AccountView,
    pub state: &'info AccountView,
    pub authority: &'info AccountView,
    pub payer: &'info AccountView,
    pub rent: &'info AccountView,
    pub system_program: &'info AccountView,
}

impl<'info> TryFrom<&'info [AccountView]> for DriftInitAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [drift_program, user, user_stats, state, authority, payer, rent, system_program] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(DriftInitAccounts {
            drift_program,
            user,
            user_stats,
            state,
            authority,
            payer,
            rent,
            system_program,
        })
    }
}

impl Drift {
    /// First setup ix — must run before `initialize_user`.
    /// Account roles (from drift-labs/protocol-v2 InitializeUserStats):
    ///   user_stats     writable  (init)
    ///   state          writable
    ///   authority      readonly signer
    ///   payer          writable signer
    ///   rent           readonly
    ///   system_program readonly
    fn initialize_user_stats_signed(
        ctx: &DriftInitAccounts<'_>,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let accounts = [
            InstructionAccount::writable(ctx.user_stats.address()),
            InstructionAccount::writable(ctx.state.address()),
            InstructionAccount::readonly_signer(ctx.authority.address()),
            InstructionAccount::writable_signer(ctx.payer.address()),
            InstructionAccount::readonly(ctx.rent.address()),
            InstructionAccount::readonly(ctx.system_program.address()),
        ];

        let infos = [
            ctx.user_stats,
            ctx.state,
            ctx.authority,
            ctx.payer,
            ctx.rent,
            ctx.system_program,
        ];

        let ix = InstructionView {
            program_id: &DRIFT_PROGRAM_ID,
            accounts: &accounts,
            data: &INITIALIZE_USER_STATS_DISCRIMINATOR,
        };

        invoke_signed(&ix, &infos, signer_seeds)
    }

    /// Second setup ix — depends on `user_stats` already existing.
    /// Account roles (from drift-labs/protocol-v2 InitializeUser):
    ///   user           writable  (init, seeded by sub_account_id)
    ///   user_stats     writable
    ///   state          writable
    ///   authority      readonly signer
    ///   payer          writable signer
    ///   rent           readonly
    ///   system_program readonly
    /// Args: sub_account_id: u16, name: [u8; 32]. We use sub=0, zeroed name.
    fn initialize_user_signed(
        ctx: &DriftInitAccounts<'_>,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        let accounts = [
            InstructionAccount::writable(ctx.user.address()),
            InstructionAccount::writable(ctx.user_stats.address()),
            InstructionAccount::writable(ctx.state.address()),
            InstructionAccount::readonly_signer(ctx.authority.address()),
            InstructionAccount::writable_signer(ctx.payer.address()),
            InstructionAccount::readonly(ctx.rent.address()),
            InstructionAccount::readonly(ctx.system_program.address()),
        ];

        let infos = [
            ctx.user,
            ctx.user_stats,
            ctx.state,
            ctx.authority,
            ctx.payer,
            ctx.rent,
            ctx.system_program,
        ];

        // Data: disc(8) + sub_account_id: u16 (LE) + name: [u8; 32]
        // sub_account_id = 0, name all zeros.
        let mut data = [0u8; INITIALIZE_USER_DATA_LEN];
        data[..8].copy_from_slice(&INITIALIZE_USER_DISCRIMINATOR);
        // bytes 8..10 = sub_account_id (0), bytes 10..42 = name (zeros)

        let ix = InstructionView {
            program_id: &DRIFT_PROGRAM_ID,
            accounts: &accounts,
            data: &data,
        };

        invoke_signed(&ix, &infos, signer_seeds)
    }
}

impl<'info> DepositInit<'info> for Drift {
    type Accounts = DriftInitAccounts<'info>;

    fn init_signed(ctx: &Self::Accounts, signer_seeds: &[Signer]) -> ProgramResult {
        // Order matters: user_stats must exist before user.
        Self::initialize_user_stats_signed(ctx, signer_seeds)?;
        Self::initialize_user_signed(ctx, signer_seeds)?;
        Ok(())
    }

    fn init(ctx: &Self::Accounts) -> ProgramResult {
        Self::init_signed(ctx, &[])
    }
}
