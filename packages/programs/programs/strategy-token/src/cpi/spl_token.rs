use core::mem::MaybeUninit;

use pinocchio::{
    account::AccountView,
    address::Address,
    cpi::{invoke, invoke_signed, Seed, Signer},
    instruction::{InstructionAccount, InstructionView},
    ProgramResult,
};

/// SPL Token Program ID
pub const TOKEN_PROGRAM_ID: Address = Address::new_from_array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237,
    95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]);

/// Build seeds into a `MaybeUninit` array. Supports up to 16 seed components.
#[inline(always)]
fn build_signer<'a>(signer_seeds: &[&'a [u8]]) -> ([MaybeUninit<Seed<'a>>; 16], usize) {
    let mut buf: [MaybeUninit<Seed<'a>>; 16] = [
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
    ];
    let len = signer_seeds.len().min(16);
    for i in 0..len {
        buf[i].write(Seed::from(signer_seeds[i]));
    }
    (buf, len)
}

/// InitializeMint2 — token instruction index 20.
///
/// Accounts: mint (writable).
pub fn init_mint2<'a>(
    mint: &'a AccountView,
    decimals: u8,
    mint_authority: &Address,
    freeze_authority: Option<&Address>,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    // Data: 1 (ix) + 1 (decimals) + 32 (authority) + 1 (has_freeze) + 32 (freeze) = 67
    let mut data = [0u8; 67];
    data[0] = 20; // InitializeMint2
    data[1] = decimals;
    data[2..34].copy_from_slice(mint_authority.as_ref());
    match freeze_authority {
        Some(fa) => {
            data[34] = 1;
            data[35..67].copy_from_slice(fa.as_ref());
        }
        None => {
            data[34] = 0;
        }
    }

    let accounts = [InstructionAccount::writable(mint.address())];

    let instruction = InstructionView {
        program_id: &TOKEN_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    if signer_seeds.is_empty() {
        invoke::<1>(&instruction, &[mint])
    } else {
        let (buf, len) = build_signer(signer_seeds);
        let seeds = unsafe { core::slice::from_raw_parts(buf.as_ptr() as *const Seed<'_>, len) };
        let signer = Signer::from(seeds);
        invoke_signed::<1>(&instruction, &[mint], &[signer])
    }
}

/// MintTo — token instruction index 7.
///
/// Accounts: mint (writable), destination (writable), mint_authority (signer).
pub fn mint_to<'a>(
    mint: &'a AccountView,
    destination: &'a AccountView,
    mint_authority: &'a AccountView,
    amount: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let mut data = [0u8; 9];
    data[0] = 7; // MintTo
    data[1..9].copy_from_slice(&amount.to_le_bytes());

    let accounts = [
        InstructionAccount::writable(mint.address()),
        InstructionAccount::writable(destination.address()),
        InstructionAccount::readonly_signer(mint_authority.address()),
    ];

    let instruction = InstructionView {
        program_id: &TOKEN_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    if signer_seeds.is_empty() {
        invoke::<3>(&instruction, &[mint, destination, mint_authority])
    } else {
        let (buf, len) = build_signer(signer_seeds);
        let seeds = unsafe { core::slice::from_raw_parts(buf.as_ptr() as *const Seed<'_>, len) };
        let signer = Signer::from(seeds);
        invoke_signed::<3>(
            &instruction,
            &[mint, destination, mint_authority],
            &[signer],
        )
    }
}

/// Burn — token instruction index 8.
///
/// The authority (redeemer) is a wallet signer — uses `invoke`, not `invoke_signed`.
/// Accounts: source (writable), mint (writable), authority (signer).
pub fn burn<'a>(
    source: &'a AccountView,
    mint: &'a AccountView,
    authority: &'a AccountView,
    amount: u64,
) -> ProgramResult {
    let mut data = [0u8; 9];
    data[0] = 8; // Burn
    data[1..9].copy_from_slice(&amount.to_le_bytes());

    let accounts = [
        InstructionAccount::writable(source.address()),
        InstructionAccount::writable(mint.address()),
        InstructionAccount::readonly_signer(authority.address()),
    ];

    let instruction = InstructionView {
        program_id: &TOKEN_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    invoke::<3>(&instruction, &[source, mint, authority])
}

/// Transfer — token instruction index 3.
///
/// Accounts: source (writable), destination (writable), authority (signer).
pub fn transfer<'a>(
    source: &'a AccountView,
    destination: &'a AccountView,
    authority: &'a AccountView,
    amount: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let mut data = [0u8; 9];
    data[0] = 3; // Transfer
    data[1..9].copy_from_slice(&amount.to_le_bytes());

    let accounts = [
        InstructionAccount::writable(source.address()),
        InstructionAccount::writable(destination.address()),
        InstructionAccount::readonly_signer(authority.address()),
    ];

    let instruction = InstructionView {
        program_id: &TOKEN_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    if signer_seeds.is_empty() {
        invoke::<3>(&instruction, &[source, destination, authority])
    } else {
        let (buf, len) = build_signer(signer_seeds);
        let seeds = unsafe { core::slice::from_raw_parts(buf.as_ptr() as *const Seed<'_>, len) };
        let signer = Signer::from(seeds);
        invoke_signed::<3>(&instruction, &[source, destination, authority], &[signer])
    }
}

/// Read the token amount from a token account's raw data.
///
/// SPL token account layout (packed):
///   0..32  — mint
///   32..64 — owner
///   64..72 — amount (u64 LE)
#[inline(always)]
pub fn read_token_amount(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[64..72].try_into().unwrap_or([0u8; 8]))
}
