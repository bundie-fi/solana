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
// NAV reader — exchange-rate read of a Kamino Reserve.
//
// Used by strategy-token::update_nav to value cTokens (collateral) held in
// the strategy wallet at their underlying-token equivalent.
//
// Layout source: Kamino-Finance/klend, programs/klend/src/state/reserve.rs.
// Reserve is `#[account(zero_copy)]` (Pod, repr(C, packed-ish via field
// padding)). The fields we need, with offsets relative to the start of the
// account *including* the 8-byte Anchor discriminator:
//
//     0..8     Anchor discriminator
//     8..16    version: u64
//     16..32   last_update (slot:u64, stale:u8, price_status:u8, padding:[u8;6])
//     32..64   lending_market: Pubkey
//     64..96   farm_collateral: Pubkey
//     96..128  farm_debt: Pubkey
//     128..    ReserveLiquidity {
//                  mint_pubkey: Pubkey                      // 128..160
//                  supply_vault: Pubkey                     // 160..192
//                  fee_vault:    Pubkey                     // 192..224
//                  available_amount: u64                    // 224..232  ★
//                  borrowed_amount_sf: u128                 // 232..248  ★
//                  market_price_sf: u128                    // 248..264
//                  ...
//              }
//     ...     ReserveCollateral starts at offset 1344 (after liquidity = 1216 bytes):
//                  mint_pubkey: Pubkey                      // 1344..1376
//                  mint_total_supply: u64                   // 1376..1384  ★
//                  ...
//
// `borrowed_amount_sf` is a 60-bit-fraction-shifted u128 (klend's `Sf` =
// shifted by 2^60). For NAV we want underlying tokens, so we divide by
// 1u128 << 60.
//
// IMPORTANT: these offsets are derived from upstream klend at the time of
// writing. If Kamino reorders fields in a future Reserve struct migration
// the offsets must be re-verified. A defensive length check guards against
// reading from a too-small account; a wrong-but-large account would
// silently corrupt NAV — devnet integration MUST validate these offsets
// against a live reserve before mainnet.
// ───────────────────────────────────────────────────────────────────────────

const RESERVE_OFFSET_LIQUIDITY_AVAILABLE: usize = 224;
const RESERVE_OFFSET_LIQUIDITY_BORROWED_SF: usize = 232;
const RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY: usize = 1376;
const RESERVE_MIN_LEN: usize = RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY + 8;
const SF_SCALE_BITS: u32 = 60;

