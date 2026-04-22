use core::mem::MaybeUninit;

use pinocchio::{
    account::AccountView,
    address::Address,
    cpi::{invoke_signed, Seed, Signer},
    instruction::{InstructionAccount, InstructionView},
    ProgramResult,
};

/// Kamino Lending Program ID — "KLend2g3cP87ber8p32LuJLuLPzCvXN4KcKr2S8MQek"
pub const KAMINO_LEND_PROGRAM_ID: Address = Address::new_from_array([
    4, 178, 172, 177, 18, 88, 204, 227, 104, 40, 231, 185, 142, 34, 138, 255, 142, 0, 105, 130, 80,
    238, 67, 233, 41, 97, 82, 244, 251, 32, 82, 185,
]);

/// Discriminator for withdraw_obligation_collateral_and_redeem_reserve_collateral
const WITHDRAW_DISCRIMINATOR: [u8; 8] = [149, 158, 41, 178, 5, 199, 132, 135];

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

/// Withdraw from Kamino lending via CPI.
///
/// `accounts` — remaining accounts from the instruction (14 Kamino accounts).
/// `amount` — amount of liquidity to withdraw.
/// `signer_seeds` — wallet PDA seeds for signing.
pub fn withdraw_signed(
    accounts: &[AccountView],
    amount: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    // Build instruction data: [8-byte discriminator][8-byte amount LE] = 16 bytes
    let mut data = [0u8; 16];
    data[0..8].copy_from_slice(&WITHDRAW_DISCRIMINATOR);
    data[8..16].copy_from_slice(&amount.to_le_bytes());

    // Account layout (14 accounts):
    // [0]  owner (wallet PDA — signer, writable)
    // [1]  obligation (writable)
    // [2]  lending_market
    // [3]  lending_market_authority
    // [4]  reserve (writable)
    // [5]  reserve_liquidity_mint
    // [6]  reserve_liquidity_supply (writable)
    // [7]  reserve_collateral_mint (writable)
    // [8]  reserve_destination_deposit_collateral (writable)
    // [9]  user_source_liquidity (writable)
    // [10] placeholder_user_destination_collateral (writable)
    // [11] collateral_token_program
    // [12] liquidity_token_program
    // [13] instruction_sysvar_account
    let ix_accounts = [
        InstructionAccount::writable_signer(accounts[0].address()), // owner (wallet PDA)
        InstructionAccount::writable(accounts[1].address()),        // obligation
        InstructionAccount::readonly(accounts[2].address()),        // lending_market
        InstructionAccount::readonly(accounts[3].address()),        // lending_market_authority
        InstructionAccount::writable(accounts[4].address()),        // reserve
        InstructionAccount::readonly(accounts[5].address()),        // reserve_liquidity_mint
        InstructionAccount::writable(accounts[6].address()),        // reserve_liquidity_supply
        InstructionAccount::writable(accounts[7].address()),        // reserve_collateral_mint
        InstructionAccount::writable(accounts[8].address()), // reserve_destination_deposit_collateral
        InstructionAccount::writable(accounts[9].address()), // user_source_liquidity
        InstructionAccount::writable(accounts[10].address()), // placeholder_user_destination_collateral
        InstructionAccount::readonly(accounts[11].address()), // collateral_token_program
        InstructionAccount::readonly(accounts[12].address()), // liquidity_token_program
        InstructionAccount::readonly(accounts[13].address()), // instruction_sysvar_account
    ];

    let instruction = InstructionView {
        program_id: &KAMINO_LEND_PROGRAM_ID,
        accounts: &ix_accounts,
        data: &data,
    };

    let (buf, len) = build_signer(signer_seeds);
    let seeds = unsafe { core::slice::from_raw_parts(buf.as_ptr() as *const Seed<'_>, len) };
    let signer = Signer::from(seeds);

    invoke_signed::<14>(
        &instruction,
        &[
            &accounts[0],
            &accounts[1],
            &accounts[2],
            &accounts[3],
            &accounts[4],
            &accounts[5],
            &accounts[6],
            &accounts[7],
            &accounts[8],
            &accounts[9],
            &accounts[10],
            &accounts[11],
            &accounts[12],
            &accounts[13],
        ],
        &[signer],
    )
}
