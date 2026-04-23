#![no_std]

//! Zeta Markets perps resolver for Beethoven.
//!
//! Targets `place_perp_order_v3` — Zeta's current cross-margin perp entry.
//!
//! Account layout + arg encoding ported verbatim from the Zeta SDK IDL
//! shipped with `@zetamarkets/sdk` v1.64.x (`dist/idl/zeta.json`,
//! instruction `placePerpOrderV3`). Devnet program ID
//! `BG3oRikW8d16YjUEmX3ZxHm9SiJzrGtMhsSR8aCw1Cd7` is the same byte image
//! as mainnet for our purposes.
//!
//! ── Account list (25 total, IDL-derived) ──────────────────────────────
//! Anchor's IDL nests the 10 Serum-style market accounts under a
//! `marketAccounts` composite struct; on the wire they're flat — we pass
//! all 25 in the order they appear in the IDL:
//!
//!   0  state                    readonly
//!   1  pricing                  readonly
//!   2  margin_account           writable
//!   3  authority                readonly + signer
//!   4  dex_program              readonly  (Zeta's serum-v3 DEX)
//!   5  token_program            readonly
//!   6  serum_authority          readonly  (PDA owning the DEX-side state)
//!   7  open_orders              writable
//!   8  rent                     readonly
//!   ── nested marketAccounts ──
//!   9  market                   writable
//!   10 request_queue            writable
//!   11 event_queue              writable
//!   12 bids                     writable
//!   13 asks                     writable
//!   14 order_payer_token_account writable
//!   15 coin_vault               writable
//!   16 pc_vault                 writable
//!   17 coin_wallet              writable
//!   18 pc_wallet                writable
//!   ── trailing ──
//!   19 oracle                   readonly  (Pyth)
//!   20 oracle_backup_feed       readonly
//!   21 oracle_backup_program    readonly
//!   22 market_mint              writable
//!   23 mint_authority           readonly
//!   24 perp_sync_queue          writable
//!
//! ── Enum encodings (Anchor u8-by-index, from IDL) ─────────────────────
//! Side:      0 = Uninitialized, 1 = Bid, 2 = Ask
//! OrderType: 0 = Limit, 1 = PostOnly, 2 = FillOrKill,
//!            3 = ImmediateOrCancel (IOC), 4 = PostOnlySlide,
//!            5 = PostOnlyFront
//! Asset:     0 = SOL, 1 = BTC, 2 = ETH, … (variant index from IDL).
//!
//! NOTE: the prompt suggested 0=Bid/1=Ask. The IDL lists Uninitialized
//! as variant 0, so on the wire Bid = 1, Ask = 2. We follow the IDL.

use {
    beethoven_core::Perps,
    core::mem::MaybeUninit,
    solana_account_view::AccountView,
    solana_address::Address,
    solana_instruction_view::{
        cpi::{invoke_signed, Signer},
        InstructionAccount, InstructionView,
    },
    solana_program_error::{ProgramError, ProgramResult},
};

/// Zeta program ID (devnet + mainnet share this address).
/// `BG3oRikW8d16YjUEmX3ZxHm9SiJzrGtMhsSR8aCw1Cd7`
pub const ZETA_PROGRAM_ID: Address = Address::new_from_array([
    0x98, 0x6f, 0xbf, 0x75, 0x1a, 0x1f, 0xf8, 0xd1, 0x4d, 0xb1, 0xd0, 0x20, 0x59, 0x85, 0xfb, 0xaf,
    0x27, 0x88, 0x5c, 0x5e, 0xee, 0xdc, 0xd6, 0xfe, 0x01, 0x7b, 0xb8, 0x1c, 0x04, 0xb2, 0xa9, 0xba,
]);

/// Anchor disc for `place_perp_order_v3`. sha256("global:place_perp_order_v3")[..8].
/// Verified: 5b f6 60 07 35 16 ea e1.
pub const PLACE_PERP_ORDER_V3_DISCRIMINATOR: [u8; 8] =
    [0x5b, 0xf6, 0x60, 0x07, 0x35, 0x16, 0xea, 0xe1];