/// Compute the underlying-token value of `ctoken_amount` cTokens, given the
/// raw Kamino Reserve account data.
///
/// Math: `value = ctoken_amount * total_liquidity / collateral_supply`,
/// where `total_liquidity = available + (borrowed_sf >> 60)`.
///
/// Returns `Err(InvalidAccountData)` if the account is shorter than
/// expected (catches the most-likely "wrong account" footgun) or if
/// `collateral_supply` is zero (an empty reserve has no exchange rate).
pub fn read_collateral_value(reserve_data: &[u8], ctoken_amount: u64) -> Result<u64, ProgramError> {
    if reserve_data.len() < RESERVE_MIN_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    if ctoken_amount == 0 {
        return Ok(0);
    }

    let available = u64::from_le_bytes(
        reserve_data[RESERVE_OFFSET_LIQUIDITY_AVAILABLE
            ..RESERVE_OFFSET_LIQUIDITY_AVAILABLE + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let borrowed_sf = u128::from_le_bytes(
        reserve_data[RESERVE_OFFSET_LIQUIDITY_BORROWED_SF
            ..RESERVE_OFFSET_LIQUIDITY_BORROWED_SF + 16]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let collateral_supply = u64::from_le_bytes(
        reserve_data[RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY
            ..RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );

    if collateral_supply == 0 {
        return Ok(0);
    }

    let borrowed = borrowed_sf >> SF_SCALE_BITS;
    let total_liquidity = (available as u128).saturating_add(borrowed);

    // value = ctoken_amount * total_liquidity / collateral_supply
    let numerator = (ctoken_amount as u128).checked_mul(total_liquidity)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let value = numerator / (collateral_supply as u128);
    if value > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow);
    }
    Ok(value as u64)
}

pub const KAMINO_LEND_PROGRAM_ID: Address = Address::new_from_array([
    4, 178, 172, 177, 18, 88, 204, 227, 104, 44, 65, 139, 168, 114, 255, 61, 249, 17, 2, 113, 47,
    21, 175, 18, 182, 190, 105, 179, 67, 91, 0, 8,
]);
const REFRESH_RESERVE_DISCRIMINATOR: [u8; 8] = [2, 218, 138, 235, 79, 201, 25, 102];
const REFRESH_OBLIGATION_DISCRIMINATOR: [u8; 8] = [33, 132, 147, 228, 151, 192, 72, 89];
const DEPOSIT_RESERVE_LIQUIDITY_AND_OBLIGATION_COLLATERAL_V2_DISCRIMINATOR: [u8; 8] =
    [216, 224, 191, 27, 204, 151, 102, 175];

pub struct Kamino;

pub struct KaminoDepositAccounts<'info> {
    pub kamino_lending_program: &'info AccountView,
    pub owner: &'info AccountView,
    pub obligation: &'info AccountView,
    pub lending_market: &'info AccountView,
    pub lending_market_authority: &'info AccountView,
    pub reserve: &'info AccountView,
    pub reserve_liquidity_mint: &'info AccountView,
    pub reserve_liquidity_supply: &'info AccountView,
    pub reserve_collateral_mint: &'info AccountView,
    pub reserve_destination_deposit_collateral: &'info AccountView,
    pub user_source_liquidity: &'info AccountView,
    pub placeholder_user_destination_collateral: &'info AccountView,
    pub collateral_token_program: &'info AccountView,
    pub liquidity_token_program: &'info AccountView,
    pub instruction_sysvar_account: &'info AccountView,
    pub obligation_farm_user_state: &'info AccountView,
    pub reserve_farm_state: &'info AccountView,
    pub farms_program: &'info AccountView,
    pub scope_oracle: &'info AccountView,
    pub reserve_accounts: &'info [AccountView],
}

impl<'info> TryFrom<&'info [AccountView]> for KaminoDepositAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [kamino_lending_program, owner, obligation, lending_market, lending_market_authority, reserve, reserve_liquidity_mint, reserve_liquidity_supply, reserve_collateral_mint, reserve_destination_deposit_collateral, user_source_liquidity, placeholder_user_destination_collateral, collateral_token_program, liquidity_token_program, instruction_sysvar_account, obligation_farm_user_state, reserve_farm_state, farms_program, scope_oracle, remaining_accounts @ ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        let mut total_reserve_accounts = 0;
        for reserve in remaining_accounts {
            if reserve.owned_by(&KAMINO_LEND_PROGRAM_ID) && total_reserve_accounts < 13 {
                total_reserve_accounts += 1;
            } else {
                break;
            }
        }

        Ok(KaminoDepositAccounts {
            owner,
            obligation,
            lending_market,
            lending_market_authority,
            reserve,
            reserve_liquidity_mint,
            reserve_liquidity_supply,
            reserve_collateral_mint,
            reserve_destination_deposit_collateral,
            user_source_liquidity,
            placeholder_user_destination_collateral,
            collateral_token_program,
            liquidity_token_program,
            instruction_sysvar_account,
            obligation_farm_user_state,
            reserve_farm_state,
            farms_program,
            scope_oracle,
            kamino_lending_program,
            reserve_accounts: &remaining_accounts[..total_reserve_accounts],
        })
    }
}

impl<'info> Deposit<'info> for Kamino {
    type Accounts = KaminoDepositAccounts<'info>;
    type Data = ();

