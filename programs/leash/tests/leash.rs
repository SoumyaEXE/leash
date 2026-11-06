//! Program tests: the happy path of every instruction, one failing test per error, and the invariants from
//! docs/11 §1 (cross-vault substitution, NotOwner everywhere, Ed25519 malformed cases, tripwire classes, rolling
//! window, init front-run, Token-2022 policy). Build first (`anchor build --arch v0`), then `cargo test -p leash`.

mod common;

use anchor_lang::{
    prelude::Pubkey,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        system_instruction, system_program,
    },
    InstructionData, ToAccountMetas,
};
use common::*;
use leash::errors::LeashError;
use leash::events::{
    MandateCreated, MandateSeqBumped, PaymentBlocked, RequestClosed, RequestResolved, SpendExecuted, VaultFrozen,
    Withdrawn,
};
use leash::state::{AuthKind, MandateTerms, Policy, RequestStatus};
use solana_keypair::Keypair;
use solana_signer::Signer;

// ───────────────────────────── the demo: an injected transfer to the attacker ─────────────────────────────

#[test]
fn attacker_payment_is_payee_not_authorized() {
    // S1 demo amount: the injected command asks for 500 dUSDC to the attacker.
    let mut env = setup(demo_policy());
    let before = token_balance(&env.svm, &env.vault_ata);
    let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::None, 500 * ONE, false);
    let res = agent_send(&mut env, &[ix]);
    assert_leash_err(&res, LeashError::PayeeNotAuthorized);
    assert_eq!(token_balance(&env.svm, &env.vault_ata), before);
    assert_eq!(token_balance(&env.svm, &env.attacker_ata), 0);

    // S2 amount (fake-memory invoice of 0.25) is refused the same way: amount doesn't matter, authorization does.
    let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::None, ONE / 4, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);
}

#[test]
fn hostile_402_full_balance_to_attacker_is_blocked() {
    // S5: the hostile API demands the whole vault balance.
    let mut env = setup(demo_policy());
    let all = token_balance(&env.svm, &env.vault_ata);
    let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::None, all, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);
    // Variant: payTo is a real payee but the amount is absurd.
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), all, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ExceedsPayeePerTx);
}

// ───────────────────────────── happy paths ─────────────────────────────

#[test]
fn initialize_and_deposit() {
    let env = setup(demo_policy());
    let v = vault(&env);
    assert_eq!(v.owner, env.owner.pubkey());
    assert_eq!(v.agent, env.agent.pubkey());
    assert_eq!(v.mint, env.mint);
    assert_eq!(v.per_tx_cap, ONE);
    assert_eq!(v.daily_cap, 5 * ONE);
    assert_eq!(v.cosign_threshold, ONE / 5);
    assert_eq!(v.cosign_window_threshold, 0);
    assert!(!v.enforce_tripwire);
    assert!(!v.paused);
    assert_eq!(v.open_payees, 1);
    assert_eq!(v.created_at, T0);
    assert_eq!(v.last_bucket, T0 / HOUR);
    assert_eq!(v.spent_24h(T0), 0);
    assert_eq!(token_balance(&env.svm, &env.vault_ata), 1_000 * ONE);
    let p = payee(&env, &env.merchant);
    assert_eq!(p.label, "Market Data API");
    assert!(p.active);
}

#[test]
fn allowlisted_spend() {
    let mut env = setup(demo_policy());
    let amount = ONE / 20; // 0.05: the market-data x402 call
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), amount, false);
    let res = agent_send(&mut env, &[ix]);
    let ev = ok_events::<SpendExecuted>(&res);
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0].memo, Some([9u8; 32]));
    assert_eq!(ev[0].via, AuthKind::Payee);
    assert_eq!(ev[0].request, None);
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), amount);
    assert_eq!(token_balance(&env.svm, &env.vault_ata), 1_000 * ONE - amount);
    assert_eq!(payee(&env, &env.merchant).spent, amount);
    let v = vault(&env);
    let t = now(&env);
    assert_eq!(v.spent_24h(t), amount);
    assert_eq!(v.autonomous_24h(t), amount);
    assert_eq!(v.total_spent, amount);
}

#[test]
fn mandate_spend() {
    let mut env = setup(no_cosign());
    let newcomer = Pubkey::new_unique();
    let newcomer_ata = ata(&newcomer, &env.mint);
    set_token_account(&mut env.svm, newcomer_ata, &env.mint, &newcomer, 0);
    let exp = now(&env) + 3600;
    let ix = ix_create_mandate(&env, newcomer, ONE, ONE / 2, exp);
    assert_ok(&owner_send(&mut env, &[ix]));
    assert_eq!(vault(&env).mandate_seq, 1);
    assert_eq!(vault(&env).open_mandates, 1);

    let ix = ix_spend(&env, &env.agent.pubkey(), newcomer_ata, Auth::Mandate(0), ONE / 2, false);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(token_balance(&env.svm, &newcomer_ata), ONE / 2);
    assert_eq!(mandate(&env, 0).spent, ONE / 2);
}

#[test]
fn request_then_approve_closes_request_refunds_agent_and_binds_payment() {
    let mut env = setup(demo_policy());
    let amount = ONE / 4; // 0.25 research call, above the 0.20 threshold
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), amount, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::RequiresCosign);

    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), amount);
    assert_ok(&agent_send(&mut env, &[ix]));
    let r = request(&env, 0);
    assert_eq!(r.status, RequestStatus::Pending);
    assert_eq!(r.amount, amount);
    assert_eq!(vault(&env).request_seq, 1);
    assert_eq!(vault(&env).open_requests, 1);
    let rent = lamports(&env.svm, &request_pda(&env.vault, 0));
    let agent_before = lamports(&env.svm, &env.agent.pubkey());

    let ix = ix_approve(&env, 0, env.merchant_ata, Auth::Payee(env.merchant));
    let res = owner_send(&mut env, &[ix]);
    let executed = ok_events::<SpendExecuted>(&res);
    assert_eq!(executed.len(), 1);
    assert_eq!(executed[0].via, AuthKind::Request);
    assert_eq!(executed[0].request, Some(request_pda(&env.vault, 0)), "T10: payment names the request it settles");
    assert_eq!(executed[0].memo, Some([3u8; 32]));
    let resolved = ok_events::<RequestResolved>(&res);
    assert!(resolved[0].approved);

    assert!(is_closed(&env.svm, &request_pda(&env.vault, 0)), "T6: request closed on resolve");
    assert_eq!(lamports(&env.svm, &env.agent.pubkey()), agent_before + rent, "rent back to the agent");
    assert_eq!(vault(&env).open_requests, 0);
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), amount);
    assert_eq!(payee(&env, &env.merchant).spent, amount);
    // A co-signed payment counts against the 24h cap but not the agent's autonomous allowance.
    let v = vault(&env);
    assert_eq!(v.spent_24h(now(&env)), amount);
    assert_eq!(v.autonomous_24h(now(&env)), 0);
}

#[test]
fn request_then_reject_closes_request() {
    let mut env = setup(demo_policy());
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
    assert_ok(&agent_send(&mut env, &[ix]));
    let rent = lamports(&env.svm, &request_pda(&env.vault, 0));
    let agent_before = lamports(&env.svm, &env.agent.pubkey());
    let ix = ix_reject(&env, 0);
    let res = owner_send(&mut env, &[ix]);
    assert!(!ok_events::<RequestResolved>(&res)[0].approved);
    assert!(is_closed(&env.svm, &request_pda(&env.vault, 0)));
    assert_eq!(lamports(&env.svm, &env.agent.pubkey()), agent_before + rent);
    assert_eq!(vault(&env).open_requests, 0);
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), 0);
}

#[test]
fn withdraw_to_owner_emits_event() {
    let mut env = setup(demo_policy());
    let before = token_balance(&env.svm, &env.owner_ata);
    let ix = ix_withdraw(&env, 100 * ONE);
    let res = owner_send(&mut env, &[ix]);
    let ev = ok_events::<Withdrawn>(&res);
    assert_eq!(ev.len(), 1, "T13: withdraw emits an event");
    assert_eq!(ev[0].amount, 100 * ONE);
    assert_eq!(ev[0].to, env.owner_ata);
    assert_eq!(token_balance(&env.svm, &env.owner_ata), before + 100 * ONE);
    assert_eq!(token_balance(&env.svm, &env.vault_ata), 900 * ONE);
}

