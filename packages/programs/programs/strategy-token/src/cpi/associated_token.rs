use pinocchio::{
    account::AccountView,
    address::Address,
    cpi::invoke,
    instruction::{InstructionAccount, InstructionView},
    ProgramResult,
};

/// Associated Token Account Program ID: ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Address = Address::new_from_array([
    140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218,
    255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89,
]);

/// Create Associated Token Account (idempotent variant, ix byte = 1).
///
/// Accounts (in order required by the ATA program):
///   0. payer          — writable, signer
///   1. ata            — writable (derived)
///   2. wallet         — readonly (owner of the ATA)
///   3. mint           — readonly
///   4. system_program — readonly
///   5. token_program  — readonly
pub fn create_idempotent<'a>(
    payer: &'a AccountView,
    ata: &'a AccountView,
    wallet: &'a AccountView,
    mint: &'a AccountView,
    system_program: &'a AccountView,
    token_program: &'a AccountView,
) -> ProgramResult {
    // Single-byte instruction data: 1 = CreateIdempotent
    let data = [1u8];

    let accounts = [
        InstructionAccount::writable_signer(payer.address()),
        InstructionAccount::writable(ata.address()),
        InstructionAccount::readonly(wallet.address()),
        InstructionAccount::readonly(mint.address()),
        InstructionAccount::readonly(system_program.address()),
        InstructionAccount::readonly(token_program.address()),
    ];

    let instruction = InstructionView {
        program_id: &ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    invoke::<6>(
        &instruction,
        &[payer, ata, wallet, mint, system_program, token_program],
    )
}

/// Derive the Associated Token Account address for a given wallet and mint.
///
/// Returns `(address, bump_seed)`.
///
/// Seeds: [wallet, token_program_id, mint]
#[allow(dead_code)]
pub fn derive_ata(wallet: &Address, mint: &Address) -> (Address, u8) {
    // Inline PDA derivation isn't available in pinocchio no_std without alloc.
    // This function is provided as a reference; callers should compute the ATA
    // off-chain and pass it in as an account. If on-chain derivation is needed,
    // use the `find_program_address` syscall directly.
    //
    // For now, panic to make misuse obvious at test time.
    let _ = (wallet, mint);
    panic!("derive_ata: use off-chain derivation or pass ATA address directly");
}
