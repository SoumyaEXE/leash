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
    #[msg("Amount exceeds the vault's rolling 24h cap")]
    ExceedsDailyCap,
    #[msg("Amount needs owner co-signature (single payment or 24h autonomous total over the threshold); submit a spend request")]
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
    // ── appended Nov 7 (path-to-10, T1-T13) ──
    #[msg("The agent key must be different from the owner key")]
    AgentIsOwner,
    #[msg("Unsupported mint: Token-2022 fee, hook, permanent delegate, pausable, default state, non-transferable, close authority or scaled amounts, or more than 18 decimals")]
    UnsupportedMint,
    #[msg("Too many open spend requests; the owner must approve or reject one first")]
    TooManyOpenRequests,
    #[msg("Spend request has not expired yet")]
    RequestNotExpired,
    #[msg("Spend request belongs to another vault")]
    RequestVaultMismatch,
    #[msg("Vault still holds tokens; withdraw them first")]
    VaultNotEmpty,
    #[msg("Close the vault's payees, mandates and open requests first")]
    VaultHasOpenAccounts,
    #[msg("Mandate signature was already used or cancelled (nonce is not the vault's current mandate sequence)")]
    StaleMandateNonce,
    #[msg("Mandate intent must be 1-100 printable ASCII characters")]
    InvalidIntent,
    #[msg("New mandate sequence must be greater than the current one")]
    MandateSeqNotIncreasing,
    #[msg("A vault can't be closed in the same second it was opened")]
    VaultJustOpened,
}

impl LeashError {
    /// Full Anchor error number (6000 + index), used as `reason_code` in `PaymentBlocked`.
    pub fn number(self) -> u16 {
        (anchor_lang::error::ERROR_CODE_OFFSET + self as u32) as u16
    }
}
