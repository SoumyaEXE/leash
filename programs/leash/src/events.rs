use anchor_lang::prelude::*;

use crate::state::AuthKind;

#[event]
pub struct SpendExecuted {
    pub vault: Pubkey,
    pub payee: Pubkey,
    pub amount: u64,
    pub reason_hash: [u8; 32],
    pub memo: Option<[u8; 32]>,
    pub via: AuthKind,
    pub ts: i64,
    /// The co-signed SpendRequest this payment settles (approve_request), so a verifier can bind the payment to it.
    pub request: Option<Pubkey>,
}

#[event]
pub struct SpendRequested {
    pub vault: Pubkey,
    pub request: Pubkey,
    pub payee: Pubkey,
    pub amount: u64,
    pub reason_hash: [u8; 32],
    pub ts: i64,
}

#[event]
pub struct RequestResolved {
    pub vault: Pubkey,
    pub request: Pubkey,
    pub approved: bool,
    pub ts: i64,
}

#[event]
pub struct PolicyUpdated {
    pub vault: Pubkey,
    pub ts: i64,
}

#[event]
pub struct PayeeChanged {
    pub vault: Pubkey,
    pub payee: Pubkey,
    pub active: bool,
    pub removed: bool,
    pub ts: i64,
}

#[event]
pub struct MandateCreated {
    pub vault: Pubkey,
    pub mandate: Pubkey,
    pub payee: Pubkey,
    pub max_total: u64,
    pub expires_at: i64,
    pub intent_hash: [u8; 32],
    /// true when created from an off-chain owner signature (redeem_signed_mandate)
    pub signed_offchain: bool,
}

#[event]
pub struct MandateRevoked {
    pub vault: Pubkey,
    pub mandate: Pubkey,
    pub ts: i64,
}

#[event]
pub struct VaultPausedChanged {
    pub vault: Pubkey,
    pub paused: bool,
    pub ts: i64,
}

/// guarded_spend refused a payment without reverting: the strike is now onchain.
#[event]
pub struct PaymentBlocked {
    pub vault: Pubkey,
    pub attempted_payee: Pubkey,
    pub amount: u64,
    /// Leash error number (e.g. 6004 = PayeeNotAuthorized)
    pub reason_code: u16,
    pub reason_hash: [u8; 32],
    pub blocked_count: u64,
    pub strikes: u8,
    pub ts: i64,
    /// true = unauthorized attempt (unknown payee or redirected recipient) that counted as a strike;
    /// false = benign block (cap, budget, expiry...) recorded without a strike.
    pub strike: bool,
}

#[event]
pub struct VaultFrozen {
    pub vault: Pubkey,
    pub strikes: u8,
    pub ts: i64,
}

/// Owner moved funds out of the vault.
#[event]
pub struct Withdrawn {
    pub vault: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub ts: i64,
}

/// Owner cancelled every unredeemed signed mandate with a nonce below `mandate_seq`.
#[event]
pub struct MandateSeqBumped {
    pub vault: Pubkey,
    pub mandate_seq: u64,
    pub ts: i64,
}

#[event]
pub struct MandateClosed {
    pub vault: Pubkey,
    pub mandate: Pubkey,
    pub ts: i64,
}

/// An expired spend request was closed (permissionless crank); rent went back to the agent.
#[event]
pub struct RequestClosed {
    pub vault: Pubkey,
    pub request: Pubkey,
    pub ts: i64,
}

#[event]
pub struct VaultClosed {
    pub vault: Pubkey,
    pub ts: i64,
}
