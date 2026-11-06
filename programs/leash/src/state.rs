use anchor_lang::prelude::*;

pub const VAULT_SEED: &[u8] = b"vault";
pub const PAYEE_SEED: &[u8] = b"payee";
pub const MANDATE_SEED: &[u8] = b"mandate";
pub const REQUEST_SEED: &[u8] = b"request";

pub const WINDOW_SECS: i64 = 86_400;
pub const MAX_LABEL_LEN: usize = 32;

/// Domain tag of an owner-signed mandate. The owner signs the UTF-8 bytes
/// `"LEASH_MANDATE_V1:" || hex(borsh(MandateTerms))` with a plain wallet `signMessage`.
pub const MANDATE_MESSAGE_PREFIX: &[u8] = b"LEASH_MANDATE_V1:";

/// The agent's funds, and every rule that governs them.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// Human owner: the root of trust. Only this key changes policy or approves.
    pub owner: Pubkey,
    /// Agent signing key: may *request* payments, never authorize them. Holds only fee SOL.
    pub agent: Pubkey,
    /// One mint per vault (dUSDC on devnet).
    pub mint: Pubkey,
    pub vault_id: u64,
    /// Kill switch.
    pub paused: bool,
    pub per_tx_cap: u64,
    /// Rolling 24h cap.
    pub daily_cap: u64,
    pub window_start: i64,
    pub spent_in_window: u64,
    /// amount >= this needs an owner co-sign (spend request). 0 = disabled.
    pub cosign_threshold: u64,
    pub request_ttl_secs: i64,
    pub request_seq: u64,
    pub mandate_seq: u64,
    pub total_spent: u64,
    /// Tripwire (guarded_spend): counts every refused attempt, readable by anyone.
    pub blocked_count: u64,
    pub strikes: u8,
    /// Auto-pause after this many strikes. 0 = never.
    pub freeze_after_strikes: u8,
    pub last_blocked_at: i64,
    pub bump: u8,
}

/// An owner-approved payee with its own budget (e.g. one x402 service).
#[account]
#[derive(InitSpace)]
pub struct Payee {
    pub vault: Pubkey,
    /// Wallet that receives; payments go to its token account for the vault mint.
    pub payee: Pubkey,
    #[max_len(32)]
    pub label: String,
    pub per_tx_max: u64,
    /// Lifetime budget for this payee. 0 = unlimited within the vault caps.
    pub budget_total: u64,
    pub spent: u64,
    pub active: bool,
    pub bump: u8,
}

/// Owner-signed intent for a payee that is not on the allowlist.
#[account]
#[derive(InitSpace)]
pub struct Mandate {
    pub vault: Pubkey,
    pub id: u64,
    pub payee: Pubkey,
    pub max_total: u64,
    pub max_per_tx: u64,
    pub spent: u64,
    pub expires_at: i64,
    /// sha256 of the human-readable intent text (shown in the dashboard).
    pub intent_hash: [u8; 32],
    pub revoked: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum RequestStatus {
    Pending,
    Approved,
    Rejected,
    Expired,
}

/// A payment over the co-sign threshold, waiting for the owner (approved via a Blink).
#[account]
#[derive(InitSpace)]
pub struct SpendRequest {
    pub vault: Pubkey,
    pub seq: u64,
    pub payee: Pubkey,
    pub amount: u64,
    pub reason_hash: [u8; 32],
    pub created_at: i64,
    pub expires_at: i64,
    pub status: RequestStatus,
    pub bump: u8,
    /// x402 payment nonce carried through to the SpendExecuted event when the owner approves.
    pub memo: Option<[u8; 32]>,
}

/// Vault policy, set at init and by `update_policy`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct Policy {
    pub per_tx_cap: u64,
    pub daily_cap: u64,
    pub cosign_threshold: u64,
    pub request_ttl_secs: i64,
    pub freeze_after_strikes: u8,
}

/// Terms the owner signs off-chain for `redeem_signed_mandate`.
/// `nonce` must equal `vault.mandate_seq`, which makes every signature single-use.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct MandateTerms {
    pub vault: Pubkey,
    pub payee: Pubkey,
    pub max_total: u64,
    pub max_per_tx: u64,
    pub expires_at: i64,
    pub intent_hash: [u8; 32],
    pub nonce: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum AuthKind {
    Payee,
    Mandate,
    Request,
}
