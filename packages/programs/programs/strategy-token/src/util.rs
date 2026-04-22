use crate::error;
use pinocchio::{account::AccountView, address::Address, error::ProgramError};

#[inline(always)]
pub fn assert_signer(account: &AccountView) -> Result<(), ProgramError> {
    if !account.is_signer() {
        return Err(error::err(error::ERROR_ACCOUNT_NOT_SIGNER));
    }
    Ok(())
}

#[inline(always)]
pub fn assert_writable(account: &AccountView) -> Result<(), ProgramError> {
    if !account.is_writable() {
        return Err(error::err(error::ERROR_ACCOUNT_NOT_WRITABLE));
    }
    Ok(())
}

#[inline(always)]
pub fn assert_owned_by(account: &AccountView, owner: &Address) -> Result<(), ProgramError> {
    if !account.owned_by(owner) {
        return Err(ProgramError::IllegalOwner);
    }
    Ok(())
}

#[inline(always)]
pub fn assert_keys_equal(a: &Address, b: &Address) -> Result<(), ProgramError> {
    if a != b {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}
