//! Leash: the agent can *request* payments; only owner-signed authorizations release them.
//! Three release paths (allowlisted payee, owner-signed mandate, live owner co-sign), all bounded by per-tx and
//! rolling 24h caps and a kill switch. Every rule lives here; off-chain checks are UX only.
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod contexts;
pub mod ed25519;
pub mod errors;
pub mod events;
pub mod mandate_msg;
pub mod policy;
pub mod state;

pub use contexts::*;
use errors::LeashError;
use events::*;
use policy::{
    check_spend, close_program_account, close_vault_ata, commit_vault_counters, load_authorization,
    load_program_account, read_token_account, store_program_account, transfer_from_vault, validate_mint,
    validate_policy, Authorized, Refusal, SpendCheck,
};
use state::*;

declare_id!("Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe");

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

fn apply_policy(vault: &mut Vault, policy: &Policy) {
    vault.per_tx_cap = policy.per_tx_cap;
    vault.daily_cap = policy.daily_cap;
    vault.cosign_threshold = policy.cosign_threshold;
    vault.cosign_window_threshold = policy.cosign_window_threshold;
    vault.request_ttl_secs = policy.request_ttl_secs;
    vault.freeze_after_strikes = policy.freeze_after_strikes;
    vault.enforce_tripwire = policy.enforce_tripwire;
}

#[program]
pub mod leash {
    use super::*;

    // ───────────────────────────── owner: vault + policy ─────────────────────────────

    pub fn initialize_vault(ctx: Context<InitializeVault>, vault_id: u64, agent: Pubkey, policy: Policy) -> Result<()> {
        validate_policy(&policy)?;
        require!(agent != ctx.accounts.owner.key(), LeashError::AgentIsOwner);
        validate_mint(&ctx.accounts.mint.to_account_info(), ctx.accounts.mint.decimals)?;
        let ts = now()?;
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.agent = agent;
        vault.mint = ctx.accounts.mint.key();
        vault.vault_id = vault_id;
        vault.created_at = ts;
        vault.paused = false;
        apply_policy(vault, &policy);
        vault.request_seq = 0;
        vault.mandate_seq = 0;
        vault.total_spent = 0;
        vault.blocked_count = 0;
        vault.strikes = 0;
        vault.last_blocked_at = 0;
        vault.strike_window_start = 0;
        vault.open_requests = 0;
        vault.open_payees = 0;
        vault.open_mandates = 0;
        vault.last_bucket = ts.div_euclid(BUCKET_SECS);
        vault.spent_buckets = [0; BUCKETS];
        vault.auto_buckets = [0; BUCKETS];
        vault.bump = ctx.bumps.vault;
        emit!(PolicyUpdated { vault: vault.key(), ts });
        Ok(())
    }

    pub fn update_policy(ctx: Context<OwnerVault>, policy: Policy) -> Result<()> {
        validate_policy(&policy)?;
        let vault = &mut ctx.accounts.vault;
        apply_policy(vault, &policy);
        emit!(PolicyUpdated { vault: vault.key(), ts: now()? });
        Ok(())
    }

