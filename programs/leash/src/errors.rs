use anchor_lang::prelude::*;

/// Codes start at 6000 in declaration order. packages/sdk/src/errors.ts mirrors this list:
/// append only, never reorder.
#[error_code]
pub enum LeashError {
    #[msg("Signer is not this vault's agent")]
    NotAgent,
    #[msg("Vault is paused by its owner")]
    VaultPaused,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Recipient token account does not match the authorized payee or mint")]
    RecipientMismatch,
    #[msg("Payee is not on the owner's allowlist and no mandate covers it")]
    PayeeNotAuthorized,
    #[msg("Amount exceeds this payee's per-transaction maximum")]
    ExceedsPayeePerTx,
    #[msg("This payee's budget is used up")]
    PayeeBudgetExceeded,
    #[msg("Mandate has expired")]
    MandateExpired,
    #[msg("Mandate was revoked by the owner")]
    MandateRevoked,
    #[msg("Mandate amount is used up")]
    MandateExhausted,
    #[msg("Amount exceeds the vault's per-transaction cap")]
    ExceedsPerTxCap,
    #[msg("Amount exceeds the vault's 24h cap")]
    ExceedsDailyCap,
    #[msg("Amount needs owner co-signature; submit a spend request")]
    RequiresCosign,
    #[msg("Spend request is not pending")]
    RequestNotPending,
    #[msg("Spend request has expired")]
    RequestExpired,
    #[msg("Mandate signature is missing or invalid")]
    InvalidMandateSignature,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Only the vault owner can do this")]
    NotOwner,
    #[msg("Invalid policy: caps must be positive and the 24h cap at least the per-tx cap")]
    InvalidPolicy,
    #[msg("Payee label is longer than 32 bytes")]
    LabelTooLong,
    #[msg("Vault balance is too low for this payment")]
    InsufficientFunds,
    #[msg("Invalid mandate terms: limits must be positive and expiry in the future")]
    InvalidMandateTerms,
}

impl LeashError {
    /// Full Anchor error number (6000 + index), used as `reason_code` in `PaymentBlocked`.
    pub fn number(self) -> u16 {
        (anchor_lang::error::ERROR_CODE_OFFSET + self as u32) as u16
    }
}
