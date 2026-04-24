use {
    crate::Swap,
    solana_account_view::AccountView,
    solana_address::address_eq,
    solana_instruction_view::cpi::Signer,
    solana_program_error::{ProgramError, ProgramResult},
};

fn split_accounts_checked(
    accounts: &[AccountView],
    count: usize,
) -> Result<(&[AccountView], &[AccountView]), ProgramError> {
    accounts
        .split_at_checked(count)
        .ok_or(ProgramError::NotEnoughAccountKeys)
}

fn split_data_checked(data: &[u8], count: usize) -> Result<(&[u8], &[u8]), ProgramError> {
    data.split_at_checked(count)
        .ok_or(ProgramError::InvalidInstructionData)
}

/// Typed context for swap operations, discriminated by protocol.
pub enum SwapContext<'info> {
    #[cfg(feature = "perena-swap")]
    Perena(crate::perena::PerenaSwapAccounts<'info>),

    #[cfg(feature = "solfi-swap")]
    SolFi(crate::solfi::SolFiSwapAccounts<'info>),

    #[cfg(feature = "solfi_v2-swap")]
    SolFiV2(crate::solfi_v2::SolFiV2SwapAccounts<'info>),

    #[cfg(feature = "manifest-swap")]
    Manifest(crate::manifest::ManifestSwapAccounts<'info>),

    #[cfg(feature = "heaven-swap")]
    Heaven(crate::heaven::HeavenSwapAccounts<'info>),

    #[cfg(feature = "aldrin-swap")]
    Aldrin(crate::aldrin::AldrinSwapAccounts<'info>),

    #[cfg(feature = "aldrin_v2-swap")]
    AldrinV2(crate::aldrin_v2::AldrinV2SwapAccounts<'info>),

    #[cfg(feature = "futarchy-swap")]
    Futarchy(crate::futarchy::FutarchySwapAccounts<'info>),

    #[cfg(feature = "gamma-swap")]
    Gamma(crate::gamma::GammaSwapAccounts<'info>),

    #[cfg(feature = "scale_amm-swap")]
    ScaleAmm(crate::scale_amm::ScaleAmmSwapAccounts<'info>),

    #[cfg(feature = "scale_vmm-swap")]
    ScaleVmm(crate::scale_vmm::ScaleVmmSwapAccounts<'info>),

    #[cfg(feature = "omnipair-swap")]
    Omnipair(crate::omnipair::OmnipairSwapAccounts<'info>),

    #[cfg(feature = "hadron-swap")]
    Hadron(crate::hadron::HadronSwapAccounts<'info>),
    #[cfg(feature = "raydium-cpmm-swap")]
    RaydiumCpmm(crate::raydium_cpmm::RaydiumCpmmSwapAccounts<'info>),

    #[cfg(feature = "raydium-cpmm-devnet-swap")]
    RaydiumCpmmDevnet(crate::raydium_cpmm_devnet::RaydiumCpmmDevnetSwapAccounts<'info>),

    #[cfg(feature = "raydium-clmm-swap")]
    RaydiumClmm(crate::raydium_clmm::RaydiumClmmSwapAccounts<'info>),

    #[cfg(feature = "raydium-amm-v4-swap")]
    RaydiumAmmV4(crate::raydium_amm_v4::RaydiumAmmV4SwapAccounts<'info>),

    #[cfg(feature = "orca-whirlpools-swap")]
    OrcaWhirlpools(crate::orca_whirlpools::OrcaWhirlpoolsSwapAccounts<'info>),

    #[cfg(feature = "meteora-dlmm-swap")]
    MeteoraDlmm(crate::meteora_dlmm::MeteoraDlmmSwapAccounts<'info>),

    #[cfg(feature = "meteora-damm-v2-swap")]
    MeteoraDammV2(crate::meteora_damm_v2::MeteoraDammV2SwapAccounts<'info>),

    #[cfg(feature = "phoenix-swap")]
    Phoenix(crate::phoenix::PhoenixSwapAccounts<'info>),

    #[cfg(feature = "openbook-v2-swap")]
    OpenbookV2(crate::openbook_v2::OpenbookV2SwapAccounts<'info>),
}

/// Protocol-specific swap data enum for use with SwapContext
pub enum SwapData<'a> {
    #[cfg(feature = "perena-swap")]
    Perena(crate::perena::PerenaSwapData),

    #[cfg(feature = "solfi-swap")]
    SolFi(crate::solfi::SolFiSwapData),

    #[cfg(feature = "solfi_v2-swap")]
    SolFiV2(crate::solfi_v2::SolFiV2SwapData),

    #[cfg(feature = "manifest-swap")]
    Manifest(crate::manifest::ManifestSwapData),

    #[cfg(feature = "heaven-swap")]
    Heaven(crate::heaven::HeavenSwapData<'a>),

    #[cfg(feature = "aldrin-swap")]
    Aldrin(crate::aldrin::AldrinSwapData),

    #[cfg(feature = "aldrin_v2-swap")]
    AldrinV2(crate::aldrin_v2::AldrinV2SwapData),

    #[cfg(feature = "futarchy-swap")]
    Futarchy(crate::futarchy::FutarchySwapData),

    #[cfg(feature = "gamma-swap")]
    Gamma(()),

    #[cfg(feature = "scale_amm-swap")]
    ScaleAmm(crate::scale_amm::ScaleAmmSwapData),

    #[cfg(feature = "scale_vmm-swap")]
    ScaleVmm(crate::scale_vmm::ScaleVmmSwapData),

    #[cfg(feature = "omnipair-swap")]
    Omnipair(()),

    #[cfg(feature = "hadron-swap")]
    Hadron(crate::hadron::HadronSwapData),
    #[cfg(feature = "raydium-cpmm-swap")]
    RaydiumCpmm(()),

    #[cfg(feature = "raydium-cpmm-devnet-swap")]
    RaydiumCpmmDevnet(()),

    #[cfg(feature = "raydium-clmm-swap")]
    RaydiumClmm(crate::raydium_clmm::RaydiumClmmData),

    #[cfg(feature = "raydium-amm-v4-swap")]
    RaydiumAmmV4(()),

    #[cfg(feature = "orca-whirlpools-swap")]
    OrcaWhirlpools(crate::orca_whirlpools::OrcaWhirlpoolsSwapData),

    #[cfg(feature = "meteora-dlmm-swap")]
    MeteoraDlmm(crate::meteora_dlmm::MeteoraDlmmSwapData),

    #[cfg(feature = "meteora-damm-v2-swap")]
    MeteoraDammV2(crate::meteora_damm_v2::MeteoraDammV2SwapData),

    #[cfg(feature = "phoenix-swap")]
    Phoenix(crate::phoenix::PhoenixSwapData),

    #[cfg(feature = "openbook-v2-swap")]
    OpenbookV2(crate::openbook_v2::OpenbookV2SwapData),
}

impl<'a> SwapContext<'a> {
    /// Parse protocol-specific swap data, returning the parsed data and remaining bytes.
    pub fn try_from_swap_data(
        &self,
        data: &'a [u8],
    ) -> Result<(SwapData<'a>, &'a [u8]), ProgramError> {
        match self {
            #[cfg(feature = "perena-swap")]
            SwapContext::Perena(_) => {
                let n = crate::perena::PerenaSwapData::DATA_LEN;
                let (mine, rest) = split_data_checked(data, n)?;
                Ok((
                    SwapData::Perena(crate::perena::PerenaSwapData::try_from(mine)?),
                    rest,
                ))
            }

            #[cfg(feature = "solfi-swap")]
            SwapContext::SolFi(_) => {
                let n = crate::solfi::SolFiSwapData::DATA_LEN;
                let (mine, rest) = split_data_checked(data, n)?;
                Ok((
                    SwapData::SolFi(crate::solfi::SolFiSwapData::try_from(mine)?),
                    rest,
                ))
            }

            #[cfg(feature = "solfi_v2-swap")]
            SwapContext::SolFiV2(_) => {
                let n = crate::solfi_v2::SolFiV2SwapData::DATA_LEN;
                let (mine, rest) = split_data_checked(data, n)?;
                Ok((
                    SwapData::SolFiV2(crate::solfi_v2::SolFiV2SwapData::try_from(mine)?),
                    rest,
                ))
            }

            #[cfg(feature = "manifest-swap")]
            SwapContext::Manifest(_) => {
                let n = crate::manifest::ManifestSwapData::DATA_LEN;
                let (mine, rest) = split_data_checked(data, n)?;
                Ok((
                    SwapData::Manifest(crate::manifest::ManifestSwapData::try_from(mine)?),
                    rest,
                ))
            }

            #[cfg(feature = "heaven-swap")]
            SwapContext::Heaven(_) => {
                // Heaven has variable-length data (direction + event).
                // Consumes all remaining data — must be the last leg in multi-swap.
                Ok((
                    SwapData::Heaven(crate::heaven::HeavenSwapData::try_from(data)?),
                    &[],
                ))
            }

            #[cfg(feature = "aldrin-swap")]
            SwapContext::Aldrin(_) => {
                let n = crate::aldrin::AldrinSwapData::DATA_LEN;
                let (mine, rest) = split_data_checked(data, n)?;
                Ok((
                    SwapData::Aldrin(crate::aldrin::AldrinSwapData::try_from(mine)?),
                    rest,
                ))
            }

            #[cfg(feature = "aldrin_v2-swap")]
            SwapContext::AldrinV2(_) => {
                let n = crate::aldrin_v2::AldrinV2SwapData::DATA_LEN;
                let (mine, rest) = split_data_checked(data, n)?;
                Ok((
                    SwapData::AldrinV2(crate::aldrin_v2::AldrinV2SwapData::try_from(mine)?),
                    rest,
                ))
            }

            #[cfg(feature = "futarchy-swap")]
            SwapContext::Futarchy(_) => {
                let n = crate::futarchy::FutarchySwapData::DATA_LEN;
                let (mine, rest) = split_data_checked(data, n)?;
                Ok((
                    SwapData::Futarchy(crate::futarchy::FutarchySwapData::try_from(mine)?),
                    rest,
                ))
            }

            #[cfg(feature = "gamma-swap")]
            SwapContext::Gamma(_) => Ok((SwapData::Gamma(()), data)),

            #[cfg(feature = "scale_amm-swap")]
            SwapContext::ScaleAmm(_) => {
                let n = crate::scale_amm::ScaleAmmSwapData::DATA_LEN;
                let (mine, rest) = split_data_checked(data, n)?;
                Ok((
                    SwapData::ScaleAmm(crate::scale_amm::ScaleAmmSwapData::try_from(mine)?),
                    rest,
                ))
            }

            #[cfg(feature = "scale_vmm-swap")]
            SwapContext::ScaleVmm(_) => {
                let n = crate::scale_vmm::ScaleVmmSwapData::DATA_LEN;
                let (mine, rest) = split_data_checked(data, n)?;
                Ok((
                    SwapData::ScaleVmm(crate::scale_vmm::ScaleVmmSwapData::try_from(mine)?),
                    rest,
                ))
            }

            #[cfg(feature = "omnipair-swap")]
            SwapContext::Omnipair(_) => Ok((SwapData::Omnipair(()), data)),

            #[cfg(feature = "hadron-swap")]
            SwapContext::Hadron(_) => {
                let n = crate::hadron::HadronSwapData::DATA_LEN;
                if data.len() < n {
                    return Err(ProgramError::InvalidInstructionData);
                }
                let (mine, rest) = data.split_at(n);
                Ok((
                    SwapData::Hadron(crate::hadron::HadronSwapData::try_from(mine)?),
                    rest,
                ))
            }

            #[cfg(feature = "raydium-cpmm-swap")]
            SwapContext::RaydiumCpmm(_) => Ok((SwapData::RaydiumCpmm(()), data)),

            #[cfg(feature = "raydium-cpmm-devnet-swap")]
            SwapContext::RaydiumCpmmDevnet(_) => Ok((SwapData::RaydiumCpmmDevnet(()), data)),

            #[cfg(feature = "raydium-clmm-swap")]
            SwapContext::RaydiumClmm(_) => Ok((
                SwapData::RaydiumClmm(crate::raydium_clmm::RaydiumClmmData::try_from(data)?),
                &[],
            )),

            #[cfg(feature = "raydium-amm-v4-swap")]
            SwapContext::RaydiumAmmV4(_) => Ok((SwapData::RaydiumAmmV4(()), data)),

            #[cfg(feature = "orca-whirlpools-swap")]
            SwapContext::OrcaWhirlpools(_) => Ok((
                SwapData::OrcaWhirlpools(crate::orca_whirlpools::OrcaWhirlpoolsSwapData::try_from(
                    data,
                )?),
                &[],
            )),

            #[cfg(feature = "meteora-dlmm-swap")]
            SwapContext::MeteoraDlmm(_) => Ok((
                SwapData::MeteoraDlmm(crate::meteora_dlmm::MeteoraDlmmSwapData),
                data,
            )),

            #[cfg(feature = "meteora-damm-v2-swap")]
            SwapContext::MeteoraDammV2(_) => Ok((
                SwapData::MeteoraDammV2(crate::meteora_damm_v2::MeteoraDammV2SwapData),
                data,
            )),

            #[cfg(feature = "phoenix-swap")]
            SwapContext::Phoenix(_) => Ok((
                SwapData::Phoenix(crate::phoenix::PhoenixSwapData::try_from(data)?),
                &[],
            )),

            #[cfg(feature = "openbook-v2-swap")]
            SwapContext::OpenbookV2(_) => Ok((
                SwapData::OpenbookV2(crate::openbook_v2::OpenbookV2SwapData::try_from(data)?),
                &[],
            )),

            #[allow(unreachable_patterns)]
            _ => Err(ProgramError::InvalidAccountData),
        }
    }
}

impl<'a> Swap<'a> for SwapContext<'a> {
    type Accounts = Self;
    type Data = SwapData<'a>;

    fn swap_signed(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        match (ctx, data) {
            #[cfg(feature = "perena-swap")]
            (SwapContext::Perena(accounts), SwapData::Perena(d)) => {
                crate::perena::Perena::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "solfi-swap")]
            (SwapContext::SolFi(accounts), SwapData::SolFi(d)) => crate::solfi::SolFi::swap_signed(
                accounts,
                in_amount,
                minimum_out_amount,
                d,
                signer_seeds,
            ),

            #[cfg(feature = "solfi_v2-swap")]
            (SwapContext::SolFiV2(accounts), SwapData::SolFiV2(d)) => {
                crate::solfi_v2::SolFiV2::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "manifest-swap")]
            (SwapContext::Manifest(accounts), SwapData::Manifest(d)) => {
                crate::manifest::Manifest::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "heaven-swap")]
            (SwapContext::Heaven(accounts), SwapData::Heaven(d)) => {
                crate::heaven::Heaven::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "aldrin-swap")]
            (SwapContext::Aldrin(accounts), SwapData::Aldrin(d)) => {
                crate::aldrin::Aldrin::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "aldrin_v2-swap")]
            (SwapContext::AldrinV2(accounts), SwapData::AldrinV2(d)) => {
                crate::aldrin_v2::AldrinV2::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "futarchy-swap")]
            (SwapContext::Futarchy(accounts), SwapData::Futarchy(d)) => {
                crate::futarchy::Futarchy::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "gamma-swap")]
            (SwapContext::Gamma(accounts), SwapData::Gamma(())) => {
                crate::gamma::Gamma::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    &(),
                    signer_seeds,
                )
            }

            #[cfg(feature = "scale_amm-swap")]
            (SwapContext::ScaleAmm(accounts), SwapData::ScaleAmm(d)) => {
                crate::scale_amm::ScaleAmm::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "scale_vmm-swap")]
            (SwapContext::ScaleVmm(accounts), SwapData::ScaleVmm(d)) => {
                crate::scale_vmm::ScaleVmm::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "omnipair-swap")]
            (SwapContext::Omnipair(accounts), SwapData::Omnipair(())) => {
                crate::omnipair::Omnipair::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    &(),
                    signer_seeds,
                )
            }

            #[cfg(feature = "hadron-swap")]
            (SwapContext::Hadron(accounts), SwapData::Hadron(d)) => {
                crate::hadron::Hadron::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "raydium-cpmm-swap")]
            (SwapContext::RaydiumCpmm(accounts), SwapData::RaydiumCpmm(())) => {
                crate::raydium_cpmm::RaydiumCpmm::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    &(),
                    signer_seeds,
                )
            }

            #[cfg(feature = "raydium-cpmm-devnet-swap")]
            (SwapContext::RaydiumCpmmDevnet(accounts), SwapData::RaydiumCpmmDevnet(())) => {
                crate::raydium_cpmm_devnet::RaydiumCpmmDevnet::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    &(),
                    signer_seeds,
                )
            }

            #[cfg(feature = "raydium-clmm-swap")]
            (SwapContext::RaydiumClmm(accounts), SwapData::RaydiumClmm(d)) => {
                crate::raydium_clmm::RaydiumClmm::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "raydium-amm-v4-swap")]
            (SwapContext::RaydiumAmmV4(accounts), SwapData::RaydiumAmmV4(())) => {
                crate::raydium_amm_v4::RaydiumAmmV4::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    &(),
                    signer_seeds,
                )
            }

            #[cfg(feature = "orca-whirlpools-swap")]
            (SwapContext::OrcaWhirlpools(accounts), SwapData::OrcaWhirlpools(d)) => {
                crate::orca_whirlpools::OrcaWhirlpools::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "meteora-dlmm-swap")]
            (SwapContext::MeteoraDlmm(accounts), SwapData::MeteoraDlmm(d)) => {
                crate::meteora_dlmm::MeteoraDlmm::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "meteora-damm-v2-swap")]
            (SwapContext::MeteoraDammV2(accounts), SwapData::MeteoraDammV2(d)) => {
                crate::meteora_damm_v2::MeteoraDammV2::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "phoenix-swap")]
            (SwapContext::Phoenix(accounts), SwapData::Phoenix(d)) => {
                crate::phoenix::Phoenix::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[cfg(feature = "openbook-v2-swap")]
            (SwapContext::OpenbookV2(accounts), SwapData::OpenbookV2(d)) => {
                crate::openbook_v2::OpenbookV2::swap_signed(
                    accounts,
                    in_amount,
                    minimum_out_amount,
                    d,
                    signer_seeds,
                )
            }

            #[allow(unreachable_patterns)]
            _ => Err(ProgramError::InvalidAccountData),
        }
    }

    fn swap(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        data: &Self::Data,
    ) -> ProgramResult {
        Self::swap_signed(ctx, in_amount, minimum_out_amount, data, &[])
    }
}

/// Detect the protocol from the first account, parse the swap context,
/// and return both the context and the remaining (unconsumed) accounts.
pub fn try_from_swap_context<'info>(
    accounts: &'info [AccountView],
) -> Result<(SwapContext<'info>, &'info [AccountView]), ProgramError> {
    let detector_account = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;

    #[cfg(feature = "perena-swap")]
    if address_eq(
        detector_account.address(),
        &crate::perena::PERENA_PROGRAM_ID,
    ) {
        let (mine, rest) =
            split_accounts_checked(accounts, crate::perena::PerenaSwapAccounts::NUM_ACCOUNTS)?;
        let ctx = crate::perena::PerenaSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::Perena(ctx), rest));
    }

    #[cfg(feature = "solfi-swap")]
    if address_eq(detector_account.address(), &crate::solfi::SOLFI_PROGRAM_ID) {
        let (mine, rest) =
            split_accounts_checked(accounts, crate::solfi::SolFiSwapAccounts::NUM_ACCOUNTS)?;
        let ctx = crate::solfi::SolFiSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::SolFi(ctx), rest));
    }

    #[cfg(feature = "solfi_v2-swap")]
    if address_eq(
        detector_account.address(),
        &crate::solfi_v2::SOLFI_V2_PROGRAM_ID,
    ) {
        let (mine, rest) =
            split_accounts_checked(accounts, crate::solfi_v2::SolFiV2SwapAccounts::NUM_ACCOUNTS)?;
        let ctx = crate::solfi_v2::SolFiV2SwapAccounts::try_from(mine)?;
        return Ok((SwapContext::SolFiV2(ctx), rest));
    }

    #[cfg(feature = "manifest-swap")]
    if address_eq(
        detector_account.address(),
        &crate::manifest::MANIFEST_PROGRAM_ID,
    ) {
        let (mine, rest) = split_accounts_checked(
            accounts,
            crate::manifest::ManifestSwapAccounts::NUM_ACCOUNTS,
        )?;
        let ctx = crate::manifest::ManifestSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::Manifest(ctx), rest));
    }

    #[cfg(feature = "heaven-swap")]
    if address_eq(
        detector_account.address(),
        &crate::heaven::HEAVEN_PROGRAM_ID,
    ) {
        let (mine, rest) =
            split_accounts_checked(accounts, crate::heaven::HeavenSwapAccounts::NUM_ACCOUNTS)?;
        let ctx = crate::heaven::HeavenSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::Heaven(ctx), rest));
    }

    #[cfg(feature = "aldrin-swap")]
    if address_eq(
        detector_account.address(),
        &crate::aldrin::ALDRIN_PROGRAM_ID,
    ) {
        let (mine, rest) =
            split_accounts_checked(accounts, crate::aldrin::AldrinSwapAccounts::NUM_ACCOUNTS)?;
        let ctx = crate::aldrin::AldrinSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::Aldrin(ctx), rest));
    }

    #[cfg(feature = "aldrin_v2-swap")]
    if address_eq(
        detector_account.address(),
        &crate::aldrin_v2::ALDRIN_V2_PROGRAM_ID,
    ) {
        let (mine, rest) = split_accounts_checked(
            accounts,
            crate::aldrin_v2::AldrinV2SwapAccounts::NUM_ACCOUNTS,
        )?;
        let ctx = crate::aldrin_v2::AldrinV2SwapAccounts::try_from(mine)?;
        return Ok((SwapContext::AldrinV2(ctx), rest));
    }

    #[cfg(feature = "futarchy-swap")]
    if address_eq(
        detector_account.address(),
        &crate::futarchy::FUTARCHY_PROGRAM_ID,
    ) {
        let (mine, rest) = split_accounts_checked(
            accounts,
            crate::futarchy::FutarchySwapAccounts::NUM_ACCOUNTS,
        )?;
        let ctx = crate::futarchy::FutarchySwapAccounts::try_from(mine)?;
        return Ok((SwapContext::Futarchy(ctx), rest));
    }

    #[cfg(feature = "gamma-swap")]
    if address_eq(detector_account.address(), &crate::gamma::GAMMA_PROGRAM_ID) {
        let (mine, rest) =
            split_accounts_checked(accounts, crate::gamma::GammaSwapAccounts::NUM_ACCOUNTS)?;
        let ctx = crate::gamma::GammaSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::Gamma(ctx), rest));
    }

    #[cfg(feature = "scale_amm-swap")]
    if address_eq(
        detector_account.address(),
        &crate::scale_amm::SCALE_AMM_PROGRAM_ID,
    ) {
        let (mine, rest) = split_accounts_checked(
            accounts,
            crate::scale_amm::ScaleAmmSwapAccounts::NUM_ACCOUNTS,
        )?;
        let ctx = crate::scale_amm::ScaleAmmSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::ScaleAmm(ctx), rest));
    }

    #[cfg(feature = "scale_vmm-swap")]
    if address_eq(
        detector_account.address(),
        &crate::scale_vmm::SCALE_VMM_PROGRAM_ID,
    ) {
        let (mine, rest) = split_accounts_checked(
            accounts,
            crate::scale_vmm::ScaleVmmSwapAccounts::NUM_ACCOUNTS,
        )?;
        let ctx = crate::scale_vmm::ScaleVmmSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::ScaleVmm(ctx), rest));
    }

    #[cfg(feature = "omnipair-swap")]
    if address_eq(
        detector_account.address(),
        &crate::omnipair::OMNIPAIR_PROGRAM_ID,
    ) {
        let (mine, rest) = split_accounts_checked(
            accounts,
            crate::omnipair::OmnipairSwapAccounts::NUM_ACCOUNTS,
        )?;
        let ctx = crate::omnipair::OmnipairSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::Omnipair(ctx), rest));
    }

    #[cfg(feature = "hadron-swap")]
    if address_eq(
        detector_account.address(),
        &crate::hadron::HADRON_PROGRAM_ID,
    ) {
        let ctx = crate::hadron::HadronSwapAccounts::try_from(accounts)?;
        return Ok((SwapContext::Hadron(ctx), &[]));
    }

    #[cfg(feature = "raydium-cpmm-swap")]
    if address_eq(
        detector_account.address(),
        &crate::raydium_cpmm::RAYDIUM_CPMM_PROGRAM_ID,
    ) {
        let (mine, rest) = split_accounts_checked(
            accounts,
            crate::raydium_cpmm::RaydiumCpmmSwapAccounts::NUM_ACCOUNTS,
        )?;
        let ctx = crate::raydium_cpmm::RaydiumCpmmSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::RaydiumCpmm(ctx), rest));
    }

    #[cfg(feature = "raydium-cpmm-devnet-swap")]
    if address_eq(
        detector_account.address(),
        &crate::raydium_cpmm_devnet::RAYDIUM_CPMM_DEVNET_PROGRAM_ID,
    ) {
        let (mine, rest) = split_accounts_checked(
            accounts,
            crate::raydium_cpmm_devnet::RaydiumCpmmDevnetSwapAccounts::NUM_ACCOUNTS,
        )?;
        let ctx = crate::raydium_cpmm_devnet::RaydiumCpmmDevnetSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::RaydiumCpmmDevnet(ctx), rest));
    }

    #[cfg(feature = "raydium-clmm-swap")]
    if address_eq(
        detector_account.address(),
        &crate::raydium_clmm::RAYDIUM_CLMM_PROGRAM_ID,
    ) {
        // CLMM has variable-length tick_array tail in remaining_accounts.
        let ctx = crate::raydium_clmm::RaydiumClmmSwapAccounts::try_from(accounts)?;
        return Ok((SwapContext::RaydiumClmm(ctx), &[]));
    }

    #[cfg(feature = "raydium-amm-v4-swap")]
    if address_eq(
        detector_account.address(),
        &crate::raydium_amm_v4::RAYDIUM_AMM_V4_PROGRAM_ID,
    ) {
        let (mine, rest) = split_accounts_checked(
            accounts,
            crate::raydium_amm_v4::RaydiumAmmV4SwapAccounts::NUM_ACCOUNTS,
        )?;
        let ctx = crate::raydium_amm_v4::RaydiumAmmV4SwapAccounts::try_from(mine)?;
        return Ok((SwapContext::RaydiumAmmV4(ctx), rest));
    }

    #[cfg(feature = "orca-whirlpools-swap")]
    if address_eq(
        detector_account.address(),
        &crate::orca_whirlpools::ORCA_WHIRLPOOLS_PROGRAM_ID,
    ) {
        let (mine, rest) = split_accounts_checked(
            accounts,
            crate::orca_whirlpools::OrcaWhirlpoolsSwapAccounts::NUM_ACCOUNTS,
        )?;
        let ctx = crate::orca_whirlpools::OrcaWhirlpoolsSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::OrcaWhirlpools(ctx), rest));
    }

    #[cfg(feature = "meteora-dlmm-swap")]
    if address_eq(
        detector_account.address(),
        &crate::meteora_dlmm::METEORA_DLMM_PROGRAM_ID,
    ) {
        // DLMM has variable-length bin_array tail.
        let ctx = crate::meteora_dlmm::MeteoraDlmmSwapAccounts::try_from(accounts)?;
        return Ok((SwapContext::MeteoraDlmm(ctx), &[]));
    }

    #[cfg(feature = "meteora-damm-v2-swap")]
    if address_eq(
        detector_account.address(),
        &crate::meteora_damm_v2::METEORA_DAMM_V2_PROGRAM_ID,
    ) {
        let (mine, rest) = split_accounts_checked(
            accounts,
            crate::meteora_damm_v2::MeteoraDammV2SwapAccounts::NUM_ACCOUNTS,
        )?;
        let ctx = crate::meteora_damm_v2::MeteoraDammV2SwapAccounts::try_from(mine)?;
        return Ok((SwapContext::MeteoraDammV2(ctx), rest));
    }

    #[cfg(feature = "phoenix-swap")]
    if address_eq(
        detector_account.address(),
        &crate::phoenix::PHOENIX_PROGRAM_ID,
    ) {
        let (mine, rest) =
            split_accounts_checked(accounts, crate::phoenix::PhoenixSwapAccounts::NUM_ACCOUNTS)?;
        let ctx = crate::phoenix::PhoenixSwapAccounts::try_from(mine)?;
        return Ok((SwapContext::Phoenix(ctx), rest));
    }

    #[cfg(feature = "openbook-v2-swap")]
    if address_eq(
        detector_account.address(),
        &crate::openbook_v2::OPENBOOK_V2_PROGRAM_ID,
    ) {
        let (mine, rest) = split_accounts_checked(
            accounts,
            crate::openbook_v2::OpenbookV2SwapAccounts::NUM_ACCOUNTS,
        )?;
        let ctx = crate::openbook_v2::OpenbookV2SwapAccounts::try_from(mine)?;
        return Ok((SwapContext::OpenbookV2(ctx), rest));
    }

    Err(ProgramError::InvalidAccountData)
}