/// Side enum (IDL u8-by-index).
pub const SIDE_BID: u8 = 1;
pub const SIDE_ASK: u8 = 2;

/// OrderType enum (IDL u8-by-index).
pub const ORDER_TYPE_LIMIT: u8 = 0;
pub const ORDER_TYPE_POST_ONLY: u8 = 1;
pub const ORDER_TYPE_FILL_OR_KILL: u8 = 2;
pub const ORDER_TYPE_IOC: u8 = 3;
pub const ORDER_TYPE_POST_ONLY_SLIDE: u8 = 4;

/// Total fixed CPI accounts: see module docs (25).
const FIXED_CPI_ACCOUNTS: usize = 25;

/// Max bytes the Borsh-serialised arg list can occupy (after the 8-byte
/// disc). Layout:
///   8  disc
///   8  price (u64)
///   8  size  (u64)
///   1  side  (u8)
///   1  order_type (u8)
///   1+8 client_order_id Option<u64>
///   1   tag Option<String>          (always None → single 0x00)
///   1+2 tif_offset Option<u16>
///   1   asset (u8)
/// = 8 + 8 + 8 + 1 + 1 + 9 + 1 + 3 + 1 = 40 bytes.
const PLACE_PERP_ORDER_V3_MAX_DATA_LEN: usize = 40;

pub struct Zeta;

/// Accounts for Zeta `place_perp_order_v3`.
///
/// Beethoven's standard layout: [0] is the program-id detector and is
/// stripped before the CPI; the next 25 map to the IDL's account list
/// (with the nested `marketAccounts` group flattened). No trailing
/// remaining-accounts slice — Zeta's cross-margin health check is
/// inlined via `pricing` + `margin_account` + `oracle*` and doesn't
/// require per-asset banks the way Mango does.
pub struct ZetaPlacePerpOrderAccounts<'info> {
    pub zeta_program: &'info AccountView,
    pub state: &'info AccountView,
    pub pricing: &'info AccountView,
    pub margin_account: &'info AccountView,
    pub authority: &'info AccountView,
    pub dex_program: &'info AccountView,
    pub token_program: &'info AccountView,
    pub serum_authority: &'info AccountView,
    pub open_orders: &'info AccountView,
    pub rent: &'info AccountView,
    pub market: &'info AccountView,
    pub request_queue: &'info AccountView,
    pub event_queue: &'info AccountView,
    pub bids: &'info AccountView,
    pub asks: &'info AccountView,
    pub order_payer_token_account: &'info AccountView,
    pub coin_vault: &'info AccountView,
    pub pc_vault: &'info AccountView,
    pub coin_wallet: &'info AccountView,
    pub pc_wallet: &'info AccountView,
    pub oracle: &'info AccountView,
    pub oracle_backup_feed: &'info AccountView,
    pub oracle_backup_program: &'info AccountView,
    pub market_mint: &'info AccountView,
    pub mint_authority: &'info AccountView,
    pub perp_sync_queue: &'info AccountView,
}

impl<'info> TryFrom<&'info [AccountView]> for ZetaPlacePerpOrderAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [zeta_program, state, pricing, margin_account, authority, dex_program, token_program, serum_authority, open_orders, rent, market, request_queue, event_queue, bids, asks, order_payer_token_account, coin_vault, pc_vault, coin_wallet, pc_wallet, oracle, oracle_backup_feed, oracle_backup_program, market_mint, mint_authority, perp_sync_queue] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        Ok(ZetaPlacePerpOrderAccounts {
            zeta_program,
            state,
            pricing,
            margin_account,
            authority,
            dex_program,
            token_program,
            serum_authority,
            open_orders,
            rent,
            market,
            request_queue,
            event_queue,
            bids,
            asks,
            order_payer_token_account,
            coin_vault,
            pc_vault,
            coin_wallet,
            pc_wallet,
            oracle,
            oracle_backup_feed,
            oracle_backup_program,
            market_mint,
            mint_authority,
            perp_sync_queue,
        })
    }
}