#[test]
fn owner_can_update_policy_and_payee_and_rotate_agent() {
    let mut env = setup(demo_policy());
    let new_policy = Policy {
        per_tx_cap: 2 * ONE,
        daily_cap: 10 * ONE,
        cosign_threshold: ONE,
        cosign_window_threshold: 3 * ONE,
        enforce_tripwire: true,
        ..demo_policy()
    };
    let data = leash::instruction::UpdatePolicy { policy: new_policy }.data();
    let ix = ix_owner_vault(&env, data, &env.owner.pubkey());
    assert_ok(&owner_send(&mut env, &[ix]));
    let v = vault(&env);
    assert_eq!(v.per_tx_cap, 2 * ONE);
    assert_eq!(v.cosign_window_threshold, 3 * ONE);
    assert!(v.enforce_tripwire);

    let ix = ix_update_payee(&env, env.merchant, ONE, 0, false);
    assert_ok(&owner_send(&mut env, &[ix]));
    let p = payee(&env, &env.merchant);
    assert_eq!(p.per_tx_max, ONE);
    assert!(!p.active);

    let new_agent = Keypair::new();
    let data = leash::instruction::SetAgent { new_agent: new_agent.pubkey() }.data();
    let ix = ix_owner_vault(&env, data, &env.owner.pubkey());
    assert_ok(&owner_send(&mut env, &[ix]));
    assert_eq!(vault(&env).agent, new_agent.pubkey());
}

// ───────────────────────────── one failing test per error ─────────────────────────────

#[test]
fn err_not_agent() {
    let mut env = setup(demo_policy());
    let rogue = Keypair::new();
    env.svm.airdrop(&rogue.pubkey(), 1_000_000_000).unwrap();
    let ix = ix_spend(&env, &rogue.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, false);
    let res = send(&mut env.svm, &[ix], &rogue, &[]);
    assert_leash_err(&res, LeashError::NotAgent);
}

#[test]
fn err_vault_paused() {
    let mut env = setup(demo_policy());
    let data = leash::instruction::SetPaused { paused: true }.data();
    let ix = ix_owner_vault(&env, data, &env.owner.pubkey());
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::VaultPaused);
}

#[test]
fn err_zero_amount() {
    let mut env = setup(demo_policy());
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), 0, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ZeroAmount);
}

#[test]
fn err_recipient_mismatch() {
    // Valid payee authorization, but the money would land in the attacker's token account.
    let mut env = setup(demo_policy());
    let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::Payee(env.merchant), ONE / 20, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::RecipientMismatch);
}

#[test]
fn err_recipient_must_be_payee_ata_not_any_payee_account() {
    // T4: a token account the merchant owns but never watches (not its ATA) is refused.
    let mut env = setup(demo_policy());
    let stray = Pubkey::new_unique();
    set_token_account(&mut env.svm, stray, &env.mint, &env.merchant, 0);
    let ix = ix_spend(&env, &env.agent.pubkey(), stray, Auth::Payee(env.merchant), ONE / 20, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::RecipientMismatch);
    assert_eq!(token_balance(&env.svm, &stray), 0);
}

#[test]
fn err_inactive_payee_is_not_authorized() {
    let mut env = setup(demo_policy());
    let ix = ix_update_payee(&env, env.merchant, ONE / 2, 5 * ONE, false);
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);
}

#[test]
fn err_stale_payee_pda_is_named_error() {
    // T13: a removed (closed) payee PDA is PayeeNotAuthorized, not Anchor's AccountNotInitialized (3012).
    let mut env = setup(demo_policy());
    let ix = ix_remove_payee(&env, env.merchant);
    assert_ok(&owner_send(&mut env, &[ix]));
    assert!(is_closed(&env.svm, &payee_pda(&env.vault, &env.merchant)));
    assert_eq!(vault(&env).open_payees, 0);
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);
}

#[test]
fn err_exceeds_payee_per_tx() {
    let mut env = setup(no_cosign());
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE * 6 / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ExceedsPayeePerTx);
}

#[test]
fn err_payee_budget_exceeded() {
    let mut env = setup(no_cosign());
    let ix = ix_update_payee(&env, env.merchant, ONE / 2, ONE, true);
    assert_ok(&owner_send(&mut env, &[ix]));
    for _ in 0..2 {
        let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 2, false);
        assert_ok(&agent_send(&mut env, &[ix]));
    }
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeBudgetExceeded);
}

fn env_with_mandate(policy: Policy, max_total: u64, max_per_tx: u64, ttl: i64) -> (Env, Pubkey, Pubkey) {
    let mut env = setup(policy);
    let newcomer = Pubkey::new_unique();
    let newcomer_ata = ata(&newcomer, &env.mint);
    set_token_account(&mut env.svm, newcomer_ata, &env.mint, &newcomer, 0);
    let exp = now(&env) + ttl;
    let ix = ix_create_mandate(&env, newcomer, max_total, max_per_tx, exp);
    assert_ok(&owner_send(&mut env, &[ix]));
    (env, newcomer, newcomer_ata)
}

#[test]
fn err_mandate_expired() {
    let (mut env, _, to) = env_with_mandate(no_cosign(), ONE, ONE / 2, 60);
    warp(&mut env, 61);
    let ix = ix_spend(&env, &env.agent.pubkey(), to, Auth::Mandate(0), ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::MandateExpired);
}

#[test]
fn err_mandate_revoked() {
    let (mut env, _, to) = env_with_mandate(no_cosign(), ONE, ONE / 2, 3600);
    let ix = ix_revoke_mandate(&env, 0);
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_spend(&env, &env.agent.pubkey(), to, Auth::Mandate(0), ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::MandateRevoked);
}

#[test]
fn err_mandate_exhausted() {
    let (mut env, _, to) = env_with_mandate(no_cosign(), ONE / 2, ONE / 2, 3600);
    let ix = ix_spend(&env, &env.agent.pubkey(), to, Auth::Mandate(0), ONE * 4 / 10, false);
    assert_ok(&agent_send(&mut env, &[ix]));
    let ix = ix_spend(&env, &env.agent.pubkey(), to, Auth::Mandate(0), ONE * 2 / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::MandateExhausted);
}

#[test]
fn err_mandate_per_tx() {
    let (mut env, _, to) = env_with_mandate(no_cosign(), ONE, ONE / 10, 3600);
    let ix = ix_spend(&env, &env.agent.pubkey(), to, Auth::Mandate(0), ONE / 5, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ExceedsPayeePerTx);
}

#[test]
fn err_mandate_for_other_payee_is_recipient_mismatch() {
    let (mut env, _, _to) = env_with_mandate(no_cosign(), ONE, ONE / 2, 3600);
    let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::Mandate(0), ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::RecipientMismatch);
}

#[test]
fn err_exceeds_per_tx_cap() {
    let mut env = setup(no_cosign());
    let (big, big_ata) = add_funded_payee(&mut env, "Big Spender", 10 * ONE, 0);
    let ix = ix_spend(&env, &env.agent.pubkey(), big_ata, Auth::Payee(big), 2 * ONE, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ExceedsPerTxCap);
}

#[test]
fn err_exceeds_daily_cap() {
    let mut env = setup(Policy { per_tx_cap: ONE, daily_cap: ONE, cosign_threshold: 0, ..demo_policy() });
    for _ in 0..2 {
        let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 2, false);
        assert_ok(&agent_send(&mut env, &[ix]));
    }
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 100, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ExceedsDailyCap);
}

#[test]
fn err_requires_cosign() {
    let mut env = setup(demo_policy());
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 5, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::RequiresCosign);
}

#[test]
fn err_request_not_pending_on_double_approve() {
    let mut env = setup(demo_policy());
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
    assert_ok(&agent_send(&mut env, &[ix]));
    let approve = ix_approve(&env, 0, env.merchant_ata, Auth::Payee(env.merchant));
    assert_ok(&owner_send(&mut env, &[approve.clone()]));
    // The request is closed now: a second approve / reject is a named error, not Anchor 3012.
    assert_leash_err(&owner_send(&mut env, &[approve]), LeashError::RequestNotPending);
    let ix = ix_reject(&env, 0);
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::RequestNotPending);
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), ONE / 4, "paid once");
}

#[test]
fn err_request_expired() {
    let mut env = setup(demo_policy());
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
    assert_ok(&agent_send(&mut env, &[ix]));
    warp(&mut env, 3601);
    let approve = ix_approve(&env, 0, env.merchant_ata, Auth::Payee(env.merchant));
    assert_leash_err(&owner_send(&mut env, &[approve]), LeashError::RequestExpired);
}

