use anchor_lang::prelude::*;

pub const VAULT_SEED: &[u8] = b"vault";
pub const PAYEE_SEED: &[u8] = b"payee";
pub const MANDATE_SEED: &[u8] = b"mandate";
pub const REQUEST_SEED: &[u8] = b"request";

/// Length of the spending window and of the tripwire strike window.
pub const WINDOW_SECS: i64 = 86_400;
/// Rolling-window granularity. Spends are bucketed by hour; the 24h sums cover the current hour plus the 24 before
/// it, so a payment counts against the caps for at least 24h and at most 25h. No 24h period can ever see more than
/// `daily_cap` leave the vault.
pub const BUCKET_SECS: i64 = 3_600;
pub const BUCKETS: usize = 25; // literal 25 in the account fields below (IDL arrays need a literal length)

pub const MAX_LABEL_LEN: usize = 32;
/// Open (unresolved) spend requests per vault. Resolving or closing one frees a slot.
pub const MAX_OPEN_REQUESTS: u16 = 8;
/// Mint decimals above this are refused at init (UI amounts in signed mandates must stay exact).
pub const MAX_MINT_DECIMALS: u8 = 18;

/// Header line of an owner-signed mandate message (see `mandate_msg::mandate_message`).
pub const MANDATE_HEADER: &str = "Leash spending mandate v2";
/// Intent text in a signed mandate: 1..=100 bytes of printable ASCII (0x20..=0x7e), no newlines. 100 keeps the
/// `[Ed25519 ix, redeem_signed_mandate]` transaction under 1232 bytes even with 20-digit amounts and nonce.
pub const MAX_INTENT_LEN: usize = 100;
/// Latest accepted mandate expiry (9999-12-31T23:59:59Z), so the ISO date in the message always has 4 year digits.
pub const MAX_EXPIRES_AT: i64 = 253_402_300_799;

/// Cluster tag written into every signed mandate. Onchain code can't read the genesis hash, so the cluster is
/// fixed at compile time: a mainnet build (`--features mainnet`) refuses a message signed for devnet even when the
/// program id and vault address are the same on both clusters.
#[cfg(feature = "mainnet")]
pub const CLUSTER: &str = "mainnet-beta";
#[cfg(not(feature = "mainnet"))]
pub const CLUSTER: &str = "devnet";

/// The agent's funds, and every rule that governs them.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// Human owner: the root of trust. Only this key changes policy or approves.
    pub owner: Pubkey,
    /// Agent signing key: may *request* payments, never authorize them. Holds only fee SOL. Never equal to owner.
    pub agent: Pubkey,
    /// One mint per vault (dUSDC on devnet).
    pub mint: Pubkey,
    pub vault_id: u64,
    /// Unix time the vault was initialized. Part of every signed-mandate message, so a signature for an earlier
    /// vault at the same address (closed, then re-initialized with the same vault_id) never verifies again.
    pub created_at: i64,
    /// Kill switch.
    pub paused: bool,
    pub per_tx_cap: u64,
    /// Rolling 24h cap on everything that leaves the vault (autonomous and co-signed).
    pub daily_cap: u64,
    /// A single payment >= this needs an owner co-sign (spend request). 0 = disabled.
    pub cosign_threshold: u64,
    /// Once the agent's un-co-signed spending in the rolling 24h would reach this, every further payment needs a
    /// co-sign (stops 5 x 0.19 under a 0.20 threshold). 0 = disabled.
    pub cosign_window_threshold: u64,
    pub request_ttl_secs: i64,
    pub request_seq: u64,
    pub mandate_seq: u64,
    pub total_spent: u64,
    /// Every refused attempt recorded by the tripwire (strike or not), readable by anyone.
    pub blocked_count: u64,
    /// Unauthorized attempts (attacker payee / redirected recipient) in the current strike window.
    pub strikes: u8,
    /// Auto-pause after this many strikes within one strike window. 0 = never.
    pub freeze_after_strikes: u8,
    pub last_blocked_at: i64,
    /// Start of the current 24h strike window (set by the first strike after the previous window ran out).
    pub strike_window_start: i64,
    /// When true, `agent_spend` behaves like `guarded_spend`: an attacker holding the agent key can't dodge the
    /// tripwire by picking the strict path.
    pub enforce_tripwire: bool,
    pub open_requests: u16,
    pub open_payees: u16,
    pub open_mandates: u16,
    /// Hour index (unix_ts / 3600) of the newest bucket in both rings.
    pub last_bucket: i64,
    /// Everything paid out, per hour: slot = hour % 25.
    pub spent_buckets: [u64; 25],
    /// Payments the agent made without a co-sign (agent_spend / guarded_spend), per hour: slot = hour % 25.
    pub auto_buckets: [u64; 25],
    pub bump: u8,
}