/// Args for `place_perp_order_v3`. Field order matches the IDL.
///
/// `tag` is always serialised as `None` (single 0x00 byte). Clients
/// rarely set it — it's a free-form string for off-chain analytics —
/// and supporting `String` in `no_std` would force an alloc dep.
pub struct ZetaPlacePerpOrderData {
    /// Limit price in Zeta-native fixed-point (6 decimals).
    pub price: u64,
    /// Order size in lots (asset-specific).
    pub size: u64,
    /// 1 = Bid (long), 2 = Ask (short). See `SIDE_*` constants.
    pub side: u8,
    /// 0=Limit, 1=PostOnly, 2=FillOrKill, 3=IOC, 4=PostOnlySlide.
    /// See `ORDER_TYPE_*` constants.
    pub order_type: u8,
    /// Optional client-assigned order id (for cancel/replace flows).
    pub client_order_id: Option<u64>,
    /// Optional time-in-force offset in seconds from now.
    pub tif_offset: Option<u16>,
    /// Perp asset variant index — see Asset enum in IDL
    /// (0=SOL, 1=BTC, 2=ETH, …).
    pub asset: u8,
}

impl<'info> Perps<'info> for Zeta {
    type Accounts = ZetaPlacePerpOrderAccounts<'info>;
    type Data = ZetaPlacePerpOrderData;