    pub fn set_agent(ctx: Context<OwnerVault>, new_agent: Pubkey) -> Result<()> {
        require!(new_agent != ctx.accounts.vault.owner, LeashError::AgentIsOwner);
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
            vault.strike_window_start = 0;
        }
        emit!(VaultPausedChanged { vault: vault.key(), paused, ts: now()? });
        Ok(())
    }

    pub fn reset_strikes(ctx: Context<OwnerVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.strikes = 0;
        vault.strike_window_start = 0;
        emit!(PolicyUpdated { vault: vault.key(), ts: now()? });
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
        let vault = &mut ctx.accounts.vault;
        vault.open_payees = vault.open_payees.checked_add(1).ok_or(LeashError::Overflow)?;
        let vault_key = vault.key();
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
        let vault = &mut ctx.accounts.vault;
        vault.open_payees = vault.open_payees.saturating_sub(1);
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
        vault.open_mandates = vault.open_mandates.checked_add(1).ok_or(LeashError::Overflow)?;
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

    /// The owner signed a readable mandate message off-chain (wallet signMessage, no SOL, no tx); the agent redeems
    /// it here. The tx must be `[Ed25519 precompile ix, redeem_signed_mandate]`. The program rebuilds the message
    /// from `terms` + program id + cluster + vault + mint and requires the owner's signature over exactly it.
    pub fn redeem_signed_mandate(ctx: Context<RedeemSignedMandate>, terms: MandateTerms) -> Result<()> {
        let ts = now()?;
        let vault_key = ctx.accounts.vault.key();
        require!(terms.nonce == ctx.accounts.vault.mandate_seq, LeashError::StaleMandateNonce);
        let expected = mandate_msg::mandate_message(
            &terms,
            &vault_key,
            ctx.accounts.vault.created_at,
            &ctx.accounts.mint.key(),
            ctx.accounts.mint.decimals,
        )?;
        ed25519::verify_owner_signature(
            &ctx.accounts.instructions.to_account_info(),
            &ctx.accounts.vault.owner,
            &expected,
        )?;
        require!(
            terms.max_total > 0
                && terms.max_per_tx > 0
                && terms.max_per_tx <= terms.max_total
                && terms.expires_at > ts,
            LeashError::InvalidMandateTerms
        );
        let intent_hash = solana_sha256_hasher::hash(terms.intent.as_bytes()).to_bytes();

        let vault = &mut ctx.accounts.vault;
        let id = vault.mandate_seq;
        vault.mandate_seq = id.checked_add(1).ok_or(LeashError::Overflow)?;
        vault.open_mandates = vault.open_mandates.checked_add(1).ok_or(LeashError::Overflow)?;
        let m = &mut ctx.accounts.mandate;
        m.vault = vault_key;
        m.id = id;
        m.payee = terms.payee;
        m.max_total = terms.max_total;
        m.max_per_tx = terms.max_per_tx;
        m.spent = 0;
        m.expires_at = terms.expires_at;
        m.intent_hash = intent_hash;
        m.revoked = false;
        m.bump = ctx.bumps.mandate;
        emit!(MandateCreated {
            vault: vault_key,
            mandate: m.key(),
            payee: terms.payee,
            max_total: terms.max_total,
            expires_at: terms.expires_at,
            intent_hash,
            signed_offchain: true,
        });
        Ok(())
    }

    /// Cancel every unredeemed signed mandate: signatures carry `nonce == mandate_seq`, so moving the sequence to
    /// `new_seq` voids all nonces below it. (Mandate ids skip the cancelled range.)
    pub fn bump_mandate_seq(ctx: Context<OwnerVault>, new_seq: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(new_seq > vault.mandate_seq, LeashError::MandateSeqNotIncreasing);
        vault.mandate_seq = new_seq;
        emit!(MandateSeqBumped { vault: vault.key(), mandate_seq: new_seq, ts: now()? });
        Ok(())
    }

    pub fn revoke_mandate(ctx: Context<RevokeMandate>) -> Result<()> {
        let m = &mut ctx.accounts.mandate;
        m.revoked = true;
        emit!(MandateRevoked { vault: m.vault, mandate: m.key(), ts: now()? });
        Ok(())
    }

    pub fn close_mandate(ctx: Context<CloseMandate>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.open_mandates = vault.open_mandates.saturating_sub(1);
        emit!(MandateClosed { vault: vault.key(), mandate: ctx.accounts.mandate.key(), ts: now()? });
        Ok(())
    }

    // ───────────────────────────── agent: spend ─────────────────────────────

    /// Strict path: any policy violation reverts with a named error (the red failed tx in the explorer).
    /// If the owner set `enforce_tripwire`, it behaves exactly like `guarded_spend`.
    pub fn agent_spend(ctx: Context<Spend>, amount: u64, reason_hash: [u8; 32], memo: Option<[u8; 32]>) -> Result<()> {
        let guarded = ctx.accounts.vault.enforce_tripwire;
        spend(ctx, amount, reason_hash, memo, guarded)
    }

    /// Tripwire path: a policy violation does NOT revert. It emits PaymentBlocked and counts it; unauthorized
    /// attempts also record a strike that may auto-pause the vault, so the refusal is onchain for anyone to verify.
    pub fn guarded_spend(ctx: Context<Spend>, amount: u64, reason_hash: [u8; 32], memo: Option<[u8; 32]>) -> Result<()> {
        spend(ctx, amount, reason_hash, memo, true)
    }

    /// Ask the owner to co-sign a payment (typically one at or above a co-sign threshold).
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
        require!(vault.open_requests < MAX_OPEN_REQUESTS, LeashError::TooManyOpenRequests);

        // The payee must already be authorized (allowlist or mandate of *this* vault) and the amount within its
        // per-tx limits, so a hijacked agent can't spam the owner with requests to the attacker.
        let vault_key = vault.key();
        let payee_info = ctx.accounts.payee_account.as_ref().map(|a| a.to_account_info());
        let mandate_info = ctx.accounts.mandate_account.as_ref().map(|a| a.to_account_info());
        let (p, m) = load_authorization(payee_info.as_ref(), mandate_info.as_ref())?;
        match (p, m) {
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
        vault.open_requests = vault.open_requests.checked_add(1).ok_or(LeashError::Overflow)?;
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

    /// The owner's co-signature: re-checks the policy (except the co-sign thresholds), pays, and closes the request
    /// (rent back to the agent). `SpendExecuted.request` names the request this payment settles.
    pub fn approve_request(ctx: Context<ApproveRequest>) -> Result<()> {
        let ts = now()?;
        let vault_key = ctx.accounts.vault.key();
        let request_key = ctx.accounts.request.key();
        let req = load_open_request(&ctx.accounts.request, &vault_key)?;
        require!(ts <= req.expires_at, LeashError::RequestExpired);
        require!(!ctx.accounts.vault.paused, LeashError::VaultPaused);
        let amount = req.amount;

        let payee_info = ctx.accounts.payee_account.as_ref().map(|a| a.to_account_info());
        let mandate_info = ctx.accounts.mandate_account.as_ref().map(|a| a.to_account_info());
        let (payee, mandate) = load_authorization(payee_info.as_ref(), mandate_info.as_ref())?;
        let a = &ctx.accounts;
        let recipient = a.recipient_ata.to_account_info();
        let auth = check_spend(&SpendCheck {
            vault: &a.vault,
            vault_key,
            payee: payee.as_ref(),
            mandate: mandate.as_ref(),
            recipient: &recipient,
            token_program: a.token_program.key(),
            amount,
            now: ts,
            enforce_cosign: false,
            expected_payee: Some(req.payee),
        })?;

        transfer_from_vault(&a.vault, &a.mint, &a.vault_ata, recipient, &a.token_program, amount)?;
        settle_authorization(&auth, payee, mandate, payee_info.as_ref(), mandate_info.as_ref(), amount)?;

        let accts = ctx.accounts;
        commit_vault_counters(&mut accts.vault, amount, ts, false)?;
        accts.vault.open_requests = accts.vault.open_requests.saturating_sub(1);
        close_program_account(&accts.request.to_account_info(), &accts.agent.to_account_info())?;

        emit!(RequestResolved { vault: vault_key, request: request_key, approved: true, ts });
        emit!(SpendExecuted {
            vault: vault_key,
            payee: auth.payee,
            amount,
            reason_hash: req.reason_hash,
            memo: req.memo,
            via: AuthKind::Request,
            ts,
            request: Some(request_key),
        });
        Ok(())
    }

    /// The owner says no. Closes the request (rent back to the agent). Works on expired requests too.
    pub fn reject_request(ctx: Context<RejectRequest>) -> Result<()> {
        let vault_key = ctx.accounts.vault.key();
        let request_key = ctx.accounts.request.key();
        load_open_request(&ctx.accounts.request, &vault_key)?;
        let accts = ctx.accounts;
        accts.vault.open_requests = accts.vault.open_requests.saturating_sub(1);
        close_program_account(&accts.request.to_account_info(), &accts.agent.to_account_info())?;
        emit!(RequestResolved { vault: vault_key, request: request_key, approved: false, ts: now()? });
        Ok(())
    }

    /// Anyone may close an expired request (frees an open-request slot; rent back to the agent).
    pub fn close_request(ctx: Context<CloseRequest>) -> Result<()> {
        let ts = now()?;
        let vault_key = ctx.accounts.vault.key();
        let request_key = ctx.accounts.request.key();
        let req = load_open_request(&ctx.accounts.request, &vault_key)?;
        require!(ts > req.expires_at, LeashError::RequestNotExpired);
        let accts = ctx.accounts;
        accts.vault.open_requests = accts.vault.open_requests.saturating_sub(1);
        close_program_account(&accts.request.to_account_info(), &accts.agent.to_account_info())?;
        emit!(RequestClosed { vault: vault_key, request: request_key, ts });
        Ok(())
    }

    // ───────────────────────────── owner: funds ─────────────────────────────

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, LeashError::ZeroAmount);
        let a = &ctx.accounts;
        transfer_from_vault(&a.vault, &a.mint, &a.vault_ata, a.owner_token_account.to_account_info(), &a.token_program, amount)?;
        emit!(Withdrawn { vault: a.vault.key(), to: a.owner_token_account.key(), amount, ts: now()? });
        Ok(())
    }

    /// Close an empty vault: its token account and the vault account are closed, rent to the owner. Payees,
    /// mandates and open requests must be closed first so no rent is stranded. Not in the vault's first second:
    /// a re-initialized vault at the same address then always gets a later `created_at`, which is in every
    /// signed-mandate message, so old signatures can't be replayed against the new vault.
    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        let a = &ctx.accounts;
        require!(now()? > a.vault.created_at, LeashError::VaultJustOpened);
        require!(a.vault_ata.amount == 0, LeashError::VaultNotEmpty);
        require!(
            a.vault.open_requests == 0 && a.vault.open_payees == 0 && a.vault.open_mandates == 0,
            LeashError::VaultHasOpenAccounts
        );
        close_vault_ata(&a.vault, &a.vault_ata, a.owner.to_account_info(), &a.token_program)?;
        emit!(VaultClosed { vault: a.vault.key(), ts: now()? });
        Ok(())
    }
}