pub fn swap_signed(
    accounts: &[AccountView],
    in_amount: u64,
    minimum_out_amount: u64,
    data: &SwapData<'_>,
    signer_seeds: &[Signer],
) -> ProgramResult {
    let (ctx, _remaining) = try_from_swap_context(accounts)?;
    SwapContext::swap_signed(&ctx, in_amount, minimum_out_amount, data, signer_seeds)
}

pub fn swap(
    accounts: &[AccountView],
    in_amount: u64,
    minimum_out_amount: u64,
    data: &SwapData<'_>,
) -> ProgramResult {
    swap_signed(accounts, in_amount, minimum_out_amount, data, &[])
}

// Deposit context - similar pattern
use crate::Deposit;

pub enum DepositContext<'info> {
    #[cfg(feature = "kamino-deposit")]
    Kamino(crate::kamino::KaminoDepositAccounts<'info>),

    #[cfg(feature = "jupiter-deposit")]
    Jupiter(crate::jupiter::JupiterEarnDepositAccounts<'info>),

    #[cfg(feature = "marginfi-deposit")]
    Marginfi(crate::marginfi::MarginfiDepositAccounts<'info>),

    #[cfg(feature = "marinade-deposit")]
    Marinade(crate::marinade::MarinadeDepositAccounts<'info>),

    #[cfg(feature = "solend-deposit")]
    Solend(crate::solend::SolendDepositAccounts<'info>),

    #[cfg(feature = "spl-stake-pool-deposit")]
    SplStakePool(crate::spl_stake_pool::SplStakePoolDepositSolAccounts<'info>),

    #[cfg(feature = "meteora-vaults-deposit")]
    MeteoraVaults(crate::meteora_vaults::MeteoraVaultsDepositAccounts<'info>),
}

/// Protocol-specific deposit data enum for use with DepositContext
pub enum DepositData {
    #[cfg(feature = "kamino-deposit")]
    Kamino(()),
    #[cfg(feature = "jupiter-deposit")]
    Jupiter(()),
    #[cfg(feature = "marginfi-deposit")]
    Marginfi(crate::marginfi::MarginfiDepositData),
    #[cfg(feature = "marinade-deposit")]
    Marinade(crate::marinade::MarinadeDepositData),
    #[cfg(feature = "solend-deposit")]
    Solend(()),
    #[cfg(feature = "spl-stake-pool-deposit")]
    SplStakePool(crate::spl_stake_pool::SplStakePoolDepositSolData),
    #[cfg(feature = "meteora-vaults-deposit")]
    MeteoraVaults(crate::meteora_vaults::MeteoraVaultsDepositData),
}

impl<'a> DepositContext<'a> {
    pub fn try_from_deposit_data(
        &self,
        data: &'a [u8],
    ) -> Result<(DepositData, &'a [u8]), ProgramError> {
        match self {
            #[cfg(feature = "kamino-deposit")]
            DepositContext::Kamino(_) => Ok((DepositData::Kamino(()), &[])),

            #[cfg(feature = "jupiter-deposit")]
            DepositContext::Jupiter(_) => Ok((DepositData::Jupiter(()), &[])),

            #[cfg(feature = "marginfi-deposit")]
            DepositContext::Marginfi(_) => Ok((
                DepositData::Marginfi(crate::marginfi::MarginfiDepositData::try_from(data)?),
                &[],
            )),

            #[cfg(feature = "marinade-deposit")]
            DepositContext::Marinade(_) => Ok((
                DepositData::Marinade(crate::marinade::MarinadeDepositData),
                &[],
            )),

            #[cfg(feature = "solend-deposit")]
            DepositContext::Solend(_) => Ok((DepositData::Solend(()), &[])),

            #[cfg(feature = "spl-stake-pool-deposit")]
            DepositContext::SplStakePool(_) => Ok((
                DepositData::SplStakePool(
                    crate::spl_stake_pool::SplStakePoolDepositSolData::try_from(data)?,
                ),
                &[],
            )),

            #[cfg(feature = "meteora-vaults-deposit")]
            DepositContext::MeteoraVaults(_) => Ok((
                DepositData::MeteoraVaults(
                    crate::meteora_vaults::MeteoraVaultsDepositData::try_from(data)?,
                ),
                &[],
            )),

            #[allow(unreachable_patterns)]
            _ => Err(ProgramError::InvalidAccountData),
        }
    }
}

impl<'info> Deposit<'info> for DepositContext<'info> {
    type Accounts = Self;
    type Data = DepositData;

    fn deposit_signed(
        ctx: &Self::Accounts,
        amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        match ctx {
            #[cfg(feature = "kamino-deposit")]
            DepositContext::Kamino(accounts) => {
                crate::kamino::Kamino::deposit_signed(accounts, amount, &(), signer_seeds)
            }

            #[cfg(feature = "jupiter-deposit")]
            DepositContext::Jupiter(accounts) => {
                crate::jupiter::JupiterEarn::deposit_signed(accounts, amount, &(), signer_seeds)
            }

            #[cfg(feature = "marginfi-deposit")]
            DepositContext::Marginfi(accounts) => {
                if let DepositData::Marginfi(data) = data {
                    crate::marginfi::Marginfi::deposit_signed(accounts, amount, data, signer_seeds)
                } else {
                    Err(ProgramError::InvalidInstructionData)
                }
            }

            #[cfg(feature = "marinade-deposit")]
            DepositContext::Marinade(accounts) => {
                if let DepositData::Marinade(d) = data {
                    crate::marinade::Marinade::deposit_signed(accounts, amount, d, signer_seeds)
                } else {
                    Err(ProgramError::InvalidInstructionData)
                }
            }

            #[cfg(feature = "solend-deposit")]
            DepositContext::Solend(accounts) => {
                crate::solend::Solend::deposit_signed(accounts, amount, &(), signer_seeds)
            }

            #[cfg(feature = "spl-stake-pool-deposit")]
            DepositContext::SplStakePool(accounts) => {
                if let DepositData::SplStakePool(d) = data {
                    crate::spl_stake_pool::SplStakePool::deposit_signed(
                        accounts,
                        amount,
                        d,
                        signer_seeds,
                    )
                } else {
                    Err(ProgramError::InvalidInstructionData)
                }
            }

            #[cfg(feature = "meteora-vaults-deposit")]
            DepositContext::MeteoraVaults(accounts) => {
                if let DepositData::MeteoraVaults(d) = data {
                    crate::meteora_vaults::MeteoraVaults::deposit_signed(
                        accounts,
                        amount,
                        d,
                        signer_seeds,
                    )
                } else {
                    Err(ProgramError::InvalidInstructionData)
                }
            }

            #[allow(unreachable_patterns)]
            _ => Err(ProgramError::InvalidAccountData),
        }
    }

    fn deposit(ctx: &Self::Accounts, amount: u64, data: &Self::Data) -> ProgramResult {
        Self::deposit_signed(ctx, amount, data, &[])
    }
}

pub fn try_from_deposit_context<'info>(
    accounts: &'info [AccountView],
) -> Result<DepositContext<'info>, ProgramError> {
    let detector_account = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;

    #[cfg(feature = "kamino-deposit")]
    if address_eq(
        detector_account.address(),
        &crate::kamino::KAMINO_LEND_PROGRAM_ID,
    ) {
        let ctx = crate::kamino::KaminoDepositAccounts::try_from(accounts)?;
        return Ok(DepositContext::Kamino(ctx));
    }

    #[cfg(feature = "jupiter-deposit")]
    if address_eq(
        detector_account.address(),
        &crate::jupiter::JUPITER_EARN_PROGRAM_ID,
    ) {
        let ctx = crate::jupiter::JupiterEarnDepositAccounts::try_from(accounts)?;
        return Ok(DepositContext::Jupiter(ctx));
    }

    #[cfg(feature = "marginfi-deposit")]
    if address_eq(
        detector_account.address(),
        &crate::marginfi::MARGINFI_PROGRAM_ID,
    ) {
        let ctx = crate::marginfi::MarginfiDepositAccounts::try_from(accounts)?;
        return Ok(DepositContext::Marginfi(ctx));
    }

    #[cfg(feature = "marinade-deposit")]
    if address_eq(
        detector_account.address(),
        &crate::marinade::MARINADE_PROGRAM_ID,
    ) {
        let ctx = crate::marinade::MarinadeDepositAccounts::try_from(accounts)?;
        return Ok(DepositContext::Marinade(ctx));
    }

    #[cfg(feature = "solend-deposit")]
    if address_eq(
        detector_account.address(),
        &crate::solend::SOLEND_PROGRAM_ID,
    ) {
        let ctx = crate::solend::SolendDepositAccounts::try_from(accounts)?;
        return Ok(DepositContext::Solend(ctx));
    }

    #[cfg(feature = "spl-stake-pool-deposit")]
    if address_eq(
        detector_account.address(),
        &crate::spl_stake_pool::SPL_STAKE_POOL_PROGRAM_ID,
    ) {
        let ctx = crate::spl_stake_pool::SplStakePoolDepositSolAccounts::try_from(accounts)?;
        return Ok(DepositContext::SplStakePool(ctx));
    }

    #[cfg(feature = "meteora-vaults-deposit")]
    if address_eq(
        detector_account.address(),
        &crate::meteora_vaults::METEORA_VAULTS_PROGRAM_ID,
    ) {
        let ctx = crate::meteora_vaults::MeteoraVaultsDepositAccounts::try_from(accounts)?;
        return Ok(DepositContext::MeteoraVaults(ctx));
    }

    Err(ProgramError::InvalidAccountData)
}

// ─── Perps context ────────────────────────────────────────────────────────
//
// Mirrors the Swap/Deposit pattern for perpetual-futures operations.
// Mango v4 + Zeta wired today. The entire block is cfg-gated on "any perps
// protocol enabled" so builds without a perps feature simply omit
// PerpsContext + its dispatcher.
#[cfg(any(feature = "mango-perps", feature = "zeta-perps"))]
pub use perps_ctx::*;

#[cfg(any(feature = "mango-perps", feature = "zeta-perps"))]
mod perps_ctx {
    use super::*;
    use crate::Perps;

    pub enum PerpsContext<'info> {
        #[cfg(feature = "mango-perps")]
        Mango(crate::mango::MangoPlaceOrderAccounts<'info>),
        #[cfg(feature = "zeta-perps")]
        Zeta(crate::zeta::ZetaPlacePerpOrderAccounts<'info>),
    }

    pub enum PerpsData {
        #[cfg(feature = "mango-perps")]
        Mango(crate::mango::MangoPlaceOrderData),
        #[cfg(feature = "zeta-perps")]
        Zeta(crate::zeta::ZetaPlacePerpOrderData),
    }

    impl<'info> Perps<'info> for PerpsContext<'info> {
        type Accounts = Self;
        type Data = PerpsData;

        fn place_order_signed(
            ctx: &Self::Accounts,
            data: &Self::Data,
            signer_seeds: &[Signer],
        ) -> ProgramResult {
            match (ctx, data) {
                #[cfg(feature = "mango-perps")]
                (PerpsContext::Mango(accounts), PerpsData::Mango(d)) => {
                    crate::mango::Mango::place_order_signed(accounts, d, signer_seeds)
                }
                #[cfg(feature = "zeta-perps")]
                (PerpsContext::Zeta(accounts), PerpsData::Zeta(d)) => {
                    crate::zeta::Zeta::place_order_signed(accounts, d, signer_seeds)
                }
                #[allow(unreachable_patterns)]
                _ => Err(ProgramError::InvalidAccountData),
            }
        }

        fn place_order(ctx: &Self::Accounts, data: &Self::Data) -> ProgramResult {
            Self::place_order_signed(ctx, data, &[])
        }
    }

    /// Detect the perps protocol from the first remaining account and return
    /// a typed context. Callers feed the `remaining_accounts` slice in
    /// directly — first account is always the target program id.
    pub fn try_from_perps_context<'info>(
        accounts: &'info [AccountView],
    ) -> Result<PerpsContext<'info>, ProgramError> {
        let detector_account = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;

        #[cfg(feature = "mango-perps")]
        if address_eq(
            detector_account.address(),
            &crate::mango::MANGO_V4_PROGRAM_ID,
        ) {
            let ctx = crate::mango::MangoPlaceOrderAccounts::try_from(accounts)?;
            return Ok(PerpsContext::Mango(ctx));
        }

        #[cfg(feature = "zeta-perps")]
        if address_eq(detector_account.address(), &crate::zeta::ZETA_PROGRAM_ID) {
            let ctx = crate::zeta::ZetaPlacePerpOrderAccounts::try_from(accounts)?;
            return Ok(PerpsContext::Zeta(ctx));
        }

        let _ = detector_account;
        Err(ProgramError::InvalidAccountData)
    }
}

// ─── DepositInit context ──────────────────────────────────────────────────
//
// For protocols whose deposit path needs a per-user state account
// (obligation, metadata, margin account) created once before any deposit.
// Gated on "any deposit-init-capable protocol enabled" (today: kamino,
// marginfi). Jupiter is intentionally NOT included — see its crate-level
// doc comment for the rationale (it composes Kamino-style state under the
// hood and uses standard ATAs for the user position).
#[cfg(any(feature = "kamino-deposit", feature = "marginfi-deposit"))]
pub use deposit_init_ctx::*;

#[cfg(any(feature = "kamino-deposit", feature = "marginfi-deposit"))]
mod deposit_init_ctx {
    use super::*;
    use crate::DepositInit;

    pub enum DepositInitContext<'info> {
        #[cfg(feature = "kamino-deposit")]
        Kamino(crate::kamino::KaminoInitAccounts<'info>),

        #[cfg(feature = "marginfi-deposit")]
        Marginfi(crate::marginfi::MarginfiInitAccounts<'info>),
    }

    impl<'info> DepositInit<'info> for DepositInitContext<'info> {
        type Accounts = Self;

        fn init_signed(ctx: &Self::Accounts, signer_seeds: &[Signer]) -> ProgramResult {
            match ctx {
                #[cfg(feature = "kamino-deposit")]
                DepositInitContext::Kamino(accounts) => {
                    crate::kamino::Kamino::init_signed(accounts, signer_seeds)
                }
                #[cfg(feature = "marginfi-deposit")]
                DepositInitContext::Marginfi(accounts) => {
                    crate::marginfi::Marginfi::init_signed(accounts, signer_seeds)
                }
                #[allow(unreachable_patterns)]
                _ => Err(ProgramError::InvalidAccountData),
            }
        }

        fn init(ctx: &Self::Accounts) -> ProgramResult {
            Self::init_signed(ctx, &[])
        }
    }

    pub fn try_from_deposit_init_context<'info>(
        accounts: &'info [AccountView],
    ) -> Result<DepositInitContext<'info>, ProgramError> {
        let detector_account = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;

        #[cfg(feature = "kamino-deposit")]
        if address_eq(
            detector_account.address(),
            &crate::kamino::KAMINO_LEND_PROGRAM_ID,
        ) {
            let ctx = crate::kamino::KaminoInitAccounts::try_from(accounts)?;
            return Ok(DepositInitContext::Kamino(ctx));
        }

        #[cfg(feature = "marginfi-deposit")]
        if address_eq(
            detector_account.address(),
            &crate::marginfi::MARGINFI_PROGRAM_ID,
        ) {
            let ctx = crate::marginfi::MarginfiInitAccounts::try_from(accounts)?;
            return Ok(DepositInitContext::Marginfi(ctx));
        }

        let _ = detector_account;
        Err(ProgramError::InvalidAccountData)
    }
}
