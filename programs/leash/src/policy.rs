//! The authorization check every outgoing payment goes through. Pure: it reads state and returns either the
//! authorization or the named error; callers decide whether to revert (agent_spend) or record (guarded_spend).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::errors::LeashError;
use crate::state::*;

pub struct Authorized {
    pub payee: Pubkey,
    pub via: AuthKind,
}

/// Owner and mint of a token account, if `info` is an initialized token account of `token_program`.
pub fn read_token_account(info: &AccountInfo, token_program: &Pubkey) -> Option<(Pubkey, Pubkey)> {
    if info.owner != token_program {
        return None;
    }
    let data = info.try_borrow_data().ok()?;
    let mut slice: &[u8] = &data[..];
    let acct = TokenAccount::try_deserialize(&mut slice).ok()?;
    Some((acct.owner, acct.mint))
}

pub struct SpendCheck<'a, 'info> {
    pub vault: &'a Vault,
    pub vault_key: Pubkey,
    pub payee_account: Option<&'a Account<'info, Payee>>,
    pub mandate_account: Option<&'a Account<'info, Mandate>>,
    pub recipient: &'a AccountInfo<'info>,
    pub token_program: Pubkey,
    pub amount: u64,
    pub now: i64,
    /// false for approve_request: the owner's signature *is* the co-sign.
    pub enforce_cosign: bool,
    /// Some(payee) when the payee is fixed in advance (a spend request).
    pub expected_payee: Option<Pubkey>,
}

/// Steps 4-8 of the check order in docs/04 (steps 1-3 are hard errors checked by the caller).
/// Step 4 needs to know *who* is authorized, so the authorizing account is resolved first (no account → the
/// payee isn't authorized), then the recipient token account is matched against it.
pub fn check_spend(c: &SpendCheck) -> core::result::Result<Authorized, LeashError> {
    // 4a. Which owner-signed authorization covers this payment?
    let (auth_payee, via) = if let Some(p) = c.payee_account {
        if p.vault != c.vault_key || !p.active {
            return Err(LeashError::PayeeNotAuthorized);
        }
        (p.payee, AuthKind::Payee)
    } else if let Some(m) = c.mandate_account {
        if m.vault != c.vault_key {
            return Err(LeashError::PayeeNotAuthorized);
        }
        (m.payee, AuthKind::Mandate)
    } else {
        return Err(LeashError::PayeeNotAuthorized);
    };
    if let Some(expected) = c.expected_payee {
        if expected != auth_payee {
            return Err(LeashError::PayeeNotAuthorized);
        }
    }

    // 4b. The money must land in that payee's token account for the vault mint.
    match read_token_account(c.recipient, &c.token_program) {
        Some((owner, mint)) if owner == auth_payee && mint == c.vault.mint => {}
        _ => return Err(LeashError::RecipientMismatch),
    }

    // 5. Limits of that authorization.
    match via {
        AuthKind::Payee => {
            let p = c.payee_account.unwrap();
            if c.amount > p.per_tx_max {
                return Err(LeashError::ExceedsPayeePerTx);
            }
            if p.budget_total != 0 {
                let after = p.spent.checked_add(c.amount).ok_or(LeashError::Overflow)?;
                if after > p.budget_total {
                    return Err(LeashError::PayeeBudgetExceeded);
                }
            }
        }
        AuthKind::Mandate => {
            let m = c.mandate_account.unwrap();
            if m.revoked {
                return Err(LeashError::MandateRevoked);
            }
            if c.now >= m.expires_at {
                return Err(LeashError::MandateExpired);
            }
            if c.amount > m.max_per_tx {
                return Err(LeashError::ExceedsPayeePerTx);
            }
            let after = m.spent.checked_add(c.amount).ok_or(LeashError::Overflow)?;
            if after > m.max_total {
                return Err(LeashError::MandateExhausted);
            }
        }
        AuthKind::Request => unreachable!(),
    }

    // 6. Vault per-transaction cap.
    if c.amount > c.vault.per_tx_cap {
        return Err(LeashError::ExceedsPerTxCap);
    }

    // 7. Rolling 24h cap (the window is rolled for real in `commit_spend`).
    let in_window = if c.now - c.vault.window_start >= WINDOW_SECS { 0 } else { c.vault.spent_in_window };
    let after = in_window.checked_add(c.amount).ok_or(LeashError::Overflow)?;
    if after > c.vault.daily_cap {
        return Err(LeashError::ExceedsDailyCap);
    }

    // 8. Co-sign threshold.
    if c.enforce_cosign && c.vault.cosign_threshold != 0 && c.amount >= c.vault.cosign_threshold {
        return Err(LeashError::RequiresCosign);
    }

    Ok(Authorized { payee: auth_payee, via })
}

/// Roll the 24h window and add `amount` to the vault counters.
pub fn commit_vault_counters(vault: &mut Vault, amount: u64, now: i64) -> Result<()> {
    if now - vault.window_start >= WINDOW_SECS {
        vault.window_start = now;
        vault.spent_in_window = 0;
    }
    vault.spent_in_window = vault.spent_in_window.checked_add(amount).ok_or(LeashError::Overflow)?;
    vault.total_spent = vault.total_spent.checked_add(amount).ok_or(LeashError::Overflow)?;
    Ok(())
}

/// PDA-signed `transfer_checked` out of the vault token account.
pub fn transfer_from_vault<'info>(
    vault: &Account<'info, Vault>,
    mint: &InterfaceAccount<'info, Mint>,
    vault_ata: &InterfaceAccount<'info, TokenAccount>,
    to: AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    if vault_ata.amount < amount {
        return err!(LeashError::InsufficientFunds);
    }
    let owner = vault.owner;
    let id_bytes = vault.vault_id.to_le_bytes();
    let bump = [vault.bump];
    let seeds: &[&[u8]] = &[VAULT_SEED, owner.as_ref(), &id_bytes, &bump];
    let signer: &[&[&[u8]]] = &[seeds];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault_ata.to_account_info(),
                mint: mint.to_account_info(),
                to,
                authority: vault.to_account_info(),
            },
            signer,
        ),
        amount,
        mint.decimals,
    )
}

pub fn validate_policy(p: &Policy) -> Result<()> {
    require!(p.per_tx_cap > 0, LeashError::InvalidPolicy);
    require!(p.daily_cap >= p.per_tx_cap, LeashError::InvalidPolicy);
    require!(p.request_ttl_secs > 0, LeashError::InvalidPolicy);
    Ok(())
}