    fn deposit_signed(
        ctx: &KaminoDepositAccounts<'info>,
        amount: u64,
        _data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        // Refresh reserves
        let accounts = [
            InstructionAccount::writable(ctx.reserve.address()),
            InstructionAccount::readonly(ctx.kamino_lending_program.address()),
            InstructionAccount::readonly(ctx.kamino_lending_program.address()),
            InstructionAccount::readonly(ctx.kamino_lending_program.address()),
            InstructionAccount::readonly(ctx.scope_oracle.address()),
        ];

        let account_infos = [
            ctx.reserve,
            ctx.kamino_lending_program,
            ctx.kamino_lending_program,
            ctx.kamino_lending_program,
            ctx.scope_oracle,
        ];

        let instruction = InstructionView {
            program_id: &KAMINO_LEND_PROGRAM_ID,
            accounts: &accounts,
            data: &REFRESH_RESERVE_DISCRIMINATOR,
        };

        invoke_signed(&instruction, &account_infos, signer_seeds)?;

        for reserve in ctx.reserve_accounts {
            let accounts = [
                InstructionAccount::writable(reserve.address()),
                InstructionAccount::readonly(ctx.kamino_lending_program.address()),
                InstructionAccount::readonly(ctx.kamino_lending_program.address()),
                InstructionAccount::readonly(ctx.kamino_lending_program.address()),
                InstructionAccount::readonly(ctx.scope_oracle.address()),
            ];

            let account_infos = [
                reserve,
                ctx.kamino_lending_program,
                ctx.kamino_lending_program,
                ctx.kamino_lending_program,
                ctx.scope_oracle,
            ];

            let instruction = InstructionView {
                program_id: &KAMINO_LEND_PROGRAM_ID,
                accounts: &accounts,
                data: &REFRESH_RESERVE_DISCRIMINATOR,
            };

            invoke_signed(&instruction, &account_infos, signer_seeds)?;
        }

        // Refresh obligation
        const MAX_REFRESH_OBLIGATION_ACCOUNTS: usize = 15;

        let mut obligation_accounts =
            MaybeUninit::<[InstructionAccount; MAX_REFRESH_OBLIGATION_ACCOUNTS]>::uninit();
        let obligation_accounts_ptr = obligation_accounts.as_mut_ptr() as *mut InstructionAccount;

        unsafe {
            core::ptr::write(
                obligation_accounts_ptr,
                InstructionAccount::writable(ctx.obligation.address()),
            );
            core::ptr::write(
                obligation_accounts_ptr.add(1),
                InstructionAccount::readonly(ctx.lending_market.address()),
            );

            for (i, reserve) in ctx.reserve_accounts.iter().enumerate() {
                core::ptr::write(
                    obligation_accounts_ptr.add(2 + i),
                    InstructionAccount::readonly(reserve.address()),
                );
            }
        }

        let obligation_accounts_len = 2 + ctx.reserve_accounts.len();
        let obligation_accounts_slice = unsafe {
            core::slice::from_raw_parts(obligation_accounts_ptr, obligation_accounts_len)
        };

        let mut obligation_account_infos = [ctx.obligation; MAX_REFRESH_OBLIGATION_ACCOUNTS];
        obligation_account_infos[1] = ctx.lending_market;

        for (i, reserve) in ctx.reserve_accounts.iter().enumerate() {
            obligation_account_infos[2 + i] = reserve;
        }

        let instruction = InstructionView {
            program_id: &KAMINO_LEND_PROGRAM_ID,
            accounts: obligation_accounts_slice,
            data: &REFRESH_OBLIGATION_DISCRIMINATOR,
        };

        invoke_signed(&instruction, &obligation_account_infos, signer_seeds)?;

        // Deposit CPI
        let accounts = [
            InstructionAccount::writable_signer(ctx.owner.address()),
            InstructionAccount::writable(ctx.obligation.address()),
            InstructionAccount::readonly(ctx.lending_market.address()),
            InstructionAccount::readonly(ctx.lending_market_authority.address()),
            InstructionAccount::writable(ctx.reserve.address()),
            InstructionAccount::readonly(ctx.reserve_liquidity_mint.address()),
            InstructionAccount::writable(ctx.reserve_liquidity_supply.address()),
            InstructionAccount::writable(ctx.reserve_collateral_mint.address()),
            InstructionAccount::writable(ctx.reserve_destination_deposit_collateral.address()),
            InstructionAccount::writable(ctx.user_source_liquidity.address()),
            InstructionAccount::readonly(ctx.placeholder_user_destination_collateral.address()),
            InstructionAccount::readonly(ctx.collateral_token_program.address()),
            InstructionAccount::readonly(ctx.liquidity_token_program.address()),
            InstructionAccount::readonly(ctx.instruction_sysvar_account.address()),
            InstructionAccount::writable(ctx.obligation_farm_user_state.address()),
            InstructionAccount::writable(ctx.reserve_farm_state.address()),
            InstructionAccount::readonly(ctx.farms_program.address()),
        ];

        let account_infos = [
            ctx.owner,
            ctx.obligation,
            ctx.lending_market,
            ctx.lending_market_authority,
            ctx.reserve,
            ctx.reserve_liquidity_mint,
            ctx.reserve_liquidity_supply,
            ctx.reserve_collateral_mint,
            ctx.reserve_destination_deposit_collateral,
            ctx.user_source_liquidity,
            ctx.placeholder_user_destination_collateral,
            ctx.collateral_token_program,
            ctx.liquidity_token_program,
            ctx.instruction_sysvar_account,
            ctx.obligation_farm_user_state,
            ctx.reserve_farm_state,
            ctx.farms_program,
        ];

        let mut instruction_data = MaybeUninit::<[u8; 16]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;
            core::ptr::copy_nonoverlapping(
                DEPOSIT_RESERVE_LIQUIDITY_AND_OBLIGATION_COLLATERAL_V2_DISCRIMINATOR.as_ptr(),
                ptr,
                8,
            );
            core::ptr::copy_nonoverlapping(amount.to_le_bytes().as_ptr(), ptr.add(8), 8);
        }

