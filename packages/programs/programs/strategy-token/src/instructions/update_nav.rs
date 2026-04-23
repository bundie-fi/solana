//! update_nav — refresh the strategy's NAV oracle.
//!
//! ──────────────────────────────────────────────────────────────────────────
//! Wire format (v1 + v2)
//! ──────────────────────────────────────────────────────────────────────────
//!
//! Instruction discriminator: byte `3` (set in `lib.rs::process_instruction`).
//! After the discriminator is stripped, this handler receives `_data` in
//! one of three shapes:
//!
//!     []                                                    ← legacy / no positions
//!   | [num_positions: u8, tag: u8 × N]                      ← v1
//!   | [V2_SENTINEL, num_positions: u8,                      ← v2
//!      (tag: u8, num_state_accs: u8) × N]
//!
//! `V2_SENTINEL = 0xFF`. v1 cannot start with `0xFF` because that would
//! claim 255 positions (impossible to fit alongside the 4 fixed accounts
//! within Solana's account-array cap), so the byte is unambiguous.
//!
//! ## v1 — single-state-account-per-position
//!
//! Account layout (after the 4 fixed accounts):
//!
//!     [4 + 2*i + 0] holding_acc       — SPL token (cToken / mSOL / lp)
//!     [4 + 2*i + 1] state_acc         — protocol-owned state account
//!
//! `num_positions` MUST equal `(accounts.len() - 4) / 2`.
//!
//! ## v2 — variable-state-accounts-per-position
//!
//! Designed for Drift / marginfi which need >1 aux state account per
//! position (Drift's User + per-asset SpotMarket; marginfi's
//! MarginfiAccount + per-asset Bank). For each position:
//!
//!     [holding_acc] [state_acc_0] [state_acc_1] … [state_acc_{S-1}]
//!
//! where S = `num_state_accs` for that position. Total remaining-account
//! count = Σ_i (1 + num_state_accs[i]).
//!
//! v1-tagged positions emit `num_state_accs == 1` in v2 form, so the
//! same dispatcher handles both — v1 is just sugar.
//!
//! Backwards compatibility: empty data and v1-shaped data both still
//! work. New keepers SHOULD emit v2 — but devnet keepers emitting v1 for
//! Kamino / Marinade strategies continue to dispatch correctly.
//!
//! Protocol tags (see `nav_readers::PROTOCOL_TAG_*`):
//!     0 = Kamino     (state_accs = [Reserve])
//!     1 = Marinade   (state_accs = [State])
//!     2 = Drift      (state_accs = [User, SpotMarket…])      — v2 only
//!     3 = Marginfi   (state_accs = [MarginfiAccount, Bank…]) — v2 only
//!
//! Account layout (after the 4 fixed accounts):
//!
//!     [0] cranker (signer)
//!     [1] strategy (writable, program-owned)
//!     [2] nav_oracle (writable, program-owned)
//!     [3] wallet_token_ata (idle quote-token)
//!     [4..] for each position i: holding_acc + N state accounts (see above)

use pinocchio::{
    account::AccountView,
    address::Address,
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    cpi, error,
    nav_readers::{
        drift::DriftUserReader, kamino::KaminoReserveReader, marginfi::MarginfiAccountReader,
        marinade::MarinadeStateReader, PositionReader, PROTOCOL_TAG_DRIFT, PROTOCOL_TAG_KAMINO,
        PROTOCOL_TAG_MARGINFI, PROTOCOL_TAG_MARINADE,
    },
    state::{nav_oracle::NavOracle, strategy::Strategy},
    util,
};

const NAV_SCALE: u128 = 1_000_000_000;

/// Wire-format v2 sentinel. `data[0] == V2_SENTINEL` switches the parser
/// from v1 (`[num_positions, tag×N]`) to v2 (variable state-accounts).
const V2_SENTINEL: u8 = 0xFF;

/// One per-position descriptor parsed from the instruction data. Always
/// produced by the parser, regardless of whether the source was v1 or v2.
struct PositionDescriptor {
    tag: u8,
    num_state_accs: u8,
}

pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // ----------------------------------------------------------------
    // 1. Unpack accounts
    // ----------------------------------------------------------------

    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let cranker = &accounts[0];
    let strategy_acc = &accounts[1];
    let nav_oracle_acc = &accounts[2];
    let wallet_token_ata = &accounts[3];

    util::assert_signer(cranker)?;
    util::assert_writable(strategy_acc)?;
    util::assert_writable(nav_oracle_acc)?;
    util::assert_owned_by(strategy_acc, program_id)?;
    util::assert_owned_by(nav_oracle_acc, program_id)?;

    // ----------------------------------------------------------------
    // 2. Read strategy data
    // ----------------------------------------------------------------

    let (total_shares, _current_nav, high_water_mark, twap_accumulator, twap_last_slot) = {
        let strat_data = strategy_acc.try_borrow()?;

        if !Strategy::check_discriminator(&strat_data) {
            return Err(error::err(error::ERROR_INVALID_DISCRIMINATOR));
        }

        (
            Strategy::total_shares(&strat_data),
            Strategy::current_nav(&strat_data),
            Strategy::high_water_mark(&strat_data),
            Strategy::nav_twap_accumulator(&strat_data),
            Strategy::twap_last_slot(&strat_data),
        )
    };

    // ----------------------------------------------------------------
    // 3. Read nav_oracle and validate
    // ----------------------------------------------------------------

    let (last_snapshot_slot, min_snapshot_interval, twap_window, snapshot_count) = {
        let oracle_data = nav_oracle_acc.try_borrow()?;

        if !NavOracle::check_discriminator(&oracle_data) {
            return Err(error::err(error::ERROR_INVALID_DISCRIMINATOR));
        }

        // Verify oracle.strategy == strategy address
        let oracle_strategy = NavOracle::strategy(&oracle_data);
        util::assert_keys_equal(
            unsafe { &*(oracle_strategy as *const [u8; 32] as *const Address) },
            strategy_acc.address(),
        )?;

        (
            NavOracle::last_snapshot_slot(&oracle_data),
            NavOracle::min_snapshot_interval(&oracle_data),
            NavOracle::twap_window(&oracle_data),
            NavOracle::snapshot_count(&oracle_data),
        )
    };

    // ----------------------------------------------------------------
    // 4. Get current slot and enforce min_snapshot_interval
    // ----------------------------------------------------------------

    let clock = Clock::get()?;
    let current_slot = clock.slot;

    let slots_since_last = current_slot.saturating_sub(last_snapshot_slot);
    if slots_since_last < min_snapshot_interval {
        return Err(error::err(error::ERROR_SNAPSHOT_TOO_SOON));
    }

    // ----------------------------------------------------------------
    // 5. Read portfolio value
    //   = idle wallet ATA balance
    //   + Σ (per-position protocol read of deployed holdings)
    // See module-level wire-format doc for v1 vs v2 layouts.
    // ----------------------------------------------------------------

    let mut portfolio_value: u64 = {
        let ata_data = wallet_token_ata.try_borrow()?;
        cpi::spl_token::read_token_amount(&ata_data)
    };

    // Parse `data` into a uniform list of PositionDescriptors. A small
    // fixed buffer keeps us off the heap (no_std). 16 positions is far
    // more than any realistic strategy.
    const MAX_POSITIONS: usize = 16;
    let mut descriptors: [PositionDescriptor; MAX_POSITIONS] = [
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
        PositionDescriptor {
            tag: 0,
            num_state_accs: 0,
        },
    ];
    let num_positions = parse_descriptors(data, &mut descriptors)?;

    // Walk remaining_accounts in lockstep with descriptors.
    let remaining = &accounts[4..];

    // Sanity-check the total remaining-account count matches the sum of
    // `1 + num_state_accs` across all descriptors. This catches keeper
    // bugs (wrong tag count vs accounts) before we mis-price.
    let mut expected_remaining: usize = 0;
    for d in &descriptors[..num_positions] {
        expected_remaining = expected_remaining
            .checked_add(1 + d.num_state_accs as usize)
            .ok_or(ProgramError::InvalidInstructionData)?;
    }
    if remaining.len() != expected_remaining {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let mut cursor: usize = 0;
    for d in &descriptors[..num_positions] {
        let s = d.num_state_accs as usize;
        let holding_acc = &remaining[cursor];
        let state_accs = &remaining[cursor + 1..cursor + 1 + s];
        cursor += 1 + s;

        let holding_amount = {
            let h_data = holding_acc.try_borrow()?;
            cpi::spl_token::read_token_amount(&h_data)
        };

        let leg_value = match d.tag {
            PROTOCOL_TAG_KAMINO => {
                KaminoReserveReader::value_in_quote_multi(state_accs, holding_amount)?
            }
            PROTOCOL_TAG_MARINADE => {
                MarinadeStateReader::value_in_quote_multi(state_accs, holding_amount)?
            }
            PROTOCOL_TAG_DRIFT => {
                DriftUserReader::value_in_quote_multi(state_accs, holding_amount)?
            }
            PROTOCOL_TAG_MARGINFI => {
                MarginfiAccountReader::value_in_quote_multi(state_accs, holding_amount)?
            }
            _ => return Err(error::err(error::ERROR_INVALID_PROTOCOL)),
        };

        portfolio_value = portfolio_value
            .checked_add(leg_value)
            .ok_or(error::err(error::ERROR_NAV_OVERFLOW))?;
    }

    // ----------------------------------------------------------------
    // 6. Compute nav_per_share
    // ----------------------------------------------------------------

    let nav_per_share: u64 = if total_shares > 0 {
        let nps = (portfolio_value as u128)
            .checked_mul(NAV_SCALE)
            .ok_or(error::err(error::ERROR_NAV_OVERFLOW))?
            / (total_shares as u128);
        nps as u64
    } else {
        0
    };

    // ----------------------------------------------------------------
    // 7. TWAP calculation (EMA approach)
    // ----------------------------------------------------------------

    let slots_elapsed = current_slot.saturating_sub(twap_last_slot);

    // EMA: twap = (nav_per_share * weight + old_twap * complement) / twap_window
    // weight = min(slots_elapsed, twap_window), complement = twap_window - weight
    let old_twap = if twap_accumulator > 0 {
        twap_accumulator as u64
    } else {
        nav_per_share
    };

    let weight = slots_elapsed.min(twap_window);
    let complement = twap_window.saturating_sub(weight);

    let twap_value: u64 = if twap_window > 0 {
        ((nav_per_share as u128 * weight as u128 + old_twap as u128 * complement as u128)
            / twap_window as u128) as u64
    } else {
        nav_per_share
    };

    // Store current TWAP value in the accumulator field (repurposed as EMA state)
    let new_accumulator = twap_value as u128;

    // ----------------------------------------------------------------
    // 8. Write NavOracle
    // ----------------------------------------------------------------

    {
        let oracle_data = unsafe { nav_oracle_acc.borrow_unchecked_mut() };
        NavOracle::set_nav_per_share(oracle_data, nav_per_share);
        NavOracle::set_twap_value(oracle_data, twap_value);
        NavOracle::set_last_snapshot_slot(oracle_data, current_slot);
        NavOracle::set_snapshot_count(oracle_data, snapshot_count + 1);
    }

    // ----------------------------------------------------------------
    // 9. Write Strategy
    // ----------------------------------------------------------------

    {
        let strat_data = unsafe { strategy_acc.borrow_unchecked_mut() };

        Strategy::set_current_nav(strat_data, portfolio_value);
        Strategy::set_last_nav_slot(strat_data, current_slot);
        Strategy::set_nav_twap_accumulator(strat_data, new_accumulator);
        Strategy::set_twap_last_slot(strat_data, current_slot);

        // Update high water mark (per-share, 1e9 scaled) if current exceeds it
        if total_shares > 0 && nav_per_share > high_water_mark {
            Strategy::set_high_water_mark(strat_data, nav_per_share);
        }
    }

    Ok(())
}