/// A live, pending SpendRequest of this vault. Already resolved (closed) or fake → `RequestNotPending`.
fn load_open_request(info: &AccountInfo, vault_key: &Pubkey) -> Result<SpendRequest> {
    let req = load_program_account::<SpendRequest>(info).ok_or(error!(LeashError::RequestNotPending))?;
    require_keys_eq!(req.vault, *vault_key, LeashError::RequestVaultMismatch);
    require!(req.status == RequestStatus::Pending, LeashError::RequestNotPending);
    Ok(req)
}

/// Charge the payment to the authorization that covered it (payee budget or mandate total).
fn settle_authorization(
    auth: &Authorized,
    payee: Option<Payee>,
    mandate: Option<Mandate>,
    payee_info: Option<&AccountInfo>,
    mandate_info: Option<&AccountInfo>,
    amount: u64,
) -> Result<()> {
    match auth.via {
        AuthKind::Payee => {
            let (mut p, info) = payee.zip(payee_info).ok_or(LeashError::PayeeNotAuthorized)?;
            p.spent = p.spent.checked_add(amount).ok_or(LeashError::Overflow)?;
            store_program_account(info, &p)
        }
        AuthKind::Mandate => {
            let (mut m, info) = mandate.zip(mandate_info).ok_or(LeashError::PayeeNotAuthorized)?;
            m.spent = m.spent.checked_add(amount).ok_or(LeashError::Overflow)?;
            store_program_account(info, &m)
        }
        AuthKind::Request => Ok(()),
    }
}

