//! The readable, domain-bound message an owner signs (wallet `signMessage`) to grant a mandate off-chain.
//!
//! The program rebuilds these exact bytes from the instruction arguments and the accounts, then checks the
//! owner's Ed25519 signature over them (see `ed25519.rs`). Lines are joined with `\n`, no trailing newline:
//!
//! ```text
//! Leash spending mandate v2
//! Program: <leash program id, base58>
//! Cluster: devnet
//! Vault: <vault PDA, base58>
//! Vault opened: <vault.created_at, YYYY-MM-DDTHH:MM:SSZ>
//! Payee: <payee wallet, base58>
//! Mint: <vault mint, base58>
//! Max total: <ui amount>
//! Max per payment: <ui amount>
//! Expires: <YYYY-MM-DDTHH:MM:SSZ>
//! Nonce: <vault.mandate_seq, decimal>
//! Intent: <intent text>
//! ```
//!
//! UI amount: `amount / 10^decimals` in plain decimal, no thousands separators, trailing fractional zeros trimmed
//! but at least `min(2, decimals)` fractional digits (1_000_000 @6 → "1.00", 1_234_500 @6 → "1.2345",
//! 5 @0 → "5").

use anchor_lang::prelude::*;

use crate::errors::LeashError;
use crate::state::{MandateTerms, CLUSTER, MANDATE_HEADER, MAX_EXPIRES_AT, MAX_INTENT_LEN};

/// 1..=MAX_INTENT_LEN bytes, printable ASCII only: no newlines (a fake "Max total:" line) and no Unicode tricks
/// (bidi overrides) in the text the owner reads.
pub fn validate_intent(intent: &str) -> Result<()> {
    let b = intent.as_bytes();
    require!(!b.is_empty() && b.len() <= MAX_INTENT_LEN, LeashError::InvalidIntent);
    require!(b.iter().all(|c| (0x20..=0x7e).contains(c)), LeashError::InvalidIntent);
    Ok(())
}

pub fn ui_amount(amount: u64, decimals: u8) -> String {
    if decimals == 0 {
        return amount.to_string();
    }
    let scale = 10u128.pow(decimals as u32);
    let int = amount as u128 / scale;
    let frac = amount as u128 % scale;
    let mut frac_s = format!("{:0width$}", frac, width = decimals as usize);
    let min = core::cmp::min(2, decimals as usize);
    while frac_s.len() > min && frac_s.ends_with('0') {
        frac_s.pop();
    }
    format!("{int}.{frac_s}")
}

/// Days since 1970-01-01 → (year, month, day), proleptic Gregorian (H. Hinnant's civil_from_days).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (y, m, d)
}

/// `YYYY-MM-DDTHH:MM:SSZ` (UTC, no fractional seconds). Caller guarantees 0 <= ts <= MAX_EXPIRES_AT.
pub fn iso8601(ts: i64) -> String {
    let (y, m, d) = civil_from_days(ts.div_euclid(86_400));
    let s = ts.rem_euclid(86_400);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, s / 3_600, (s % 3_600) / 60, s % 60)
}

pub fn mandate_message(
    terms: &MandateTerms,
    vault: &Pubkey,
    vault_created_at: i64,
    mint: &Pubkey,
    decimals: u8,
) -> Result<Vec<u8>> {
    validate_intent(&terms.intent)?;
    require!(terms.expires_at > 0 && terms.expires_at <= MAX_EXPIRES_AT, LeashError::InvalidMandateTerms);
    let msg = format!(
        "{MANDATE_HEADER}\nProgram: {}\nCluster: {CLUSTER}\nVault: {}\nVault opened: {}\nPayee: {}\nMint: {}\nMax total: {}\nMax per payment: {}\nExpires: {}\nNonce: {}\nIntent: {}",
        crate::ID,
        vault,
        iso8601(vault_created_at.clamp(0, MAX_EXPIRES_AT)),
        terms.payee,
        mint,
        ui_amount(terms.max_total, decimals),
        ui_amount(terms.max_per_tx, decimals),
        iso8601(terms.expires_at),
        terms.nonce,
        terms.intent,
    );
    Ok(msg.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_amounts() {
        assert_eq!(ui_amount(1_000_000, 6), "1.00");
        assert_eq!(ui_amount(500_000, 6), "0.50");
        assert_eq!(ui_amount(1_234_500, 6), "1.2345");
        assert_eq!(ui_amount(1, 6), "0.000001");
        assert_eq!(ui_amount(10_000_000_000, 6), "10000.00");
        assert_eq!(ui_amount(5, 0), "5");
        assert_eq!(ui_amount(50, 1), "5.0");
        assert_eq!(ui_amount(u64::MAX, 18), "18.446744073709551615");
    }

    #[test]
    fn iso_dates() {
        assert_eq!(iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(iso8601(1_794_052_800), "2026-11-07T12:00:00Z");
        assert_eq!(iso8601(MAX_EXPIRES_AT), "9999-12-31T23:59:59Z");
    }

    #[test]
    fn intents() {
        assert!(validate_intent("Buy one research report").is_ok());
        assert!(validate_intent("").is_err());
        assert!(validate_intent("line\nMax total: 1000").is_err());
        assert!(validate_intent("caf\u{e9}").is_err());
        assert!(validate_intent(&"x".repeat(MAX_INTENT_LEN + 1)).is_err());
        assert!(validate_intent(&"x".repeat(MAX_INTENT_LEN)).is_ok());
    }
}