/// Parse `data` (instruction-data payload after the discriminator) into
/// the `descriptors` slice. Supports three shapes:
///
///   * `[]`                                       → 0 positions
///   * `[num, tag×N]` (v1)                         → N positions, each
///                                                   with `num_state_accs = 1`
///   * `[V2_SENTINEL, num, (tag, sa)×N]` (v2)      → N positions with
///                                                   per-position `sa`
///
/// Returns the number of positions actually written.
fn parse_descriptors(
    data: &[u8],
    descriptors: &mut [PositionDescriptor],
) -> Result<usize, ProgramError> {
    if data.is_empty() {
        return Ok(0);
    }

    if data[0] == V2_SENTINEL {
        // v2: [SENTINEL, n, (tag, num_state_accs) × n]
        if data.len() < 2 {
            return Err(ProgramError::InvalidInstructionData);
        }
        let n = data[1] as usize;
        if n > descriptors.len() {
            return Err(ProgramError::InvalidInstructionData);
        }
        let needed = 2 + n * 2;
        if data.len() < needed {
            return Err(ProgramError::InvalidInstructionData);
        }
        for i in 0..n {
            let tag = data[2 + 2 * i];
            let sa = data[2 + 2 * i + 1];
            descriptors[i] = PositionDescriptor {
                tag,
                num_state_accs: sa,
            };
        }
        Ok(n)
    } else {
        // v1: [num, tag × num]; each position implicitly carries 1 state acc.
        let n = data[0] as usize;
        if n > descriptors.len() {
            return Err(ProgramError::InvalidInstructionData);
        }
        if data.len() < 1 + n {
            return Err(ProgramError::InvalidInstructionData);
        }
        for i in 0..n {
            descriptors[i] = PositionDescriptor {
                tag: data[1 + i],
                num_state_accs: 1,
            };
        }
        Ok(n)
    }
}