impl Vault {
    /// Sum of a ring over the rolling 24h ending at `now` (the current hour and the 24 before it).
    pub fn rolling_sum(&self, ring: &[u64; BUCKETS], now: i64) -> u64 {
        let now_hour = now.div_euclid(BUCKET_SECS);
        let oldest = now_hour - (BUCKETS as i64 - 1);
        let mut sum: u64 = 0;
        for (slot, v) in ring.iter().enumerate() {
            // The newest hour <= last_bucket that maps to this slot.
            let back = (self.last_bucket - slot as i64).rem_euclid(BUCKETS as i64);
            let hour = self.last_bucket - back;
            if hour >= oldest {
                sum = sum.saturating_add(*v);
            }
        }
        sum
    }

    pub fn spent_24h(&self, now: i64) -> u64 {
        self.rolling_sum(&self.spent_buckets, now)
    }

    pub fn autonomous_24h(&self, now: i64) -> u64 {
        self.rolling_sum(&self.auto_buckets, now)
    }

    /// Advance both rings to `now`, zeroing the hours that fell out of the window.
    pub fn roll_buckets(&mut self, now: i64) {
        let now_hour = now.div_euclid(BUCKET_SECS);
        if now_hour <= self.last_bucket {
            return; // same hour (or a clock step back: keep counting into the newest bucket)
        }
        let gap = now_hour - self.last_bucket;
        if gap >= BUCKETS as i64 {
            self.spent_buckets = [0; BUCKETS];
            self.auto_buckets = [0; BUCKETS];
        } else {
            for k in 1..=gap {
                let slot = (self.last_bucket + k).rem_euclid(BUCKETS as i64) as usize;
                self.spent_buckets[slot] = 0;
                self.auto_buckets[slot] = 0;
            }
        }
        self.last_bucket = now_hour;
    }

    pub fn current_slot(&self) -> usize {
        self.last_bucket.rem_euclid(BUCKETS as i64) as usize
    }
}

/// An owner-approved payee with its own budget (e.g. one x402 service).
#[account]
#[derive(InitSpace)]
pub struct Payee {
    pub vault: Pubkey,
    /// Wallet that receives; payments go to its associated token account for the vault mint.
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
    /// sha256 of the human-readable intent text. For signed mandates the program hashes the exact text the owner
    /// signed.
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

/// A payment waiting for the owner's co-sign (approved via a Blink). The account only exists while it is open:
/// approve / reject / close_request close it and refund the rent to the vault's agent.
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
    /// See `Vault::cosign_window_threshold`. 0 = disabled.
    pub cosign_window_threshold: u64,
    /// See `Vault::enforce_tripwire`.
    pub enforce_tripwire: bool,
}

/// Terms the owner signs off-chain for `redeem_signed_mandate`. The vault, program id, cluster and mint come from
/// the accounts; the program rebuilds the readable message from all of them and checks the owner's signature over
/// exactly those bytes. `nonce` must equal `vault.mandate_seq`, which makes every signature single-use, and the
/// owner can cancel unredeemed signatures with `bump_mandate_seq`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub struct MandateTerms {
    pub payee: Pubkey,
    pub max_total: u64,
    pub max_per_tx: u64,
    pub expires_at: i64,
    pub nonce: u64,
    /// Shown to the owner in the wallet prompt; stored onchain as sha256(intent).
    pub intent: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum AuthKind {
    Payee,
    Mandate,
    Request,
}