#[test]
fn err_request_to_attacker_is_refused_upfront() {
    let mut env = setup(demo_policy());
    let ix = ix_request(&env, env.attacker, Auth::None, ONE / 4);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);
    // Using the merchant's allowlist entry to request a payment to the attacker doesn't work either.
    let ix = ix_request(&env, env.attacker, Auth::Payee(env.merchant), ONE / 4);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);
}

#[test]
fn err_invalid_policy() {
    let mut env = setup(demo_policy());
    let bad = Policy { per_tx_cap: 5 * ONE, daily_cap: ONE, ..demo_policy() };
    let data = leash::instruction::UpdatePolicy { policy: bad }.data();
    let ix = ix_owner_vault(&env, data, &env.owner.pubkey());
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::InvalidPolicy);
}

#[test]
fn err_label_too_long() {
    let mut env = setup(demo_policy());
    let ix = ix_add_payee(&env, Pubkey::new_unique(), &"x".repeat(33), ONE, 0);
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::LabelTooLong);
}

#[test]
fn err_insufficient_funds() {
    let mut env = setup(no_cosign());
    let ix = ix_withdraw(&env, 1_000 * ONE);
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::InsufficientFunds);
}

#[test]
fn err_invalid_mandate_terms() {
    let mut env = setup(demo_policy());
    let past = now(&env) - 1;
    let ix = ix_create_mandate(&env, Pubkey::new_unique(), ONE, ONE / 2, past);
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::InvalidMandateTerms);
    let fut = now(&env) + 3600;
    let ix = ix_create_mandate(&env, Pubkey::new_unique(), ONE / 2, ONE, fut); // per-tx > total
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::InvalidMandateTerms);
}

#[test]
fn err_agent_is_owner() {
    // T13: an owner key that is also the agent key would let a hijacked agent approve its own requests.
    let mut env = base_env();
    let ix = ix_initialize(&env, env.vault_id, env.owner.pubkey(), demo_policy());
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::AgentIsOwner);

    let mut env = setup(demo_policy());
    let data = leash::instruction::SetAgent { new_agent: env.owner.pubkey() }.data();
    let ix = ix_owner_vault(&env, data, &env.owner.pubkey());
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::AgentIsOwner);
}

// ───────────────────────────── NotOwner on every owner instruction ─────────────────────────────

#[test]
fn err_not_owner_on_every_owner_ix() {
    let (mut env, _, _) = env_with_mandate(demo_policy(), ONE, ONE / 2, 3600);
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
    assert_ok(&agent_send(&mut env, &[ix]));

    let rogue = Keypair::new();
    env.svm.airdrop(&rogue.pubkey(), 5_000_000_000).unwrap();
    let o = env.owner.pubkey();
    let cases: Vec<(&str, Instruction)> = vec![
        ("update_policy", ix_owner_vault(&env, leash::instruction::UpdatePolicy { policy: demo_policy() }.data(), &o)),
        ("set_agent", ix_owner_vault(&env, leash::instruction::SetAgent { new_agent: rogue.pubkey() }.data(), &o)),
        ("set_paused", ix_owner_vault(&env, leash::instruction::SetPaused { paused: true }.data(), &o)),
        ("reset_strikes", ix_owner_vault(&env, leash::instruction::ResetStrikes {}.data(), &o)),
        ("bump_mandate_seq", ix_bump_mandate_seq(&env, 10)),
        ("add_payee", ix_add_payee(&env, rogue.pubkey(), "rogue", ONE, 0)),
        ("update_payee", ix_update_payee(&env, env.merchant, ONE, 0, true)),
        ("remove_payee", ix_remove_payee(&env, env.merchant)),
        ("create_mandate", ix_create_mandate(&env, rogue.pubkey(), ONE, ONE, now(&env) + 60)),
        ("revoke_mandate", ix_revoke_mandate(&env, 0)),
        ("close_mandate", ix_close_mandate(&env, 0)),
        ("approve_request", ix_approve(&env, 0, env.merchant_ata, Auth::Payee(env.merchant))),
        ("reject_request", ix_reject(&env, 0)),
        ("withdraw", ix_withdraw(&env, ONE)),
        ("close_vault", ix_close_vault(&env)),
    ];
    for (name, mut ix) in cases {
        assert_eq!(ix.accounts[0].pubkey, o, "{name}: owner is account 0");
        ix.accounts[0] = AccountMeta { pubkey: rogue.pubkey(), is_signer: true, is_writable: ix.accounts[0].is_writable };
        let res = send(&mut env.svm, &[ix], &rogue, &[]);
        match &res {
            Err(f) if format!("{:?}", f.err).contains(&format!("Custom({})", code(LeashError::NotOwner))) => {}
            other => panic!("{name}: expected NotOwner, got {:?}", other.as_ref().map(|_| ()).map_err(|f| f.err.clone())),
        }
    }
    // Nothing moved.
    assert_eq!(token_balance(&env.svm, &env.vault_ata), 1_000 * ONE);
    assert_eq!(vault(&env).agent, env.agent.pubkey());
    assert!(!vault(&env).paused);
}

// ───────────────────────────── cross-vault substitution (the key invariant) ─────────────────────────────

/// An attacker-owned vault B (same mint) that allowlists the attacker and holds a mandate for the attacker.
fn attacker_vault(env: &mut Env) -> Pubkey {
    let evil = Keypair::new();
    let evil_agent = Keypair::new();
    env.svm.airdrop(&evil.pubkey(), 5_000_000_000).unwrap();
    let vault_b = vault_pda(&evil.pubkey(), 1);
    let init = Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::InitializeVault { vault_id: 1, agent: evil_agent.pubkey(), policy: no_cosign() }.data(),
        leash::accounts::InitializeVault {
            owner: evil.pubkey(),
            vault: vault_b,
            mint: env.mint,
            vault_ata: ata(&vault_b, &env.mint),
            token_program: TOKEN_PROGRAM,
            associated_token_program: ATA_PROGRAM,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let add = Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::AddPayee { payee: env.attacker, label: "me".into(), per_tx_max: 1_000 * ONE, budget_total: 0 }
            .data(),
        leash::accounts::AddPayee {
            owner: evil.pubkey(),
            vault: vault_b,
            payee_account: payee_pda(&vault_b, &env.attacker),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let mandate = Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::CreateMandate {
            payee: env.attacker,
            max_total: 1_000 * ONE,
            max_per_tx: 1_000 * ONE,
            expires_at: now(env) + DAY,
            intent_hash: [0u8; 32],
        }
        .data(),
        leash::accounts::CreateMandate {
            owner: evil.pubkey(),
            vault: vault_b,
            mandate: mandate_pda(&vault_b, 0),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    assert_ok(&send(&mut env.svm, &[init, add, mandate], &evil, &[]));
    vault_b
}

#[test]
fn cross_vault_payee_or_mandate_is_payee_not_authorized() {
    let mut env = setup(no_cosign());
    let vault_b = attacker_vault(&mut env);
    let b_payee = payee_pda(&vault_b, &env.attacker);
    let b_mandate = mandate_pda(&vault_b, 0);

    // Strict path.
    let ix = ix_spend_raw(&env, &env.agent.pubkey(), env.attacker_ata, Some(b_payee), None, ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);
    let ix = ix_spend_raw(&env, &env.agent.pubkey(), env.attacker_ata, None, Some(b_mandate), ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);

    // Tripwire path: recorded as a strike, nothing paid.
    let ix = ix_spend_raw(&env, &env.agent.pubkey(), env.attacker_ata, Some(b_payee), None, ONE / 10, true);
    let res = agent_send(&mut env, &[ix]);
    let blocked = ok_events::<PaymentBlocked>(&res);
    assert_eq!(blocked[0].reason_code as u32, code(LeashError::PayeeNotAuthorized));
    assert!(blocked[0].strike);

    // request_spend with vault B's payee.
    let ix = ix_request_raw(&env, env.attacker, Some(b_payee), None, ONE / 10);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);
    let ix = ix_request_raw(&env, env.attacker, None, Some(b_mandate), ONE / 10);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);

    // approve_request: a legit request for the merchant, approved with vault B's payee + attacker ATA.
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 10);
    assert_ok(&agent_send(&mut env, &[ix]));
    let ix = ix_approve_raw(&env, 0, env.attacker_ata, Some(b_payee), None);
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);

    assert_eq!(token_balance(&env.svm, &env.attacker_ata), 0);
    assert_eq!(token_balance(&env.svm, &env.vault_ata), 1_000 * ONE);
}

// ───────────────────────────── request_spend / approve_request cases ─────────────────────────────

