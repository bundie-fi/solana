//! Anchor v0.30 legacy IDL upload protocol.
//!
//! Implements just enough of the Anchor `__idl_dispatch` flow so legacy
//! `anchor-cli` (0.30.x) can `anchor idl init` / `anchor idl upgrade` against
//! this Pinocchio program and write the IDL to the canonical PDA at
//! `createWithSeed(findProgramAddress([], program_id).0, "anchor:idl", program_id)`.
//!
//! Source of truth:
//! https://github.com/coral-xyz/anchor/blob/v0.30.1/lang/syn/src/codegen/program/idl.rs
//! https://github.com/coral-xyz/anchor/blob/v0.30.1/lang/src/idl.rs
//!
//! Wire layout once the 8-byte `IDL_IX_TAG_LE` prefix has been stripped:
//!
//! ```text
//! [0]      sub-discriminator (1 byte, Borsh enum tag)
//! [1..]    Borsh-encoded args
//! ```
//!
//! Sub-discriminators implemented here:
//! * 0 — `Create { data_len: u64 }`
//! * 2 — `Write  { data: Vec<u8> }`
//! * 3 — `SetAuthority { new_authority: Pubkey }`
//!
//! The other variants (`CreateBuffer`, `SetBuffer`, `Close`, `Resize`) are not
//! needed for the initial IDL upload and are intentionally rejected.
//!
//! IDL account layout (matches Anchor's `IdlAccount` with `#[account("internal")]`):
//!
//! ```text
//! [0..8]    account discriminator: sha256("internal:IdlAccount")[..8]
//! [8..40]   authority: Pubkey
//! [40..44]  data_len: u32   (Borsh Vec<u8> length prefix)
//! [44..]    raw IDL bytes (gzipped JSON)
//! ```

use core::mem::MaybeUninit;