        let deposit_ix = InstructionView {
            program_id: &KAMINO_LEND_PROGRAM_ID,
            accounts: &accounts,
            data: unsafe {
                core::slice::from_raw_parts(instruction_data.as_ptr() as *const u8, 16)
            },
        };

        invoke_signed(&deposit_ix, &account_infos, signer_seeds)?;

        Ok(())
    }

    fn deposit(
        ctx: &KaminoDepositAccounts<'info>,
        amount: u64,
        data: &Self::Data,
    ) -> ProgramResult {
        Self::deposit_signed(ctx, amount, data, &[])
    }
}

// ─── DepositInit: init_user_metadata + init_obligation ─────────────────────
//
// Scaffold. Lets a wrapping program (e.g. strategy-token) create the
// Kamino UserMetadata + Obligation PDAs owned by its wallet PDA, so the
// subsequent Deposit CPI has valid per-user state to land into.
//
// CPI data for both ixs is stubbed — the CLI-side resolver (analogue of
// kamino-test-deposit.mjs) will produce the verified bytes, then this
// impl gets filled in alongside a pinocchio dispatch entry in strategy-token.

use beethoven_core::DepositInit;

/// Anchor disc for `init_user_metadata`. From klend-sdk codegen
/// (@kamino-finance/klend-sdk v7.3.22 initUserMetadata.js).
pub const INIT_USER_METADATA_DISCRIMINATOR: [u8; 8] = [117, 169, 176, 69, 197, 23, 15, 162];

/// Anchor disc for `init_obligation`. From klend-sdk codegen.
pub const INIT_OBLIGATION_DISCRIMINATOR: [u8; 8] = [251, 10, 231, 76, 27, 11, 159, 96];

pub struct KaminoInitAccounts<'info> {
    pub kamino_lending_program: &'info AccountView,
    pub owner: &'info AccountView,
    pub fee_payer: &'info AccountView,
    pub user_metadata: &'info AccountView,
    pub referrer_user_metadata: &'info AccountView,
    pub lending_market: &'info AccountView,
    pub obligation: &'info AccountView,
    pub seed1_account: &'info AccountView,
    pub seed2_account: &'info AccountView,
    pub rent: &'info AccountView,
    pub system_program: &'info AccountView,
}

impl<'info> TryFrom<&'info [AccountView]> for KaminoInitAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [kamino_lending_program, owner, fee_payer, user_metadata, referrer_user_metadata, lending_market, obligation, seed1_account, seed2_account, rent, system_program] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        Ok(KaminoInitAccounts {
            kamino_lending_program,
            owner,
            fee_payer,
            user_metadata,
            referrer_user_metadata,
            lending_market,
            obligation,
            seed1_account,
            seed2_account,
            rent,
            system_program,
        })
    }
}