#[test]
fn request_spend_refusals() {
    let mut env = setup(demo_policy());
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), 0);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ZeroAmount);
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE * 6 / 10);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ExceedsPayeePerTx);

    let (big, _) = add_funded_payee(&mut env, "Big", 10 * ONE, 0);
    let ix = ix_request(&env, big, Auth::Payee(big), 2 * ONE);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ExceedsPerTxCap);

    let (small, _) = add_funded_payee(&mut env, "Small budget", ONE / 2, ONE * 3 / 10);
    let ix = ix_request(&env, small, Auth::Payee(small), ONE * 4 / 10);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeBudgetExceeded);

    let data = leash::instruction::SetPaused { paused: true }.data();
    let ix = ix_owner_vault(&env, data, &env.owner.pubkey());
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::VaultPaused);
}

#[test]
fn request_spend_via_mandate_then_approve() {
    let (mut env, newcomer, to) = env_with_mandate(demo_policy(), ONE, ONE / 2, 3600);
    let ix = ix_request(&env, newcomer, Auth::Mandate(0), ONE * 4 / 10);
    assert_ok(&agent_send(&mut env, &[ix]));
    let ix = ix_approve(&env, 0, to, Auth::Mandate(0));
    assert_ok(&owner_send(&mut env, &[ix]));
    assert_eq!(token_balance(&env.svm, &to), ONE * 4 / 10);
    assert_eq!(mandate(&env, 0).spent, ONE * 4 / 10);

    // Mandate expired → refused upfront.
    warp(&mut env, 3601);
    let ix = ix_request(&env, newcomer, Auth::Mandate(0), ONE / 10);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::MandateExpired);
}

#[test]
fn approve_rechecks_authorization() {
    let mut env = setup(demo_policy());
    let (other, other_ata) = add_funded_payee(&mut env, "Other API", ONE / 2, 0);
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
    assert_ok(&agent_send(&mut env, &[ix]));

    // Another allowlisted payee's account can't settle the merchant's request.
    let ix = ix_approve(&env, 0, other_ata, Auth::Payee(other));
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);
    // Right payee, wrong recipient.
    let ix = ix_approve(&env, 0, env.attacker_ata, Auth::Payee(env.merchant));
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::RecipientMismatch);
    // Payee deactivated between request and approve.
    let ix = ix_update_payee(&env, env.merchant, ONE / 2, 5 * ONE, false);
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_approve(&env, 0, env.merchant_ata, Auth::Payee(env.merchant));
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);
    assert_eq!(vault(&env).open_requests, 1, "still open after refused approvals");
}

#[test]
fn approve_after_mandate_revoked_is_refused() {
    let (mut env, newcomer, to) = env_with_mandate(demo_policy(), ONE, ONE / 2, 3600);
    let ix = ix_request(&env, newcomer, Auth::Mandate(0), ONE / 4);
    assert_ok(&agent_send(&mut env, &[ix]));
    let ix = ix_revoke_mandate(&env, 0);
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_approve(&env, 0, to, Auth::Mandate(0));
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::MandateRevoked);
}

// ───────────────────────────── T6: open-request cap, crank, close accounts ─────────────────────────────

#[test]
fn open_requests_are_capped() {
    let mut env = setup(demo_policy());
    for _ in 0..leash::state::MAX_OPEN_REQUESTS {
        let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
        assert_ok(&agent_send(&mut env, &[ix]));
    }
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::TooManyOpenRequests);
    let ix = ix_reject(&env, 0);
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(vault(&env).open_requests, leash::state::MAX_OPEN_REQUESTS);
}

#[test]
fn anyone_can_close_an_expired_request() {
    let mut env = setup(demo_policy());
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
    assert_ok(&agent_send(&mut env, &[ix]));
    let rent = lamports(&env.svm, &request_pda(&env.vault, 0));
    let cranker = Keypair::new();
    env.svm.airdrop(&cranker.pubkey(), 1_000_000_000).unwrap();

    let ix = ix_close_request(&env, 0);
    assert_leash_err(&send(&mut env.svm, &[ix.clone()], &cranker, &[]), LeashError::RequestNotExpired);
    warp(&mut env, 3601);
    let agent_before = lamports(&env.svm, &env.agent.pubkey());
    let res = send(&mut env.svm, &[ix.clone()], &cranker, &[]);
    assert_eq!(ok_events::<RequestClosed>(&res).len(), 1);
    assert!(is_closed(&env.svm, &request_pda(&env.vault, 0)));
    assert_eq!(lamports(&env.svm, &env.agent.pubkey()), agent_before + rent);
    assert_eq!(vault(&env).open_requests, 0);
    assert_leash_err(&send(&mut env.svm, &[ix], &cranker, &[]), LeashError::RequestNotPending);
}

#[test]
fn close_mandate_refunds_owner_and_stale_mandate_is_refused() {
    let (mut env, _, to) = env_with_mandate(no_cosign(), ONE, ONE / 2, 3600);
    let rent = lamports(&env.svm, &mandate_pda(&env.vault, 0));
    let owner_before = lamports(&env.svm, &env.owner.pubkey());
    let ix = ix_close_mandate(&env, 0);
    assert_ok(&owner_send(&mut env, &[ix]));
    assert!(is_closed(&env.svm, &mandate_pda(&env.vault, 0)));
    assert_eq!(lamports(&env.svm, &env.owner.pubkey()), owner_before + rent - 5_000);
    assert_eq!(vault(&env).open_mandates, 0);
    let ix = ix_spend(&env, &env.agent.pubkey(), to, Auth::Mandate(0), ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeNotAuthorized);
}

#[test]
fn close_vault_requires_empty_vault_and_no_open_accounts() {
    let mut env = setup(demo_policy());
    let ix = ix_close_vault(&env);
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::VaultJustOpened);
    warp(&mut env, 1);
    let ix = ix_close_vault(&env);
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::VaultNotEmpty);
    let ix = ix_withdraw(&env, 1_000 * ONE);
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_close_vault(&env);
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::VaultHasOpenAccounts);
    let ix = ix_remove_payee(&env, env.merchant);
    assert_ok(&owner_send(&mut env, &[ix]));

    let reclaim = lamports(&env.svm, &env.vault) + lamports(&env.svm, &env.vault_ata);
    let owner_before = lamports(&env.svm, &env.owner.pubkey());
    let ix = ix_close_vault(&env);
    assert_ok(&owner_send(&mut env, &[ix]));
    assert!(is_closed(&env.svm, &env.vault));
    assert!(is_closed(&env.svm, &env.vault_ata));
    assert_eq!(lamports(&env.svm, &env.owner.pubkey()), owner_before + reclaim - 5_000);
}

// ───────────────────────────── T3: rolling 24h window ─────────────────────────────

fn one_dollar_cap_env() -> (Env, Pubkey, Pubkey) {
    let mut env = setup(Policy { per_tx_cap: ONE, daily_cap: ONE, cosign_threshold: 0, ..demo_policy() });
    let (p, p_ata) = add_funded_payee(&mut env, "Data", ONE, 0);
    (env, p, p_ata)
}

#[test]
fn rolling_cap_blocks_the_boundary_burst() {
    // The old fixed window (start = init) allowed 1.00 at T+23:59:58 and another 1.00 two seconds later.
    let (mut env, p, p_ata) = one_dollar_cap_env();
    warp(&mut env, DAY - 2);
    let ix = ix_spend(&env, &env.agent.pubkey(), p_ata, Auth::Payee(p), ONE, false);
    assert_ok(&agent_send(&mut env, &[ix]));
    warp(&mut env, 2);
    let ix = ix_spend(&env, &env.agent.pubkey(), p_ata, Auth::Payee(p), ONE, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ExceedsDailyCap);
    // Still counted a full 24h later (hourly buckets: a payment counts for 24-25h) ...
    warp(&mut env, DAY - 2);
    let ix = ix_spend(&env, &env.agent.pubkey(), p_ata, Auth::Payee(p), ONE / 100, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ExceedsDailyCap);
    // ... and released after 25h.
    warp(&mut env, HOUR + 2);
    let ix = ix_spend(&env, &env.agent.pubkey(), p_ata, Auth::Payee(p), ONE, false);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(token_balance(&env.svm, &p_ata), 2 * ONE);
}