use pinocchio::{
    account::AccountView,
    address::Address,
    cpi::{invoke_signed, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{rent::Rent, Sysvar},
    ProgramResult,
};

use crate::{cpi::system::SYSTEM_PROGRAM_ID, util};

/// Anchor's `#[account("internal")]` discriminator for `IdlAccount`,
/// i.e. `sha256("internal:IdlAccount")[..8]`.
const IDL_ACCOUNT_DISC: [u8; 8] = [24, 70, 98, 191, 58, 144, 123, 158];

/// Fixed seed string for the canonical IDL PDA.
const IDL_SEED: &str = "anchor:idl";

/// Fixed header size: 8 (disc) + 32 (authority) + 4 (vec len) = 44.
const IDL_HEADER_LEN: usize = 8 + 32 + 4;

/// Sub-discriminator: `Create { data_len: u64 }`.
const SUB_CREATE: u8 = 0;
/// Sub-discriminator: `Write { data: Vec<u8> }`.
const SUB_WRITE: u8 = 2;
/// Sub-discriminator: `SetAuthority { new_authority: Pubkey }`.
const SUB_SET_AUTHORITY: u8 = 3;

/// Entry point invoked from `lib.rs` once the 8-byte `IDL_IX_TAG_LE` has
/// already been stripped.
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let (sub_disc, args) = data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match *sub_disc {
        SUB_CREATE => idl_create(program_id, accounts, args),
        SUB_WRITE => idl_write(program_id, accounts, args),
        SUB_SET_AUTHORITY => idl_set_authority(program_id, accounts, args),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// ---------------------------------------------------------------------------
// 0. IdlCreate { data_len: u64 }
// ---------------------------------------------------------------------------
//
// Accounts (as defined by `IdlCreateAccounts` in v0.30.1):
//   [0] from           — payer + future authority (signer, writable)
//   [1] to             — canonical IDL PDA (writable)
//   [2] base           — `findProgramAddress([], program_id).0` (read)
//   [3] system_program — read
//   [4] program        — this program (read, executable)
fn idl_create(program_id: &Address, accounts: &[AccountView], args: &[u8]) -> ProgramResult {
    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if args.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let data_len = u64::from_le_bytes(args[0..8].try_into().unwrap()) as usize;

    let from = &accounts[0];
    let to = &accounts[1];
    let base = &accounts[2];
    let system_program = &accounts[3];
    let program = &accounts[4];

    util::assert_signer(from)?;
    util::assert_writable(from)?;
    util::assert_writable(to)?;
    util::assert_keys_equal(system_program.address(), &SYSTEM_PROGRAM_ID)?;
    util::assert_keys_equal(program.address(), program_id)?;

    // Re-derive `base` so we can supply the bump for invoke_signed.
    let (expected_base, base_bump) = Address::find_program_address(&[], program_id);
    util::assert_keys_equal(base.address(), &expected_base)?;

    // Derive the canonical IDL PDA: createWithSeed(base, "anchor:idl", program_id).
    let expected_to = Address::create_with_seed(&expected_base, IDL_SEED, program_id)
        .map_err(|_| ProgramError::InvalidSeeds)?;
    util::assert_keys_equal(to.address(), &expected_to)?;

    // Anchor caps the initial allocation at 10_000 (further growth via Resize).
    // space = 8 (disc) + 32 (authority) + 4 (vec len) + data_len, capped at 10_000.
    let space: usize = core::cmp::min(IDL_HEADER_LEN + data_len, 10_000);

    // Compute rent for `space` bytes via the Rent sysvar.
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance_unchecked(space);

    // -------------------------------------------------------------------
    // CPI: SystemInstruction::CreateAccountWithSeed (discriminator = 3)
    //
    // Layout:
    //   u32   discriminator (3)
    //   [u8;32] base
    //   u64   seed_len
    //   [u8]  seed bytes (utf-8)
    //   u64   lamports
    //   u64   space
    //   [u8;32] owner
    // -------------------------------------------------------------------
    let seed_bytes = IDL_SEED.as_bytes();
    let ix_data_len = 4 + 32 + 8 + seed_bytes.len() + 8 + 8 + 32;
    // "anchor:idl" → 4+32+8+10+8+8+32 = 102 bytes. Reserve 128 to be safe.
    let mut ix_data = [0u8; 128];
    ix_data[0..4].copy_from_slice(&3u32.to_le_bytes());
    ix_data[4..36].copy_from_slice(expected_base.as_ref());
    ix_data[36..44].copy_from_slice(&(seed_bytes.len() as u64).to_le_bytes());
    let after_seed = 44 + seed_bytes.len();
    ix_data[44..after_seed].copy_from_slice(seed_bytes);
    ix_data[after_seed..after_seed + 8].copy_from_slice(&(lamports).to_le_bytes());
    ix_data[after_seed + 8..after_seed + 16].copy_from_slice(&(space as u64).to_le_bytes());
    ix_data[after_seed + 16..after_seed + 48].copy_from_slice(program_id.as_ref());

    // CreateAccountWithSeed accounts: from (signer+writable), to (writable),
    // base (signer when base != from). Here base != from, so include base as
    // a third entry that we'll sign for via the empty-seed PDA.
    let ix_accounts = [
        InstructionAccount::writable_signer(from.address()),
        InstructionAccount::writable(to.address()),
        InstructionAccount::readonly_signer(base.address()),
    ];

    let instruction = InstructionView {
        program_id: &SYSTEM_PROGRAM_ID,
        accounts: &ix_accounts,
        data: &ix_data[..ix_data_len],
    };

    // Build the empty-seed PDA signer for `base`. Seeds = [bump_byte].
    let bump_arr = [base_bump];
    // SAFETY: we initialize exactly 1 entry below before constructing the slice.
    let mut seed_buf: [MaybeUninit<Seed<'_>>; 1] = [MaybeUninit::uninit()];
    seed_buf[0].write(Seed::from(&bump_arr[..]));
    let seed_slice =
        unsafe { core::slice::from_raw_parts(seed_buf.as_ptr() as *const Seed<'_>, 1) };
    let signer = Signer::from(seed_slice);

    invoke_signed::<3>(&instruction, &[from, to, base], &[signer])?;

    // -------------------------------------------------------------------
    // Initialize header: account discriminator + authority + zero data_len.
    // The IDL data itself is written later via IdlWrite.
    // -------------------------------------------------------------------
    let to_data = unsafe { to.borrow_unchecked_mut() };
    if to_data.len() < IDL_HEADER_LEN {
        return Err(ProgramError::AccountDataTooSmall);
    }
    to_data[0..8].copy_from_slice(&IDL_ACCOUNT_DISC);
    to_data[8..40].copy_from_slice(from.address().as_ref());
    to_data[40..44].copy_from_slice(&0u32.to_le_bytes());

    Ok(())
}

// ---------------------------------------------------------------------------
// 2. IdlWrite { data: Vec<u8> }
// ---------------------------------------------------------------------------
//
// Accounts (`IdlAccounts`):
//   [0] idl       — canonical IDL PDA (writable)
//   [1] authority — signer matching `idl.authority`
fn idl_write(_program_id: &Address, accounts: &[AccountView], args: &[u8]) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    // Borsh `Vec<u8>` = 4-byte u32 length prefix + bytes.
    if args.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let payload_len = u32::from_le_bytes(args[0..4].try_into().unwrap()) as usize;
    if args.len() < 4 + payload_len {
        return Err(ProgramError::InvalidInstructionData);
    }
    let payload = &args[4..4 + payload_len];

    let idl = &accounts[0];
    let authority = &accounts[1];

    util::assert_writable(idl)?;
    util::assert_signer(authority)?;

    let acc_data = unsafe { idl.borrow_unchecked_mut() };
    if acc_data.len() < IDL_HEADER_LEN {
        return Err(ProgramError::AccountDataTooSmall);
    }
    // Verify discriminator + authority.
    if acc_data[0..8] != IDL_ACCOUNT_DISC {
        return Err(ProgramError::InvalidAccountData);
    }
    if &acc_data[8..40] != authority.address().as_ref() {
        return Err(ProgramError::IllegalOwner);
    }

    let prev_len = u32::from_le_bytes(acc_data[40..44].try_into().unwrap()) as usize;
    let new_len = prev_len
        .checked_add(payload_len)
        .ok_or(ProgramError::InvalidInstructionData)?;

    let trailing_end = IDL_HEADER_LEN
        .checked_add(new_len)
        .ok_or(ProgramError::InvalidInstructionData)?;
    if acc_data.len() < trailing_end {
        return Err(ProgramError::AccountDataTooSmall);
    }

    let dst_start = IDL_HEADER_LEN + prev_len;
    acc_data[dst_start..dst_start + payload_len].copy_from_slice(payload);
    acc_data[40..44].copy_from_slice(&(new_len as u32).to_le_bytes());

    Ok(())
}

// ---------------------------------------------------------------------------
// 3. IdlSetAuthority { new_authority: Pubkey }
// ---------------------------------------------------------------------------
//
// Accounts (`IdlAccounts`):
//   [0] idl       — canonical IDL PDA (writable)
//   [1] authority — current authority (signer)
fn idl_set_authority(
    _program_id: &Address,
    accounts: &[AccountView],
    args: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if args.len() < 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let new_authority: &[u8; 32] = args[0..32]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let idl = &accounts[0];
    let authority = &accounts[1];

    util::assert_writable(idl)?;
    util::assert_signer(authority)?;

    let acc_data = unsafe { idl.borrow_unchecked_mut() };
    if acc_data.len() < IDL_HEADER_LEN {
        return Err(ProgramError::AccountDataTooSmall);
    }
    if acc_data[0..8] != IDL_ACCOUNT_DISC {
        return Err(ProgramError::InvalidAccountData);
    }
    if &acc_data[8..40] != authority.address().as_ref() {
        return Err(ProgramError::IllegalOwner);
    }

    acc_data[8..40].copy_from_slice(new_authority);

    Ok(())
}
