//! Leash: the agent can *request* payments; only owner-signed authorizations release them.
//! Three release paths (allowlisted payee, owner-signed mandate, live owner co-sign), all bounded by per-tx and
//! rolling 24h caps and a kill switch. Every rule lives here; off-chain checks are UX only.
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod contexts;
pub mod ed25519;
pub mod errors;
pub mod events;
pub mod policy;
pub mod state;

pub use contexts::*;
use errors::LeashError;
use events::*;
use policy::{check_spend, commit_vault_counters, read_token_account, transfer_from_vault, validate_policy, SpendCheck};
use state::*;

declare_id!("Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe");

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

#[program]
pub mod leash {
    use super::*;

    // ───────────────────────────── owner: vault + policy ─────────────────────────────

    pub fn initialize_vault(ctx: Context<InitializeVault>, vault_id: u64, agent: Pubkey, policy: Policy) -> Result<()> {
        validate_policy(&policy)?;
        let ts = now()?;
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.agent = agent;
        vault.mint = ctx.accounts.mint.key();
        vault.vault_id = vault_id;
        vault.paused = false;
        vault.per_tx_cap = policy.per_tx_cap;
        vault.daily_cap = policy.daily_cap;
        vault.window_start = ts;
        vault.spent_in_window = 0;
        vault.cosign_threshold = policy.cosign_threshold;
        vault.request_ttl_secs = policy.request_ttl_secs;
        vault.request_seq = 0;
        vault.mandate_seq = 0;
        vault.total_spent = 0;
        vault.blocked_count = 0;
        vault.strikes = 0;
        vault.freeze_after_strikes = policy.freeze_after_strikes;
        vault.last_blocked_at = 0;
        vault.bump = ctx.bumps.vault;
        emit!(PolicyUpdated { vault: vault.key(), ts });
        Ok(())
    }

    pub fn update_policy(ctx: Context<OwnerVault>, policy: Policy) -> Result<()> {
        validate_policy(&policy)?;
        let vault = &mut ctx.accounts.vault;
        vault.per_tx_cap = policy.per_tx_cap;
        vault.daily_cap = policy.daily_cap;
        vault.cosign_threshold = policy.cosign_threshold;
        vault.request_ttl_secs = policy.request_ttl_secs;
        vault.freeze_after_strikes = policy.freeze_after_strikes;
        emit!(PolicyUpdated { vault: vault.key(), ts: now()? });
        Ok(())
    }

    pub fn set_agent(ctx: Context<OwnerVault>, new_agent: Pubkey) -> Result<()> {
        ctx.accounts.vault.agent = new_agent;
        emit!(PolicyUpdated { vault: ctx.accounts.vault.key(), ts: now()? });
        Ok(())
    }