#[test]
fn rolling_cap_sums_any_24h_period() {
    let (mut env, p, p_ata) = one_dollar_cap_env();
    let pay = |env: &Env, amount: u64| ix_spend(env, &env.agent.pubkey(), p_ata, Auth::Payee(p), amount, false);
    let ix = pay(&env, ONE * 4 / 10);
    assert_ok(&agent_send(&mut env, &[ix])); // t = 0h: 0.40
    warp(&mut env, 12 * HOUR);
    let ix = pay(&env, ONE * 4 / 10);
    assert_ok(&agent_send(&mut env, &[ix])); // t = 12h: 0.80 in the last 24h
    warp(&mut env, 8 * HOUR);
    let ix = pay(&env, ONE * 4 / 10);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ExceedsDailyCap); // t = 20h: would be 1.20
    warp(&mut env, 6 * HOUR);
    assert_eq!(vault(&env).spent_24h(now(&env)), ONE * 4 / 10, "t = 26h: the first 0.40 has rolled out");
    let ix = pay(&env, ONE * 6 / 10);
    assert_ok(&agent_send(&mut env, &[ix]));
    let ix = pay(&env, ONE / 100);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ExceedsDailyCap);
    // A quiet stretch longer than the ring clears everything.
    warp(&mut env, 3 * DAY);
    assert_eq!(vault(&env).spent_24h(now(&env)), 0);
    let ix = pay(&env, ONE);
    assert_ok(&agent_send(&mut env, &[ix]));
}

// ───────────────────────────── T9: co-sign on the aggregate ─────────────────────────────

#[test]
fn cosign_window_threshold_stops_split_payments() {
    // Per-payment threshold 0.20 and autonomous 24h threshold 0.20: 5 x 0.19 no longer dodges the co-sign.
    let mut env = setup(Policy { cosign_window_threshold: ONE / 5, ..demo_policy() });
    let pay = |env: &Env, amount: u64, guarded: bool| {
        ix_spend(env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), amount, guarded)
    };
    let nineteen = ONE * 19 / 100;
    let ix = pay(&env, nineteen, false);
    assert_ok(&agent_send(&mut env, &[ix]));
    let ix = pay(&env, nineteen, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::RequiresCosign);
    let ix = pay(&env, ONE / 100, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::RequiresCosign); // 0.20 total reaches it
    // Guarded path: still a hard error, never a strike.
    let ix = pay(&env, nineteen, true);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::RequiresCosign);
    assert_eq!(vault(&env).strikes, 0);

    // The owner co-signs the second one; co-signed money doesn't use up the autonomous allowance.
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), nineteen);
    assert_ok(&agent_send(&mut env, &[ix]));
    let ix = ix_approve(&env, 0, env.merchant_ata, Auth::Payee(env.merchant));
    assert_ok(&owner_send(&mut env, &[ix]));
    let v = vault(&env);
    assert_eq!(v.autonomous_24h(now(&env)), nineteen);
    assert_eq!(v.spent_24h(now(&env)), 2 * nineteen);

    // The allowance frees up as the window rolls.
    warp(&mut env, DAY + HOUR);
    let ix = pay(&env, nineteen, false);
    assert_ok(&agent_send(&mut env, &[ix]));
}

// ───────────────────────────── tripwire (guarded_spend) ─────────────────────────────

#[test]
fn tripwire_three_strikes_freezes_then_owner_unfreezes() {
    let mut env = setup(Policy { freeze_after_strikes: 3, ..demo_policy() });
    for i in 1..=3u8 {
        let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::None, 500 * ONE, true);
        // guarded: the refusal does NOT revert, it's recorded onchain
        let res = agent_send(&mut env, &[ix]);
        let ev = ok_events::<PaymentBlocked>(&res);
        assert!(ev[0].strike);
        assert_eq!(ev[0].attempted_payee, env.attacker);
        let v = vault(&env);
        assert_eq!(v.strikes, i);
        assert_eq!(v.blocked_count, i as u64);
        if i == 3 {
            assert_eq!(ok_events::<VaultFrozen>(&res).len(), 1);
        }
    }
    assert!(vault(&env).paused, "3 strikes auto-pause the vault");
    assert_eq!(token_balance(&env.svm, &env.attacker_ata), 0);

    // A legitimate spend now fails: frozen.
    let legit = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, true);
    assert_leash_err(&agent_send(&mut env, &[legit.clone()]), LeashError::VaultPaused);

    // Owner unfreezes (also clears strikes) → legit spend works; blocked_count history is kept.
    let data = leash::instruction::SetPaused { paused: false }.data();
    let ix = ix_owner_vault(&env, data, &env.owner.pubkey());
    assert_ok(&owner_send(&mut env, &[ix]));
    assert_eq!(vault(&env).strikes, 0);
    assert_ok(&agent_send(&mut env, &[legit]));
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), ONE / 20);
    assert_eq!(vault(&env).blocked_count, 3);
}

#[test]
fn tripwire_benign_errors_never_strike() {
    // T1: an honest agent that hits its caps 3x must not freeze its own vault.
    let mut env = setup(Policy { per_tx_cap: ONE, daily_cap: ONE, cosign_threshold: 0, freeze_after_strikes: 3, ..demo_policy() });
    for _ in 0..2 {
        let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 2, true);
        assert_ok(&agent_send(&mut env, &[ix]));
    }
    for i in 1..=3u64 {
        let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 10, true);
        let res = agent_send(&mut env, &[ix]);
        let ev = ok_events::<PaymentBlocked>(&res);
        assert_eq!(ev[0].reason_code as u32, code(LeashError::ExceedsDailyCap));
        assert!(!ev[0].strike);
        assert_eq!(vault(&env).blocked_count, i);
    }
    // Other benign classes: payee per-tx, missing payee ATA, payee's own non-ATA account.
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE * 6 / 10, true);
    assert!(!ok_events::<PaymentBlocked>(&agent_send(&mut env, &[ix]))[0].strike);
    let no_ata = Pubkey::new_unique();
    let ix = ix_add_payee(&env, no_ata, "No ATA yet", ONE / 2, 0);
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_spend(&env, &env.agent.pubkey(), ata(&no_ata, &env.mint), Auth::Payee(no_ata), ONE / 20, true);
    let ev = ok_events::<PaymentBlocked>(&agent_send(&mut env, &[ix]));
    assert_eq!(ev[0].reason_code as u32, code(LeashError::RecipientMismatch));
    assert!(!ev[0].strike);
    let stray = Pubkey::new_unique();
    set_token_account(&mut env.svm, stray, &env.mint, &env.merchant, 0);
    let ix = ix_spend(&env, &env.agent.pubkey(), stray, Auth::Payee(env.merchant), ONE / 20, true);
    assert!(!ok_events::<PaymentBlocked>(&agent_send(&mut env, &[ix]))[0].strike);

    let v = vault(&env);
    assert_eq!(v.strikes, 0);
    assert!(!v.paused);
    assert_eq!(v.blocked_count, 6);
}

#[test]
fn tripwire_redirect_to_foreign_account_is_a_strike() {
    let mut env = setup(demo_policy());
    let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::Payee(env.merchant), ONE / 20, true);
    let ev = ok_events::<PaymentBlocked>(&agent_send(&mut env, &[ix]));
    assert_eq!(ev[0].reason_code as u32, code(LeashError::RecipientMismatch));
    assert!(ev[0].strike);
    assert_eq!(vault(&env).strikes, 1);
}

#[test]
fn tripwire_stale_payee_pda_is_recorded() {
    let mut env = setup(demo_policy());
    let ix = ix_remove_payee(&env, env.merchant);
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, true);
    let ev = ok_events::<PaymentBlocked>(&agent_send(&mut env, &[ix]));
    assert_eq!(ev[0].reason_code as u32, code(LeashError::PayeeNotAuthorized));
    assert_eq!(vault(&env).blocked_count, 1);
}

#[test]
fn tripwire_strikes_decay_with_the_window() {
    let mut env = setup(Policy { freeze_after_strikes: 3, ..demo_policy() });
    let strike = |env: &Env| ix_spend(env, &env.agent.pubkey(), env.attacker_ata, Auth::None, ONE, true);
    for _ in 0..2 {
        let ix = strike(&env);
        assert_ok(&agent_send(&mut env, &[ix]));
    }
    assert_eq!(vault(&env).strikes, 2);
    warp(&mut env, DAY);
    let ix = strike(&env);
    assert_ok(&agent_send(&mut env, &[ix]));
    let v = vault(&env);
    assert_eq!(v.strikes, 1, "old strikes expired with their window");
    assert!(!v.paused);
    assert_eq!(v.blocked_count, 3);
    for _ in 0..2 {
        let ix = strike(&env);
        assert_ok(&agent_send(&mut env, &[ix]));
    }
    assert!(vault(&env).paused, "3 strikes inside one window still freeze");
}