    fn place_order_signed(
        ctx: &Self::Accounts,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        // ── Build the CPI account list ────────────────────────────────────
        const N: usize = FIXED_CPI_ACCOUNTS;
        let mut accounts_buf = MaybeUninit::<[InstructionAccount; N]>::uninit();
        let accounts_ptr = accounts_buf.as_mut_ptr() as *mut InstructionAccount;
        unsafe {
            core::ptr::write(
                accounts_ptr.add(0),
                InstructionAccount::readonly(ctx.state.address()),
            );
            core::ptr::write(
                accounts_ptr.add(1),
                InstructionAccount::readonly(ctx.pricing.address()),
            );
            core::ptr::write(
                accounts_ptr.add(2),
                InstructionAccount::writable(ctx.margin_account.address()),
            );
            core::ptr::write(
                accounts_ptr.add(3),
                InstructionAccount::readonly_signer(ctx.authority.address()),
            );
            core::ptr::write(
                accounts_ptr.add(4),
                InstructionAccount::readonly(ctx.dex_program.address()),
            );
            core::ptr::write(
                accounts_ptr.add(5),
                InstructionAccount::readonly(ctx.token_program.address()),
            );
            core::ptr::write(
                accounts_ptr.add(6),
                InstructionAccount::readonly(ctx.serum_authority.address()),
            );
            core::ptr::write(
                accounts_ptr.add(7),
                InstructionAccount::writable(ctx.open_orders.address()),
            );
            core::ptr::write(
                accounts_ptr.add(8),
                InstructionAccount::readonly(ctx.rent.address()),
            );
            // nested marketAccounts (flattened)
            core::ptr::write(
                accounts_ptr.add(9),
                InstructionAccount::writable(ctx.market.address()),
            );
            core::ptr::write(
                accounts_ptr.add(10),
                InstructionAccount::writable(ctx.request_queue.address()),
            );
            core::ptr::write(
                accounts_ptr.add(11),
                InstructionAccount::writable(ctx.event_queue.address()),
            );
            core::ptr::write(
                accounts_ptr.add(12),
                InstructionAccount::writable(ctx.bids.address()),
            );
            core::ptr::write(
                accounts_ptr.add(13),
                InstructionAccount::writable(ctx.asks.address()),
            );
            core::ptr::write(
                accounts_ptr.add(14),
                InstructionAccount::writable(ctx.order_payer_token_account.address()),
            );
            core::ptr::write(
                accounts_ptr.add(15),
                InstructionAccount::writable(ctx.coin_vault.address()),
            );
            core::ptr::write(
                accounts_ptr.add(16),
                InstructionAccount::writable(ctx.pc_vault.address()),
            );
            core::ptr::write(
                accounts_ptr.add(17),
                InstructionAccount::writable(ctx.coin_wallet.address()),
            );
            core::ptr::write(
                accounts_ptr.add(18),
                InstructionAccount::writable(ctx.pc_wallet.address()),
            );
            // trailing
            core::ptr::write(
                accounts_ptr.add(19),
                InstructionAccount::readonly(ctx.oracle.address()),
            );
            core::ptr::write(
                accounts_ptr.add(20),
                InstructionAccount::readonly(ctx.oracle_backup_feed.address()),
            );
            core::ptr::write(
                accounts_ptr.add(21),
                InstructionAccount::readonly(ctx.oracle_backup_program.address()),
            );
            core::ptr::write(
                accounts_ptr.add(22),
                InstructionAccount::writable(ctx.market_mint.address()),
            );
            core::ptr::write(
                accounts_ptr.add(23),
                InstructionAccount::readonly(ctx.mint_authority.address()),
            );
            core::ptr::write(
                accounts_ptr.add(24),
                InstructionAccount::writable(ctx.perp_sync_queue.address()),
            );
        }
        let accounts_slice = unsafe {
            core::slice::from_raw_parts(accounts_ptr as *const InstructionAccount, N)
        };

        // ── account_infos (parallel array of AccountView refs) ───────────
        let infos_buf: [&AccountView; N] = [
            ctx.state,
            ctx.pricing,
            ctx.margin_account,
            ctx.authority,
            ctx.dex_program,
            ctx.token_program,
            ctx.serum_authority,
            ctx.open_orders,
            ctx.rent,
            ctx.market,
            ctx.request_queue,
            ctx.event_queue,
            ctx.bids,
            ctx.asks,
            ctx.order_payer_token_account,
            ctx.coin_vault,
            ctx.pc_vault,
            ctx.coin_wallet,
            ctx.pc_wallet,
            ctx.oracle,
            ctx.oracle_backup_feed,
            ctx.oracle_backup_program,
            ctx.market_mint,
            ctx.mint_authority,
            ctx.perp_sync_queue,
        ];

        // ── Build ix data (Borsh) ────────────────────────────────────────
        // Max 40 bytes; actual length tracked by `cursor`.
        let mut data_buf = [0u8; PLACE_PERP_ORDER_V3_MAX_DATA_LEN];
        let mut cursor = 0usize;

        data_buf[cursor..cursor + 8].copy_from_slice(&PLACE_PERP_ORDER_V3_DISCRIMINATOR);
        cursor += 8;
        data_buf[cursor..cursor + 8].copy_from_slice(&data.price.to_le_bytes());
        cursor += 8;
        data_buf[cursor..cursor + 8].copy_from_slice(&data.size.to_le_bytes());
        cursor += 8;
        data_buf[cursor] = data.side;
        cursor += 1;
        data_buf[cursor] = data.order_type;
        cursor += 1;
        // Option<u64> client_order_id: 0x00 = None, 0x01 + 8-byte LE = Some
        match data.client_order_id {
            None => {
                data_buf[cursor] = 0;
                cursor += 1;
            }
            Some(id) => {
                data_buf[cursor] = 1;
                cursor += 1;
                data_buf[cursor..cursor + 8].copy_from_slice(&id.to_le_bytes());
                cursor += 8;
            }
        }
        // Option<String> tag: always None.
        data_buf[cursor] = 0;
        cursor += 1;
        // Option<u16> tif_offset: 0x00 = None, 0x01 + 2-byte LE = Some
        match data.tif_offset {
            None => {
                data_buf[cursor] = 0;
                cursor += 1;
            }
            Some(off) => {
                data_buf[cursor] = 1;
                cursor += 1;
                data_buf[cursor..cursor + 2].copy_from_slice(&off.to_le_bytes());
                cursor += 2;
            }
        }
        // Asset (u8 enum index)
        data_buf[cursor] = data.asset;
        cursor += 1;

        let ix = InstructionView {
            program_id: &ZETA_PROGRAM_ID,
            accounts: accounts_slice,
            data: &data_buf[..cursor],
        };

        invoke_signed(&ix, &infos_buf, signer_seeds)
    }

    fn place_order(ctx: &Self::Accounts, data: &Self::Data) -> ProgramResult {
        Self::place_order_signed(ctx, data, &[])
    }
}