/// Record a refused payment without reverting (guarded_spend, or agent_spend on an enforce_tripwire vault).
fn record_block(vault: &mut Account<Vault>, refusal: Refusal, attempted_payee: Pubkey, amount: u64, reason_hash: [u8; 32], ts: i64) -> Result<()> {
    let vault_key = vault.key();
    vault.blocked_count = vault.blocked_count.checked_add(1).ok_or(LeashError::Overflow)?;
    vault.last_blocked_at = ts;
    if refusal.strike {
        // Strikes count within a 24h strike window that starts at the first strike after the last one ran out.
        if ts.saturating_sub(vault.strike_window_start) >= WINDOW_SECS {
            vault.strikes = 0;
            vault.strike_window_start = ts;
        }
        vault.strikes = vault.strikes.saturating_add(1);
    }
    emit!(PaymentBlocked {
        vault: vault_key,
        attempted_payee,
        amount,
        reason_code: refusal.error.number(),
        reason_hash,
        blocked_count: vault.blocked_count,
        strikes: vault.strikes,
        ts,
        strike: refusal.strike,
    });
    msg!(
        "Leash: payment blocked ({:?}), {}",
        refusal.error,
        if refusal.strike { "strike recorded" } else { "no strike" }
    );
    if refusal.strike && vault.freeze_after_strikes != 0 && vault.strikes >= vault.freeze_after_strikes && !vault.paused {
        vault.paused = true;
        emit!(VaultFrozen { vault: vault_key, strikes: vault.strikes, ts });
        emit!(VaultPausedChanged { vault: vault_key, paused: true, ts });
    }
    Ok(())
}