#[test]
fn tripwire_threshold_lowered_mid_life() {
    let mut env = setup(Policy { freeze_after_strikes: 5, ..demo_policy() });
    for _ in 0..2 {
        let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::None, ONE, true);
        assert_ok(&agent_send(&mut env, &[ix]));
    }
    let data = leash::instruction::UpdatePolicy { policy: Policy { freeze_after_strikes: 2, ..demo_policy() } }.data();
    let ix = ix_owner_vault(&env, data, &env.owner.pubkey());
    assert_ok(&owner_send(&mut env, &[ix]));
    assert!(!vault(&env).paused, "lowering the threshold doesn't freeze by itself");
    let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::None, ONE, true);
    assert_ok(&agent_send(&mut env, &[ix]));
    let v = vault(&env);
    assert_eq!(v.strikes, 3);
    assert!(v.paused, "next strike freezes");
}

#[test]
fn enforce_tripwire_makes_agent_spend_record_strikes() {
    // T2: with the owner flag set, a stolen agent key can't skip the strike by calling the strict path.
    let mut env = setup(Policy { enforce_tripwire: true, freeze_after_strikes: 2, ..demo_policy() });
    for _ in 0..2 {
        let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::None, 500 * ONE, false);
        let ev = ok_events::<PaymentBlocked>(&agent_send(&mut env, &[ix]));
        assert!(ev[0].strike);
    }
    let v = vault(&env);
    assert_eq!(v.strikes, 2);
    assert!(v.paused);
    assert_eq!(token_balance(&env.svm, &env.attacker_ata), 0);
    // Legit strict spends still work on an unfrozen enforce_tripwire vault.
    let data = leash::instruction::SetPaused { paused: false }.data();
    let ix = ix_owner_vault(&env, data, &env.owner.pubkey());
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, false);
    assert_eq!(ok_events::<SpendExecuted>(&agent_send(&mut env, &[ix])).len(), 1);
}

#[test]
fn tripwire_zero_never_freezes() {
    let mut env = setup(demo_policy()); // freeze_after_strikes = 0 (Arena vault)
    for _ in 0..5 {
        let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::None, ONE, true);
        assert_ok(&agent_send(&mut env, &[ix]));
    }
    let v = vault(&env);
    assert!(!v.paused);
    assert_eq!(v.blocked_count, 5);
}

#[test]
fn tripwire_records_recipient_without_token_account() {
    // Arena visitors usually have no dUSDC token account: still a recorded block, not a raw failure.
    let mut env = setup(demo_policy());
    let visitor = Pubkey::new_unique();
    let ix = ix_spend(&env, &env.agent.pubkey(), ata(&visitor, &env.mint), Auth::None, ONE, true);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(vault(&env).blocked_count, 1);
}

#[test]
fn tripwire_legit_spend_and_cosign_still_hard_error() {
    let mut env = setup(demo_policy());
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, true);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), ONE / 20);
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 4, true);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::RequiresCosign);
    assert_eq!(vault(&env).strikes, 0);
}

#[test]
fn owner_reset_strikes() {
    let mut env = setup(demo_policy());
    let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::None, ONE, true);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(vault(&env).strikes, 1);
    let ix = ix_owner_vault(&env, leash::instruction::ResetStrikes {}.data(), &env.owner.pubkey());
    assert_ok(&owner_send(&mut env, &[ix]));
    assert_eq!(vault(&env).strikes, 0);
}

// ───────────────────────────── T7: init front-run ─────────────────────────────

#[test]
fn init_succeeds_when_vault_ata_was_precreated() {
    let mut env = base_env();
    let griefer = Keypair::new();
    env.svm.airdrop(&griefer.pubkey(), 1_000_000_000).unwrap();
    let ix = create_ata_ix(&griefer.pubkey(), &env.vault, &env.mint, &TOKEN_PROGRAM);
    assert_ok(&send(&mut env.svm, &[ix], &griefer, &[]));
    assert!(!is_closed(&env.svm, &env.vault_ata), "griefer created the vault's ATA first");

    let ix = ix_initialize(&env, env.vault_id, env.agent.pubkey(), demo_policy());
    assert_ok(&owner_send(&mut env, &[ix]));
    let dep = spl_transfer_ix(&env.owner_ata, &env.vault_ata, &env.owner.pubkey(), 10 * ONE);
    assert_ok(&owner_send(&mut env, &[dep]));
    let ix = ix_add_payee(&env, env.merchant, "Market Data API", ONE / 2, 0);
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, false);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), ONE / 20);
}

// ───────────────────────────── T8: Token-2022 mint policy ─────────────────────────────

const EXT_TRANSFER_FEE_CONFIG: u16 = 1;
const EXT_PERMANENT_DELEGATE: u16 = 12;
const EXT_TRANSFER_HOOK: u16 = 14;
const EXT_METADATA_POINTER: u16 = 18;

fn init_with_2022_mint(exts: &[(u16, Vec<u8>)]) -> (Env, TxResult) {
    let data = mint_2022_with_extensions(&Pubkey::new_unique(), 3_000 * ONE, exts);
    let mut env = base_env_with_mint(TOKEN_2022_PROGRAM, Some(data));
    let ix = ix_initialize(&env, env.vault_id, env.agent.pubkey(), no_cosign());
    let res = owner_send(&mut env, &[ix]);
    (env, res)
}

#[test]
fn token_2022_risky_mints_are_refused() {
    let delegate = Pubkey::new_unique();
    for (name, ext) in [
        ("transfer fee", (EXT_TRANSFER_FEE_CONFIG, vec![0u8; 108])),
        ("permanent delegate", (EXT_PERMANENT_DELEGATE, delegate.to_bytes().to_vec())),
        ("transfer hook", (EXT_TRANSFER_HOOK, [Pubkey::new_unique().to_bytes(), Pubkey::new_unique().to_bytes()].concat())),
    ] {
        let (env, res) = init_with_2022_mint(&[ext]);
        match &res {
            Err(f) if format!("{:?}", f.err).contains(&format!("Custom({})", code(LeashError::UnsupportedMint))) => {}
            other => panic!("{name}: expected UnsupportedMint, got {:?}", other.as_ref().map(|_| ()).map_err(|f| f.meta.logs.join("\n"))),
        }
        assert!(is_closed(&env.svm, &env.vault));
    }
}

#[test]
fn token_2022_plain_and_metadata_mints_work() {
    let (mut env, res) = init_with_2022_mint(&[]);
    assert_ok(&res);
    // Fund the vault's (Token-2022) ATA directly, then pay an allowlisted payee through transfer_checked.
    let mut acct = env.svm.get_account(&env.vault_ata).unwrap();
    acct.data[64..72].copy_from_slice(&(10 * ONE).to_le_bytes());
    env.svm.set_account(env.vault_ata, acct).unwrap();
    let ix = ix_add_payee(&env, env.merchant, "API", ONE / 2, 0);
    assert_ok(&owner_send(&mut env, &[ix]));
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, false);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), ONE / 20);

    let pointer = [Pubkey::new_unique().to_bytes(), Pubkey::new_unique().to_bytes()].concat();
    let (_env, res) = init_with_2022_mint(&[(EXT_METADATA_POINTER, pointer)]);
    assert_ok(&res);
}

#[test]
fn mint_with_too_many_decimals_is_refused() {
    let data = mint_data_with_decimals(&Pubkey::new_unique(), 1, 19);
    let mut env = base_env_with_mint(TOKEN_PROGRAM, Some(data));
    let ix = ix_initialize(&env, env.vault_id, env.agent.pubkey(), no_cosign());
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::UnsupportedMint);
}

// ───────────────────────────── T5: readable, domain-bound signed mandates ─────────────────────────────

const ED25519_ID: Pubkey = solana_sdk_ids::ed25519_program::ID;
/// 2026-11-07T12:00:00Z
const EXP: i64 = 1_794_052_800;
const INTENT: &str = "Buy one research report from Acme Research";

fn terms_for(env: &Env, payee: Pubkey) -> MandateTerms {
    MandateTerms {
        payee,
        max_total: ONE,
        max_per_tx: ONE / 2,
        expires_at: EXP,
        nonce: vault(env).mandate_seq,
        intent: INTENT.to_string(),
    }
}

/// The vault in `setup` opens at T0.
const OPENED: &str = "2026-11-06T21:20:00Z";

/// The text the owner's wallet shows, written out independently of the program's formatter (the SDK contract).
#[allow(clippy::too_many_arguments)]
fn wallet_text(program: &Pubkey, cluster: &str, vault: &Pubkey, opened: &str, mint: &Pubkey, t: &MandateTerms, total: &str, per: &str, expires: &str) -> Vec<u8> {
    format!(
        "Leash spending mandate v2\nProgram: {program}\nCluster: {cluster}\nVault: {vault}\nVault opened: {opened}\nPayee: {}\nMint: {mint}\nMax total: {total}\nMax per payment: {per}\nExpires: {expires}\nNonce: {}\nIntent: {}",
        t.payee, t.nonce, t.intent
    )
    .into_bytes()
}