    /// Kill switch. Unpausing also clears tripwire strikes (the owner has looked at what happened).
    pub fn set_paused(ctx: Context<OwnerVault>, paused: bool) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.paused = paused;
        if !paused {
            vault.strikes = 0;
        }
        emit!(VaultPausedChanged { vault: vault.key(), paused, ts: now()? });
        Ok(())
    }

    pub fn reset_strikes(ctx: Context<OwnerVault>) -> Result<()> {
        ctx.accounts.vault.strikes = 0;
        emit!(PolicyUpdated { vault: ctx.accounts.vault.key(), ts: now()? });
        Ok(())
    }

    // ───────────────────────────── owner: allowlist ─────────────────────────────

    pub fn add_payee(
        ctx: Context<AddPayee>,
        payee: Pubkey,
        label: String,
        per_tx_max: u64,
        budget_total: u64,
    ) -> Result<()> {
        require!(label.len() <= MAX_LABEL_LEN, LeashError::LabelTooLong);
        require!(per_tx_max > 0, LeashError::InvalidPolicy);
        let vault_key = ctx.accounts.vault.key();
        let p = &mut ctx.accounts.payee_account;
        p.vault = vault_key;
        p.payee = payee;
        p.label = label;
        p.per_tx_max = per_tx_max;
        p.budget_total = budget_total;
        p.spent = 0;
        p.active = true;
        p.bump = ctx.bumps.payee_account;
        emit!(PayeeChanged { vault: vault_key, payee, active: true, removed: false, ts: now()? });
        Ok(())
    }

    pub fn update_payee(ctx: Context<UpdatePayee>, per_tx_max: u64, budget_total: u64, active: bool) -> Result<()> {
        require!(per_tx_max > 0, LeashError::InvalidPolicy);
        let p = &mut ctx.accounts.payee_account;
        p.per_tx_max = per_tx_max;
        p.budget_total = budget_total;
        p.active = active;
        emit!(PayeeChanged { vault: p.vault, payee: p.payee, active, removed: false, ts: now()? });
        Ok(())
    }

    pub fn remove_payee(ctx: Context<RemovePayee>) -> Result<()> {
        let p = &ctx.accounts.payee_account;
        emit!(PayeeChanged { vault: p.vault, payee: p.payee, active: false, removed: true, ts: now()? });
        Ok(())
    }

    // ───────────────────────────── owner: mandates ─────────────────────────────

    pub fn create_mandate(
        ctx: Context<CreateMandate>,
        payee: Pubkey,
        max_total: u64,
        max_per_tx: u64,
        expires_at: i64,
        intent_hash: [u8; 32],
    ) -> Result<()> {
        let ts = now()?;
        require!(
            max_total > 0 && max_per_tx > 0 && max_per_tx <= max_total && expires_at > ts,
            LeashError::InvalidMandateTerms
        );
        let vault = &mut ctx.accounts.vault;
        let id = vault.mandate_seq;
        vault.mandate_seq = id.checked_add(1).ok_or(LeashError::Overflow)?;
        let m = &mut ctx.accounts.mandate;
        m.vault = vault.key();
        m.id = id;
        m.payee = payee;
        m.max_total = max_total;
        m.max_per_tx = max_per_tx;
        m.spent = 0;
        m.expires_at = expires_at;
        m.intent_hash = intent_hash;
        m.revoked = false;
        m.bump = ctx.bumps.mandate;
        emit!(MandateCreated {
            vault: m.vault,
            mandate: m.key(),
            payee,
            max_total,
            expires_at,
            intent_hash,
            signed_offchain: false,
        });
        Ok(())
    }

    /// The owner signed `terms` off-chain (wallet signMessage, no SOL, no tx); the agent redeems it here.
    /// The tx must be `[Ed25519 precompile ix, redeem_signed_mandate]`.
    pub fn redeem_signed_mandate(ctx: Context<RedeemSignedMandate>, terms: MandateTerms) -> Result<()> {
        let ts = now()?;
        let vault = &mut ctx.accounts.vault;
        require!(terms.nonce == vault.mandate_seq, LeashError::InvalidMandateSignature);
        let expected = ed25519::mandate_message(&terms)?;
        ed25519::verify_owner_signature(&ctx.accounts.instructions.to_account_info(), &vault.owner, &expected)?;
        require!(
            terms.max_total > 0
                && terms.max_per_tx > 0
                && terms.max_per_tx <= terms.max_total
                && terms.expires_at > ts,
            LeashError::InvalidMandateTerms
        );

        let id = vault.mandate_seq;
        vault.mandate_seq = id.checked_add(1).ok_or(LeashError::Overflow)?;
        let m = &mut ctx.accounts.mandate;
        m.vault = vault.key();
        m.id = id;
        m.payee = terms.payee;
        m.max_total = terms.max_total;
        m.max_per_tx = terms.max_per_tx;
        m.spent = 0;
        m.expires_at = terms.expires_at;
        m.intent_hash = terms.intent_hash;
        m.revoked = false;
        m.bump = ctx.bumps.mandate;
        emit!(MandateCreated {
            vault: m.vault,
            mandate: m.key(),
            payee: terms.payee,
            max_total: terms.max_total,
            expires_at: terms.expires_at,
            intent_hash: terms.intent_hash,
            signed_offchain: true,
        });
        Ok(())
    }

    pub fn revoke_mandate(ctx: Context<RevokeMandate>) -> Result<()> {
        let m = &mut ctx.accounts.mandate;
        m.revoked = true;
        emit!(MandateRevoked { vault: m.vault, mandate: m.key(), ts: now()? });
        Ok(())
    }

    // ───────────────────────────── agent: spend ─────────────────────────────

    /// Strict path: any policy violation reverts with a named error (the red failed tx in the explorer).
    pub fn agent_spend(ctx: Context<Spend>, amount: u64, reason_hash: [u8; 32], memo: Option<[u8; 32]>) -> Result<()> {
        spend(ctx, amount, reason_hash, memo, false)
    }

    /// Tripwire path: a policy violation does NOT revert. It records a strike, emits PaymentBlocked, and may
    /// auto-pause the vault, so the refusal is counted onchain where anyone can verify it.
    pub fn guarded_spend(ctx: Context<Spend>, amount: u64, reason_hash: [u8; 32], memo: Option<[u8; 32]>) -> Result<()> {
        spend(ctx, amount, reason_hash, memo, true)
    }

    /// Ask the owner to co-sign a payment (typically one at or above the co-sign threshold).
    pub fn request_spend(
        ctx: Context<RequestSpend>,
        payee: Pubkey,
        amount: u64,
        reason_hash: [u8; 32],
        memo: Option<[u8; 32]>,
    ) -> Result<()> {
        let ts = now()?;
        let vault = &ctx.accounts.vault;
        require!(!vault.paused, LeashError::VaultPaused);
        require!(amount > 0, LeashError::ZeroAmount);

        // The payee must already be authorized (allowlist or mandate) and the amount within its per-tx limits,
        // so a hijacked agent can't spam the owner with requests to the attacker.
        let vault_key = vault.key();
        match (&ctx.accounts.payee_account, &ctx.accounts.mandate_account) {
            (Some(p), _) => {
                require!(p.vault == vault_key && p.active && p.payee == payee, LeashError::PayeeNotAuthorized);
                require!(amount <= p.per_tx_max, LeashError::ExceedsPayeePerTx);
                if p.budget_total != 0 {
                    let after = p.spent.checked_add(amount).ok_or(LeashError::Overflow)?;
                    require!(after <= p.budget_total, LeashError::PayeeBudgetExceeded);
                }
            }
            (None, Some(m)) => {
                require!(m.vault == vault_key && m.payee == payee, LeashError::PayeeNotAuthorized);
                require!(!m.revoked, LeashError::MandateRevoked);
                require!(ts < m.expires_at, LeashError::MandateExpired);
                require!(amount <= m.max_per_tx, LeashError::ExceedsPayeePerTx);
                let after = m.spent.checked_add(amount).ok_or(LeashError::Overflow)?;
                require!(after <= m.max_total, LeashError::MandateExhausted);
            }
            (None, None) => return err!(LeashError::PayeeNotAuthorized),
        }
        require!(amount <= vault.per_tx_cap, LeashError::ExceedsPerTxCap);

        let vault = &mut ctx.accounts.vault;
        let seq = vault.request_seq;
        vault.request_seq = seq.checked_add(1).ok_or(LeashError::Overflow)?;
        let expires_at = ts.checked_add(vault.request_ttl_secs).ok_or(LeashError::Overflow)?;

        let r = &mut ctx.accounts.request;
        r.vault = vault_key;
        r.seq = seq;
        r.payee = payee;
        r.amount = amount;
        r.reason_hash = reason_hash;
        r.created_at = ts;
        r.expires_at = expires_at;
        r.status = RequestStatus::Pending;
        r.bump = ctx.bumps.request;
        r.memo = memo;
        emit!(SpendRequested { vault: vault_key, request: r.key(), payee, amount, reason_hash, ts });
        Ok(())
    }

    // ───────────────────────────── owner: co-sign ─────────────────────────────

    /// The owner's co-signature: re-checks the policy (except the threshold) and pays.
    pub fn approve_request(ctx: Context<ApproveRequest>) -> Result<()> {
        let ts = now()?;
        let a = &ctx.accounts;
        require!(a.request.status == RequestStatus::Pending, LeashError::RequestNotPending);
        require!(ts <= a.request.expires_at, LeashError::RequestExpired);
        require!(!a.vault.paused, LeashError::VaultPaused);
        let amount = a.request.amount;

        let check = SpendCheck {
            vault: &a.vault,
            vault_key: a.vault.key(),
            payee_account: a.payee_account.as_ref(),
            mandate_account: a.mandate_account.as_ref(),
            recipient: &a.recipient_ata.to_account_info(),
            token_program: a.token_program.key(),
            amount,
            now: ts,
            enforce_cosign: false,
            expected_payee: Some(a.request.payee),
        };
        let auth = check_spend(&check)?;

        transfer_from_vault(
            &a.vault,
            &a.mint,
            &a.vault_ata,
            a.recipient_ata.to_account_info(),
            &a.token_program,
            amount,
        )?;

        let accts = ctx.accounts;
        apply_authorization_spend(&mut accts.payee_account, &mut accts.mandate_account, auth.via, amount)?;
        commit_vault_counters(&mut accts.vault, amount, ts)?;
        accts.request.status = RequestStatus::Approved;

        let vault_key = accts.vault.key();
        let request_key = accts.request.key();
        emit!(RequestResolved { vault: vault_key, request: request_key, approved: true, ts });
        emit!(SpendExecuted {
            vault: vault_key,
            payee: auth.payee,
            amount,
            reason_hash: accts.request.reason_hash,
            memo: accts.request.memo,
            via: AuthKind::Request,
            ts,
        });
        Ok(())
    }

    pub fn reject_request(ctx: Context<RejectRequest>) -> Result<()> {
        let r = &mut ctx.accounts.request;
        require!(r.status == RequestStatus::Pending, LeashError::RequestNotPending);
        r.status = RequestStatus::Rejected;
        emit!(RequestResolved { vault: r.vault, request: r.key(), approved: false, ts: now()? });
        Ok(())
    }

    // ───────────────────────────── owner: funds ─────────────────────────────

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, LeashError::ZeroAmount);
        let a = &ctx.accounts;
        transfer_from_vault(
            &a.vault,
            &a.mint,
            &a.vault_ata,
            a.owner_token_account.to_account_info(),
            &a.token_program,
            amount,
        )
    }
}