/// Shared body of agent_spend / guarded_spend. Steps 1-3 are always hard errors (step 1, NotAgent, is the
/// account constraint on `vault`).
fn spend(ctx: Context<Spend>, amount: u64, reason_hash: [u8; 32], memo: Option<[u8; 32]>, guarded: bool) -> Result<()> {
    let ts = now()?;
    require!(!ctx.accounts.vault.paused, LeashError::VaultPaused);
    require!(amount > 0, LeashError::ZeroAmount);

    let vault_key = ctx.accounts.vault.key();
    let payee_info = ctx.accounts.payee_account.as_ref().map(|a| a.to_account_info());
    let mandate_info = ctx.accounts.mandate_account.as_ref().map(|a| a.to_account_info());
    let recipient = ctx.accounts.recipient_ata.to_account_info();
    let token_program = ctx.accounts.token_program.key();

    let outcome = load_authorization(payee_info.as_ref(), mandate_info.as_ref()).and_then(|(payee, mandate)| {
        let auth = check_spend(&SpendCheck {
            vault: &ctx.accounts.vault,
            vault_key,
            payee: payee.as_ref(),
            mandate: mandate.as_ref(),
            recipient: &recipient,
            token_program,
            amount,
            now: ts,
            enforce_cosign: true,
            expected_payee: None,
        })?;
        Ok((auth, payee, mandate))
    });

    let (auth, payee, mandate) = match outcome {
        Ok(ok) => ok,
        Err(r) if r.is_hard() || !guarded => return Err(r.error.into()),
        Err(r) => {
            let attempted_payee = read_token_account(&recipient, &token_program)
                .map(|(owner, _)| owner)
                .unwrap_or(recipient.key());
            return record_block(&mut ctx.accounts.vault, r, attempted_payee, amount, reason_hash, ts);
        }
    };

    let a = &ctx.accounts;
    transfer_from_vault(&a.vault, &a.mint, &a.vault_ata, recipient, &a.token_program, amount)?;
    settle_authorization(&auth, payee, mandate, payee_info.as_ref(), mandate_info.as_ref(), amount)?;

    let accts = ctx.accounts;
    commit_vault_counters(&mut accts.vault, amount, ts, true)?;
    emit!(SpendExecuted {
        vault: vault_key,
        payee: auth.payee,
        amount,
        reason_hash,
        memo,
        via: auth.via,
        ts,
        request: None,
    });
    Ok(())
}