fn owner_text(env: &Env, t: &MandateTerms) -> Vec<u8> {
    wallet_text(&leash::ID, "devnet", &env.vault, OPENED, &env.mint, t, "1.00", "0.50", "2026-11-07T12:00:00Z")
}

fn ed25519_ix(signer: &Keypair, msg: &[u8], ix_index: u16) -> Instruction {
    let sig = signer.sign_message(msg);
    let mut data = vec![1u8, 0u8];
    let (pk_off, sig_off, msg_off) = (16u16, 48u16, 112u16);
    for v in [sig_off, ix_index, pk_off, ix_index, msg_off, msg.len() as u16, ix_index] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    data.extend_from_slice(signer.pubkey().as_ref());
    data.extend_from_slice(sig.as_ref());
    data.extend_from_slice(msg);
    Instruction { program_id: ED25519_ID, accounts: vec![], data }
}

/// Two valid signature entries (both over `msg`): the precompile accepts it, Leash must not.
fn ed25519_ix_two_sigs(signer: &Keypair, msg: &[u8]) -> Instruction {
    let sig = signer.sign_message(msg);
    let mut data = vec![2u8, 0u8];
    let (pk_off, sig_off, msg_off) = (30u16, 62u16, 126u16);
    for _ in 0..2 {
        for v in [sig_off, u16::MAX, pk_off, u16::MAX, msg_off, msg.len() as u16, u16::MAX] {
            data.extend_from_slice(&v.to_le_bytes());
        }
    }
    data.extend_from_slice(signer.pubkey().as_ref());
    data.extend_from_slice(sig.as_ref());
    data.extend_from_slice(msg);
    Instruction { program_id: ED25519_ID, accounts: vec![], data }
}

fn ix_redeem(env: &Env, terms: &MandateTerms) -> Instruction {
    let seq = vault(env).mandate_seq;
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::RedeemSignedMandate { terms: terms.clone() }.data(),
        leash::accounts::RedeemSignedMandate {
            agent: env.agent.pubkey(),
            vault: env.vault,
            mandate: mandate_pda(&env.vault, seq),
            mint: env.mint,
            instructions: solana_sdk_ids::sysvar::instructions::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn redeem_signed(env: &mut Env, signer: &Keypair, signed_text: &[u8], submitted: &MandateTerms) -> TxResult {
    let ixs = [ed25519_ix(signer, signed_text, u16::MAX), ix_redeem(env, submitted)];
    agent_send(env, &ixs)
}

fn newcomer(env: &mut Env) -> (Pubkey, Pubkey) {
    let p = Pubkey::new_unique();
    let p_ata = ata(&p, &env.mint);
    set_token_account(&mut env.svm, p_ata, &env.mint, &p, 0);
    (p, p_ata)
}

#[test]
fn signed_mandate_redeem_then_spend() {
    let mut env = setup(no_cosign());
    let (p, p_ata) = newcomer(&mut env);
    let terms = terms_for(&env, p);
    let text = owner_text(&env, &terms);
    assert!(std::str::from_utf8(&text).unwrap().contains("Max total: 1.00\nMax per payment: 0.50\nExpires: 2026-11-07T12:00:00Z"));
    let owner = env.owner.insecure_clone();
    let res = redeem_signed(&mut env, &owner, &text, &terms);
    let created = ok_events::<MandateCreated>(&res);
    assert!(created[0].signed_offchain);
    let m = mandate(&env, 0);
    assert_eq!(m.payee, p);
    assert_eq!(m.max_total, ONE);
    assert_eq!(m.expires_at, EXP);
    use sha2::Digest;
    let want: [u8; 32] = sha2::Sha256::digest(INTENT.as_bytes()).into();
    assert_eq!(m.intent_hash, want, "intent_hash = sha256 of the exact text the owner signed");
    assert_eq!(vault(&env).open_mandates, 1);

    let ix = ix_spend(&env, &env.agent.pubkey(), p_ata, Auth::Mandate(0), ONE / 2, false);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(token_balance(&env.svm, &p_ata), ONE / 2);
}

#[test]
fn signed_mandate_with_max_intent_fits_in_one_transaction() {
    let mut env = setup(no_cosign());
    let terms = MandateTerms { intent: "x".repeat(leash::state::MAX_INTENT_LEN), ..terms_for(&env, Pubkey::new_unique()) };
    let text = owner_text(&env, &terms);
    let owner = env.owner.insecure_clone();
    let ixs = [ed25519_ix(&owner, &text, u16::MAX), ix_redeem(&env, &terms)];
    let msg = solana_message::Message::new(&ixs, Some(&env.agent.pubkey()));
    let size = solana_message::VersionedMessage::Legacy(msg).serialize().len() + 1 + 64;
    assert!(size <= 1232, "redeem tx is {size} bytes (limit 1232)");
    assert_ok(&agent_send(&mut env, &ixs));
}

#[test]
fn compute_units_stay_well_under_the_default_limit() {
    // Default budget is 200k CU per instruction; keep the heavy paths far below it.
    let mut env = setup(Policy { cosign_window_threshold: 3 * ONE, ..no_cosign() });
    let cu = |res: &TxResult| match res {
        Ok(m) => m.compute_units_consumed,
        Err(f) => panic!("{:?}\n{}", f.err, f.meta.logs.join("\n")),
    };
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, false);
    let spend = cu(&agent_send(&mut env, &[ix]));
    let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::Payee(env.merchant), ONE / 20, true);
    let blocked = cu(&agent_send(&mut env, &[ix]));
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
    assert_ok(&agent_send(&mut env, &[ix]));
    let ix = ix_approve(&env, 0, env.merchant_ata, Auth::Payee(env.merchant));
    let approve = cu(&owner_send(&mut env, &[ix]));
    let terms = MandateTerms { intent: "x".repeat(leash::state::MAX_INTENT_LEN), ..terms_for(&env, Pubkey::new_unique()) };
    let text = owner_text(&env, &terms);
    let owner = env.owner.insecure_clone();
    let redeem = cu(&redeem_signed(&mut env, &owner, &text, &terms));
    println!("CU: agent_spend {spend}, guarded block {blocked}, approve {approve}, redeem {redeem}");
    for (name, used) in [("agent_spend", spend), ("guarded block", blocked), ("approve", approve), ("redeem", redeem)] {
        assert!(used < 120_000, "{name} used {used} CU");
    }
}

#[test]
fn err_signed_mandate_wrong_signer() {
    let mut env = setup(no_cosign());
    let terms = terms_for(&env, Pubkey::new_unique());
    let text = owner_text(&env, &terms);
    let res = redeem_signed(&mut env, &Keypair::new(), &text, &terms);
    assert_leash_err(&res, LeashError::InvalidMandateSignature);
}

#[test]
fn err_signed_mandate_tampered_terms() {
    let mut env = setup(no_cosign());
    let signed = terms_for(&env, Pubkey::new_unique());
    let text = owner_text(&env, &signed);
    let owner = env.owner.insecure_clone();
    // Owner read and signed "Max total: 1.00"; the agent submits 1000.00, another payee, a later expiry, other text.
    for tampered in [
        MandateTerms { max_total: 1_000 * ONE, ..signed.clone() },
        MandateTerms { payee: env.attacker, ..signed.clone() },
        MandateTerms { expires_at: EXP + DAY, ..signed.clone() },
        MandateTerms { intent: "Buy anything".into(), ..signed.clone() },
    ] {
        assert_leash_err(&redeem_signed(&mut env, &owner, &text, &tampered), LeashError::InvalidMandateSignature);
    }
}