fn apply_authorization_spend(
    payee_account: &mut Option<Account<'_, Payee>>,
    mandate_account: &mut Option<Account<'_, Mandate>>,
    via: AuthKind,
    amount: u64,
) -> Result<()> {
    match via {
        AuthKind::Payee => {
            let p = payee_account.as_mut().ok_or(LeashError::PayeeNotAuthorized)?;
            p.spent = p.spent.checked_add(amount).ok_or(LeashError::Overflow)?;
        }
        AuthKind::Mandate => {
            let m = mandate_account.as_mut().ok_or(LeashError::PayeeNotAuthorized)?;
            m.spent = m.spent.checked_add(amount).ok_or(LeashError::Overflow)?;
        }
        AuthKind::Request => {}
    }
    Ok(())
}

/// Shared body of agent_spend / guarded_spend. Steps 1-3 are always hard errors (step 1, NotAgent, is the
/// account constraint on `vault`).
fn spend(ctx: Context<Spend>, amount: u64, reason_hash: [u8; 32], memo: Option<[u8; 32]>, guarded: bool) -> Result<()> {
    let ts = now()?;
    let a = &ctx.accounts;
    require!(!a.vault.paused, LeashError::VaultPaused);
    require!(amount > 0, LeashError::ZeroAmount);

    let check = SpendCheck {
        vault: &a.vault,
        vault_key: a.vault.key(),
        payee_account: a.payee_account.as_ref(),
        mandate_account: a.mandate_account.as_ref(),
        recipient: &a.recipient_ata.to_account_info(),
        token_program: a.token_program.key(),
        amount,
        now: ts,
        enforce_cosign: true,
        expected_payee: None,
    };

    let auth = match check_spend(&check) {
        Ok(auth) => auth,
        // A large legitimate payment isn't an attack: it needs a co-sign, not a strike.
        Err(e @ (LeashError::RequiresCosign | LeashError::Overflow)) => return Err(e.into()),
        Err(e) if guarded => {
            let attempted_payee = read_token_account(&a.recipient_ata.to_account_info(), &a.token_program.key())
                .map(|(owner, _)| owner)
                .unwrap_or(a.recipient_ata.key());
            let vault = &mut ctx.accounts.vault;
            vault.blocked_count = vault.blocked_count.checked_add(1).ok_or(LeashError::Overflow)?;
            vault.strikes = vault.strikes.saturating_add(1);
            vault.last_blocked_at = ts;
            emit!(PaymentBlocked {
                vault: vault.key(),
                attempted_payee,
                amount,
                reason_code: e.number(),
                reason_hash,
                blocked_count: vault.blocked_count,
                strikes: vault.strikes,
                ts,
            });
            msg!("Leash: payment blocked ({:?}), strike {}", e, vault.strikes);
            if vault.freeze_after_strikes != 0 && vault.strikes >= vault.freeze_after_strikes && !vault.paused {
                vault.paused = true;
                emit!(VaultFrozen { vault: vault.key(), strikes: vault.strikes, ts });
                emit!(VaultPausedChanged { vault: vault.key(), paused: true, ts });
            }
            return Ok(());
        }
        Err(e) => return Err(e.into()),
    };

    transfer_from_vault(&a.vault, &a.mint, &a.vault_ata, a.recipient_ata.to_account_info(), &a.token_program, amount)?;

    let accts = ctx.accounts;
    apply_authorization_spend(&mut accts.payee_account, &mut accts.mandate_account, auth.via, amount)?;
    commit_vault_counters(&mut accts.vault, amount, ts)?;
    emit!(SpendExecuted {
        vault: accts.vault.key(),
        payee: auth.payee,
        amount,
        reason_hash,
        memo,
        via: auth.via,
        ts,
    });
    Ok(())
}