impl<'info> DepositInit<'info> for Kamino {
    type Accounts = KaminoInitAccounts<'info>;

    fn init_signed(ctx: &Self::Accounts, signer_seeds: &[Signer]) -> ProgramResult {
        // ─── 1. init_user_metadata ──────────────────────────────────────
        // Account roles (from klend-sdk initUserMetadata.js):
        //   owner                   role=2  readonly signer
        //   fee_payer               role=3  writable signer
        //   user_metadata           role=1  writable
        //   referrer_user_metadata  role=0  readonly  (or program placeholder)
        //   rent                    role=0  readonly
        //   system_program          role=0  readonly
        let accounts_um = [
            InstructionAccount::readonly_signer(ctx.owner.address()),
            InstructionAccount::writable_signer(ctx.fee_payer.address()),
            InstructionAccount::writable(ctx.user_metadata.address()),
            InstructionAccount::readonly(ctx.referrer_user_metadata.address()),
            InstructionAccount::readonly(ctx.rent.address()),
            InstructionAccount::readonly(ctx.system_program.address()),
        ];
        let infos_um = [
            ctx.owner,
            ctx.fee_payer,
            ctx.user_metadata,
            ctx.referrer_user_metadata,
            ctx.rent,
            ctx.system_program,
        ];

        // Data: disc(8) + user_lookup_table: Pubkey (32).
        // We pass default pubkey (0u8 * 32) — no address-lookup-table.
        let mut data_um = [0u8; 40];
        data_um[..8].copy_from_slice(&INIT_USER_METADATA_DISCRIMINATOR);

        let ix_um = InstructionView {
            program_id: &KAMINO_LEND_PROGRAM_ID,
            accounts: &accounts_um,
            data: &data_um,
        };
        invoke_signed(&ix_um, &infos_um, signer_seeds)?;

        // ─── 2. init_obligation ─────────────────────────────────────────
        // Account roles (from klend-sdk initObligation.js):
        //   obligation_owner        role=2  readonly signer
        //   fee_payer               role=3  writable signer
        //   obligation              role=1  writable
        //   lending_market          role=0  readonly
        //   seed1_account           role=0  readonly
        //   seed2_account           role=0  readonly
        //   owner_user_metadata     role=0  readonly
        //   rent                    role=0  readonly
        //   system_program          role=0  readonly
        let accounts_obl = [
            InstructionAccount::readonly_signer(ctx.owner.address()),
            InstructionAccount::writable_signer(ctx.fee_payer.address()),
            InstructionAccount::writable(ctx.obligation.address()),
            InstructionAccount::readonly(ctx.lending_market.address()),
            InstructionAccount::readonly(ctx.seed1_account.address()),
            InstructionAccount::readonly(ctx.seed2_account.address()),
            InstructionAccount::readonly(ctx.user_metadata.address()),
            InstructionAccount::readonly(ctx.rent.address()),
            InstructionAccount::readonly(ctx.system_program.address()),
        ];
        let infos_obl = [
            ctx.owner,
            ctx.fee_payer,
            ctx.obligation,
            ctx.lending_market,
            ctx.seed1_account,
            ctx.seed2_account,
            ctx.user_metadata,
            ctx.rent,
            ctx.system_program,
        ];

        // Data: disc(8) + InitObligationArgs { tag: u8, id: u8 }.
        // tag=0 (Vanilla), id=0 — matches VanillaObligation in klend-sdk.
        let mut data_obl = [0u8; 10];
        data_obl[..8].copy_from_slice(&INIT_OBLIGATION_DISCRIMINATOR);
        // data_obl[8] = 0 (tag), data_obl[9] = 0 (id) — already zeroed

        let ix_obl = InstructionView {
            program_id: &KAMINO_LEND_PROGRAM_ID,
            accounts: &accounts_obl,
            data: &data_obl,
        };
        invoke_signed(&ix_obl, &infos_obl, signer_seeds)?;

        Ok(())
    }

    fn init(ctx: &Self::Accounts) -> ProgramResult {
        Self::init_signed(ctx, &[])
    }
}