#[test]
fn err_signed_mandate_bound_to_cluster_program_and_vault() {
    let mut env = setup(no_cosign());
    let terms = terms_for(&env, Pubkey::new_unique());
    let owner = env.owner.insecure_clone();
    let other_vault = vault_pda(&env.owner.pubkey(), 2);
    let ui = ("1.00", "0.50", "2026-11-07T12:00:00Z");
    for (what, text) in [
        ("mainnet message replayed on devnet", wallet_text(&leash::ID, "mainnet-beta", &env.vault, OPENED, &env.mint, &terms, ui.0, ui.1, ui.2)),
        ("other program id", wallet_text(&Pubkey::new_unique(), "devnet", &env.vault, OPENED, &env.mint, &terms, ui.0, ui.1, ui.2)),
        ("signed for the owner's other vault", wallet_text(&leash::ID, "devnet", &other_vault, OPENED, &env.mint, &terms, ui.0, ui.1, ui.2)),
        ("earlier vault at this address", wallet_text(&leash::ID, "devnet", &env.vault, "2026-11-06T21:19:59Z", &env.mint, &terms, ui.0, ui.1, ui.2)),
        ("other mint", wallet_text(&leash::ID, "devnet", &env.vault, OPENED, &Pubkey::new_unique(), &terms, ui.0, ui.1, ui.2)),
    ] {
        let res = redeem_signed(&mut env, &owner, &text, &terms);
        match &res {
            Err(f) if format!("{:?}", f.err).contains(&format!("Custom({})", code(LeashError::InvalidMandateSignature))) => {}
            _ => panic!("{what}: expected InvalidMandateSignature"),
        }
    }
    // The old hex format is no longer accepted either.
    let res = redeem_signed(&mut env, &owner, b"LEASH_MANDATE_V1:00ff", &terms);
    assert_leash_err(&res, LeashError::InvalidMandateSignature);
}

#[test]
fn err_signed_mandate_missing_ed25519_ix() {
    let mut env = setup(no_cosign());
    let terms = terms_for(&env, Pubkey::new_unique());
    let ix = ix_redeem(&env, &terms);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::InvalidMandateSignature);
}

#[test]
fn err_signed_mandate_indices_not_self() {
    // Offsets pointing at instruction 0 instead of u16::MAX ("this instruction") are refused.
    let mut env = setup(no_cosign());
    let terms = terms_for(&env, Pubkey::new_unique());
    let owner = env.owner.insecure_clone();
    let ixs = [ed25519_ix(&owner, &owner_text(&env, &terms), 0), ix_redeem(&env, &terms)];
    assert_leash_err(&agent_send(&mut env, &ixs), LeashError::InvalidMandateSignature);
}

#[test]
fn err_signed_mandate_two_signatures() {
    let mut env = setup(no_cosign());
    let terms = terms_for(&env, Pubkey::new_unique());
    let owner = env.owner.insecure_clone();
    let ixs = [ed25519_ix_two_sigs(&owner, &owner_text(&env, &terms)), ix_redeem(&env, &terms)];
    assert_leash_err(&agent_send(&mut env, &ixs), LeashError::InvalidMandateSignature);
}

#[test]
fn err_signed_mandate_precompile_not_adjacent() {
    let mut env = setup(no_cosign());
    let terms = terms_for(&env, Pubkey::new_unique());
    let owner = env.owner.insecure_clone();
    let filler = system_instruction::transfer(&env.agent.pubkey(), &env.owner.pubkey(), 1);
    let ixs = [ed25519_ix(&owner, &owner_text(&env, &terms), u16::MAX), filler, ix_redeem(&env, &terms)];
    assert_leash_err(&agent_send(&mut env, &ixs), LeashError::InvalidMandateSignature);
}

#[test]
fn err_signed_mandate_garbage_signature_or_oob_offsets_fail_in_precompile() {
    let mut env = setup(no_cosign());
    let terms = terms_for(&env, Pubkey::new_unique());
    let owner = env.owner.insecure_clone();
    let text = owner_text(&env, &terms);

    let mut garbage = ed25519_ix(&owner, &text, u16::MAX);
    for b in &mut garbage.data[48..112] {
        *b ^= 0x5a;
    }
    let ixs = [garbage, ix_redeem(&env, &terms)];
    assert_failed(&agent_send(&mut env, &ixs));

    let mut oob = ed25519_ix(&owner, &text, u16::MAX);
    let too_long = (text.len() as u16 + 100).to_le_bytes();
    oob.data[12..14].copy_from_slice(&too_long); // message_data_size past the end
    let ixs = [oob, ix_redeem(&env, &terms)];
    assert_failed(&agent_send(&mut env, &ixs));

    assert!(is_closed(&env.svm, &mandate_pda(&env.vault, 0)));
    assert_eq!(vault(&env).mandate_seq, 0);
}

#[test]
fn err_signed_mandate_expired_terms() {
    let mut env = setup(no_cosign());
    let terms = MandateTerms { expires_at: T0 - 10, ..terms_for(&env, Pubkey::new_unique()) };
    let text = wallet_text(&leash::ID, "devnet", &env.vault, OPENED, &env.mint, &terms, "1.00", "0.50", "2026-11-06T21:19:50Z");
    let owner = env.owner.insecure_clone();
    assert_leash_err(&redeem_signed(&mut env, &owner, &text, &terms), LeashError::InvalidMandateTerms);
}

#[test]
fn err_signed_mandate_invalid_intent() {
    let mut env = setup(no_cosign());
    let owner = env.owner.insecure_clone();
    for intent in ["".to_string(), "Buy a report\nMax total: 0.01".to_string(), "x".repeat(101), "caf\u{e9}".to_string()] {
        let terms = MandateTerms { intent, ..terms_for(&env, Pubkey::new_unique()) };
        let text = owner_text(&env, &terms);
        assert_leash_err(&redeem_signed(&mut env, &owner, &text, &terms), LeashError::InvalidIntent);
    }
}

#[test]
fn err_signed_mandate_replayed_nonce() {
    let mut env = setup(no_cosign());
    let terms = terms_for(&env, Pubkey::new_unique());
    let text = owner_text(&env, &terms);
    let owner = env.owner.insecure_clone();
    assert_ok(&redeem_signed(&mut env, &owner, &text, &terms));
    // Same signature again: nonce 0 != mandate_seq 1.
    assert_leash_err(&redeem_signed(&mut env, &owner, &text, &terms), LeashError::StaleMandateNonce);
}

#[test]
fn signed_mandate_does_not_replay_on_a_reinitialized_vault() {
    let mut env = setup(no_cosign());
    let owner = env.owner.insecure_clone();
    let (p, _) = newcomer(&mut env);
    let terms = terms_for(&env, p);
    let text = owner_text(&env, &terms);
    assert_ok(&redeem_signed(&mut env, &owner, &text, &terms));

    // The owner winds the vault down completely and later opens vault_id 1 again: same address, mandate_seq 0.
    for ix in [ix_close_mandate(&env, 0), ix_withdraw(&env, 1_000 * ONE), ix_remove_payee(&env, env.merchant)] {
        assert_ok(&owner_send(&mut env, &[ix]));
    }
    warp(&mut env, 60);
    let ix = ix_close_vault(&env);
    assert_ok(&owner_send(&mut env, &[ix]));
    warp(&mut env, 60);
    let ix = ix_initialize(&env, env.vault_id, env.agent.pubkey(), no_cosign());
    assert_ok(&owner_send(&mut env, &[ix]));
    assert_eq!(vault(&env).mandate_seq, 0);

    // The old signature (public in the first redeem tx) no longer verifies: the message names the vault's
    // opening time, and the new vault opened later.
    assert_leash_err(&redeem_signed(&mut env, &owner, &text, &terms), LeashError::InvalidMandateSignature);
}

#[test]
fn bump_mandate_seq_cancels_unredeemed_signatures() {
    let mut env = setup(no_cosign());
    let owner = env.owner.insecure_clone();
    let (p, _) = newcomer(&mut env);
    let t0 = terms_for(&env, p); // nonce 0
    let t1 = MandateTerms { nonce: 1, ..t0.clone() };
    let (s0, s1) = (owner_text(&env, &t0), owner_text(&env, &t1));

    // The owner signed nonces 0 and 1, then changes their mind: move the sequence past both.
    let ix = ix_bump_mandate_seq(&env, 2);
    let res = owner_send(&mut env, &[ix]);
    assert_eq!(ok_events::<MandateSeqBumped>(&res)[0].mandate_seq, 2);
    assert_leash_err(&redeem_signed(&mut env, &owner, &s0, &t0), LeashError::StaleMandateNonce);
    assert_leash_err(&redeem_signed(&mut env, &owner, &s1, &t1), LeashError::StaleMandateNonce);

    let ix = ix_bump_mandate_seq(&env, 2);
    assert_leash_err(&owner_send(&mut env, &[ix]), LeashError::MandateSeqNotIncreasing);

    // A fresh signature for the new sequence works and gets mandate id 2.
    let t2 = MandateTerms { nonce: 2, ..t0.clone() };
    let s2 = owner_text(&env, &t2);
    assert_ok(&redeem_signed(&mut env, &owner, &s2, &t2));
    assert_eq!(mandate(&env, 2).payee, p);
    assert_eq!(vault(&env).mandate_seq, 3);
}
