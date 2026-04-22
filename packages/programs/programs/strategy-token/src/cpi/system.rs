use core::mem::MaybeUninit;

use pinocchio::{
    account::AccountView,
    address::Address,
    cpi::{invoke, invoke_signed, Seed, Signer},
    instruction::{InstructionAccount, InstructionView},
    ProgramResult,
};

/// System Program ID (all zeros)
pub const SYSTEM_PROGRAM_ID: Address = Address::new_from_array([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

/// Build seeds into a `MaybeUninit` array and return a `Signer`.
///
/// Returns a tuple of the backing storage (must stay alive) and the `Signer`.
/// Supports up to 16 seed components.
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

/// CreateAccount — system instruction index 0.
///
/// `signer_seeds` are the PDA seeds for `new_account` if it is a PDA.
/// Pass `&[]` when the new account is a normal keypair signer.
pub fn create_account<'a>(
    payer: &'a AccountView,
    new_account: &'a AccountView,
    lamports: u64,
    space: u64,
    owner: &Address,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    // Instruction data: discriminant (4 bytes) + lamports (8) + space (8) + owner (32) = 52
    let mut data = [0u8; 52];
    data[0..4].copy_from_slice(&0u32.to_le_bytes());
    data[4..12].copy_from_slice(&lamports.to_le_bytes());
    data[12..20].copy_from_slice(&space.to_le_bytes());
    data[20..52].copy_from_slice(owner.as_ref());

    let accounts = [
        InstructionAccount::writable_signer(payer.address()),
        InstructionAccount::writable_signer(new_account.address()),
    ];

    let instruction = InstructionView {
        program_id: &SYSTEM_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    if signer_seeds.is_empty() {
        invoke::<2>(&instruction, &[payer, new_account])
    } else {
        let (buf, len) = build_signer(signer_seeds);
        // SAFETY: we initialized exactly `len` elements above
        let seeds = unsafe { core::slice::from_raw_parts(buf.as_ptr() as *const Seed<'_>, len) };
        let signer = Signer::from(seeds);
        invoke_signed::<2>(&instruction, &[payer, new_account], &[signer])
    }
}

/// Transfer — system instruction index 2.
pub fn transfer<'a>(
    from: &'a AccountView,
    to: &'a AccountView,
    lamports: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    // Instruction data: discriminant (4 bytes) + lamports (8) = 12
    let mut data = [0u8; 12];
    data[0..4].copy_from_slice(&2u32.to_le_bytes());
    data[4..12].copy_from_slice(&lamports.to_le_bytes());

    let accounts = [
        InstructionAccount::writable_signer(from.address()),
        InstructionAccount::writable(to.address()),
    ];

    let instruction = InstructionView {
        program_id: &SYSTEM_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    if signer_seeds.is_empty() {
        invoke::<2>(&instruction, &[from, to])
    } else {
        let (buf, len) = build_signer(signer_seeds);
        // SAFETY: we initialized exactly `len` elements above
        let seeds = unsafe { core::slice::from_raw_parts(buf.as_ptr() as *const Seed<'_>, len) };
        let signer = Signer::from(seeds);
        invoke_signed::<2>(&instruction, &[from, to], &[signer])
    }
}
