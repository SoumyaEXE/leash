//! Program tests: the happy path of every instruction and one failing test per error (docs/04 "Tests").
//! Build first (`anchor build`), then `cargo test -p leash`.

mod common;

use anchor_lang::{prelude::Pubkey, AnchorSerialize, InstructionData};
use common::*;
use leash::errors::LeashError;
use leash::state::{MandateTerms, Policy, RequestStatus};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn no_cosign() -> Policy {
    Policy { cosign_threshold: 0, ..demo_policy() }
}

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
    assert!(!v.paused);
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
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), amount);
    assert_eq!(token_balance(&env.svm, &env.vault_ata), 1_000 * ONE - amount);
    assert_eq!(payee(&env, &env.merchant).spent, amount);
    let v = vault(&env);
    assert_eq!(v.spent_in_window, amount);
    assert_eq!(v.total_spent, amount);
}

#[test]
fn spend_emits_event_with_memo() {
    let mut env = setup(demo_policy());
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, false);
    let meta = agent_send(&mut env, &[ix]).expect("spend ok");
    assert!(meta.logs.iter().any(|l| l.starts_with("Program data: ")), "SpendExecuted event logged");
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

    let ix = ix_spend(&env, &env.agent.pubkey(), newcomer_ata, Auth::Mandate(0), ONE / 2, false);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(token_balance(&env.svm, &newcomer_ata), ONE / 2);
    assert_eq!(mandate(&env, 0).spent, ONE / 2);
}

#[test]
fn request_then_approve() {
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

    let ix = ix_approve(&env, 0, env.merchant_ata, Auth::Payee(env.merchant));
    assert_ok(&owner_send(&mut env, &[ix]));
    assert_eq!(request(&env, 0).status, RequestStatus::Approved);
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), amount);
    assert_eq!(payee(&env, &env.merchant).spent, amount);
}

#[test]
fn request_then_reject() {
    let mut env = setup(demo_policy());
    let ix = ix_request(&env, env.merchant, Auth::Payee(env.merchant), ONE / 4);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_ok(&owner_send(&mut env, &[ix_reject(&env, 0)]));
    assert_eq!(request(&env, 0).status, RequestStatus::Rejected);
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), 0);
}

#[test]
fn withdraw_to_owner() {
    let mut env = setup(demo_policy());
    let before = token_balance(&env.svm, &env.owner_ata);
    assert_ok(&owner_send(&mut env, &[ix_withdraw(&env, 100 * ONE)]));
    assert_eq!(token_balance(&env.svm, &env.owner_ata), before + 100 * ONE);
    assert_eq!(token_balance(&env.svm, &env.vault_ata), 900 * ONE);
}

#[test]
fn daily_window_rolls_over() {
    let mut env = setup(Policy { per_tx_cap: ONE, daily_cap: ONE, cosign_threshold: 0, ..demo_policy() });
    for _ in 0..2 {
        let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 2, false);
        assert_ok(&agent_send(&mut env, &[ix]));
    }
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix.clone()]), LeashError::ExceedsDailyCap);

    warp(&mut env, 86_400);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(vault(&env).spent_in_window, ONE / 10);
}

#[test]
fn owner_can_update_policy_and_payee_and_rotate_agent() {
    let mut env = setup(demo_policy());
    let new_policy = Policy { per_tx_cap: 2 * ONE, daily_cap: 10 * ONE, cosign_threshold: ONE, ..demo_policy() };
    let data = leash::instruction::UpdatePolicy { policy: new_policy }.data();
    let ix = ix_owner_vault(&env, data, &env.owner.pubkey());
    assert_ok(&owner_send(&mut env, &[ix]));
    assert_eq!(vault(&env).per_tx_cap, 2 * ONE);

    assert_ok(&owner_send(&mut env, &[ix_update_payee(&env, env.merchant, ONE, 0, false)]));
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
fn err_inactive_payee_is_not_authorized() {
    let mut env = setup(demo_policy());
    assert_ok(&owner_send(&mut env, &[ix_update_payee(&env, env.merchant, ONE / 2, 5 * ONE, false)]));
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 20, false);
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
    assert_ok(&owner_send(&mut env, &[ix_update_payee(&env, env.merchant, ONE / 2, ONE, true)]));
    for _ in 0..2 {
        let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 2, false);
        assert_ok(&agent_send(&mut env, &[ix]));
    }
    let ix = ix_spend(&env, &env.agent.pubkey(), env.merchant_ata, Auth::Payee(env.merchant), ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::PayeeBudgetExceeded);
}

fn env_with_mandate(max_total: u64, max_per_tx: u64, ttl: i64) -> (Env, Pubkey) {
    let mut env = setup(no_cosign());
    let newcomer = Pubkey::new_unique();
    let newcomer_ata = ata(&newcomer, &env.mint);
    set_token_account(&mut env.svm, newcomer_ata, &env.mint, &newcomer, 0);
    let exp = now(&env) + ttl;
    let ix = ix_create_mandate(&env, newcomer, max_total, max_per_tx, exp);
    assert_ok(&owner_send(&mut env, &[ix]));
    (env, newcomer_ata)
}

#[test]
fn err_mandate_expired() {
    let (mut env, to) = env_with_mandate(ONE, ONE / 2, 60);
    warp(&mut env, 61);
    let ix = ix_spend(&env, &env.agent.pubkey(), to, Auth::Mandate(0), ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::MandateExpired);
}

#[test]
fn err_mandate_revoked() {
    let (mut env, to) = env_with_mandate(ONE, ONE / 2, 3600);
    assert_ok(&owner_send(&mut env, &[ix_revoke_mandate(&env, 0)]));
    let ix = ix_spend(&env, &env.agent.pubkey(), to, Auth::Mandate(0), ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::MandateRevoked);
}

#[test]
fn err_mandate_exhausted() {
    let (mut env, to) = env_with_mandate(ONE / 2, ONE / 2, 3600);
    let ix = ix_spend(&env, &env.agent.pubkey(), to, Auth::Mandate(0), ONE * 4 / 10, false);
    assert_ok(&agent_send(&mut env, &[ix]));
    let ix = ix_spend(&env, &env.agent.pubkey(), to, Auth::Mandate(0), ONE * 2 / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::MandateExhausted);
}

#[test]
fn err_mandate_per_tx() {
    let (mut env, to) = env_with_mandate(ONE, ONE / 10, 3600);
    let ix = ix_spend(&env, &env.agent.pubkey(), to, Auth::Mandate(0), ONE / 5, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::ExceedsPayeePerTx);
}

#[test]
fn err_mandate_for_other_payee_is_recipient_mismatch() {
    let (mut env, _to) = env_with_mandate(ONE, ONE / 2, 3600);
    let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::Mandate(0), ONE / 10, false);
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::RecipientMismatch);
}

#[test]
fn err_exceeds_per_tx_cap() {
    let mut env = setup(no_cosign());
    let big = Pubkey::new_unique();
    let big_ata = ata(&big, &env.mint);
    set_token_account(&mut env.svm, big_ata, &env.mint, &big, 0);
    assert_ok(&owner_send(&mut env, &[ix_add_payee(&env, big, "Big Spender", 10 * ONE, 0)]));
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
    assert_leash_err(&owner_send(&mut env, &[approve]), LeashError::RequestNotPending);
    assert_leash_err(&owner_send(&mut env, &[ix_reject(&env, 0)]), LeashError::RequestNotPending);
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
fn err_not_owner() {
    let mut env = setup(demo_policy());
    let data = leash::instruction::SetPaused { paused: true }.data();
    let ix = ix_owner_vault(&env, data, &env.agent.pubkey());
    assert_leash_err(&agent_send(&mut env, &[ix]), LeashError::NotOwner);
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
    assert_ok(&owner_send(&mut env, &[ix_withdraw(&env, 1_000 * ONE)]));
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

// ───────────────────────────── tripwire (guarded_spend) ─────────────────────────────

#[test]
fn tripwire_three_strikes_freezes_then_owner_unfreezes() {
    let mut env = setup(Policy { freeze_after_strikes: 3, ..demo_policy() });
    for i in 1..=3u8 {
        let ix = ix_spend(&env, &env.agent.pubkey(), env.attacker_ata, Auth::None, 500 * ONE, true);
        // guarded: the refusal does NOT revert, it's recorded onchain
        assert_ok(&agent_send(&mut env, &[ix]));
        let v = vault(&env);
        assert_eq!(v.strikes, i);
        assert_eq!(v.blocked_count, i as u64);
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

// ───────────────────────────── signed mandates (Ed25519 introspection) ─────────────────────────────

const ED25519_ID: Pubkey = solana_sdk_ids::ed25519_program::ID;

fn terms_for(env: &Env, payee: Pubkey) -> MandateTerms {
    MandateTerms {
        vault: env.vault,
        payee,
        max_total: ONE,
        max_per_tx: ONE / 2,
        expires_at: now(env) + 3600,
        intent_hash: [5u8; 32],
        nonce: vault(env).mandate_seq,
    }
}

fn mandate_message(terms: &MandateTerms) -> Vec<u8> {
    let mut raw = Vec::new();
    terms.serialize(&mut raw).unwrap();
    let mut msg = b"LEASH_MANDATE_V1:".to_vec();
    for b in raw {
        msg.extend_from_slice(format!("{b:02x}").as_bytes());
    }
    msg
}

fn ed25519_ix(signer: &Keypair, msg: &[u8], ix_index: u16) -> anchor_lang::solana_program::instruction::Instruction {
    let sig = signer.sign_message(msg);
    let mut data = vec![1u8, 0u8];
    let (pk_off, sig_off, msg_off) = (16u16, 48u16, 112u16);
    for v in [sig_off, ix_index, pk_off, ix_index, msg_off, msg.len() as u16, ix_index] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    data.extend_from_slice(signer.pubkey().as_ref());
    data.extend_from_slice(sig.as_ref());
    data.extend_from_slice(msg);
    anchor_lang::solana_program::instruction::Instruction { program_id: ED25519_ID, accounts: vec![], data }
}

fn ix_redeem(env: &Env, terms: MandateTerms) -> anchor_lang::solana_program::instruction::Instruction {
    use anchor_lang::ToAccountMetas;
    anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::RedeemSignedMandate { terms }.data(),
        leash::accounts::RedeemSignedMandate {
            agent: env.agent.pubkey(),
            vault: env.vault,
            mandate: mandate_pda(&env.vault, terms.nonce),
            instructions: solana_sdk_ids::sysvar::instructions::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    )
}

#[test]
fn signed_mandate_redeem_then_spend() {
    let mut env = setup(no_cosign());
    let newcomer = Pubkey::new_unique();
    let newcomer_ata = ata(&newcomer, &env.mint);
    set_token_account(&mut env.svm, newcomer_ata, &env.mint, &newcomer, 0);
    let terms = terms_for(&env, newcomer);
    let msg = mandate_message(&terms);
    let owner = env.owner.insecure_clone();
    let ixs = [ed25519_ix(&owner, &msg, u16::MAX), ix_redeem(&env, terms)];
    assert_ok(&agent_send(&mut env, &ixs));
    let m = mandate(&env, 0);
    assert_eq!(m.payee, newcomer);
    assert_eq!(m.max_total, ONE);

    let ix = ix_spend(&env, &env.agent.pubkey(), newcomer_ata, Auth::Mandate(0), ONE / 2, false);
    assert_ok(&agent_send(&mut env, &[ix]));
    assert_eq!(token_balance(&env.svm, &newcomer_ata), ONE / 2);
}

#[test]
fn err_signed_mandate_wrong_signer() {
    let mut env = setup(no_cosign());
    let terms = terms_for(&env, Pubkey::new_unique());
    let not_owner = Keypair::new();
    let ixs = [ed25519_ix(&not_owner, &mandate_message(&terms), u16::MAX), ix_redeem(&env, terms)];
    assert_leash_err(&agent_send(&mut env, &ixs), LeashError::InvalidMandateSignature);
}

#[test]
fn err_signed_mandate_tampered_message() {
    let mut env = setup(no_cosign());
    let signed = terms_for(&env, Pubkey::new_unique());
    let owner = env.owner.insecure_clone();
    // Owner signed max_total = 1.00; the agent submits 1000.00.
    let tampered = MandateTerms { max_total: 1_000 * ONE, ..signed };
    let ixs = [ed25519_ix(&owner, &mandate_message(&signed), u16::MAX), ix_redeem(&env, tampered)];
    assert_leash_err(&agent_send(&mut env, &ixs), LeashError::InvalidMandateSignature);
}

#[test]
fn err_signed_mandate_missing_ed25519_ix() {
    let mut env = setup(no_cosign());
    let terms = terms_for(&env, Pubkey::new_unique());
    assert_leash_err(&agent_send(&mut env, &[ix_redeem(&env, terms)]), LeashError::InvalidMandateSignature);
}

#[test]
fn err_signed_mandate_indices_not_self() {
    // Offsets pointing at instruction 0 instead of u16::MAX ("this instruction") are refused.
    let mut env = setup(no_cosign());
    let terms = terms_for(&env, Pubkey::new_unique());
    let owner = env.owner.insecure_clone();
    let ixs = [ed25519_ix(&owner, &mandate_message(&terms), 0), ix_redeem(&env, terms)];
    assert_leash_err(&agent_send(&mut env, &ixs), LeashError::InvalidMandateSignature);
}

#[test]
fn err_signed_mandate_replayed_nonce() {
    let mut env = setup(no_cosign());
    let terms = terms_for(&env, Pubkey::new_unique());
    let msg = mandate_message(&terms);
    let owner = env.owner.insecure_clone();
    assert_ok(&agent_send(&mut env, &[ed25519_ix(&owner, &msg, u16::MAX), ix_redeem(&env, terms)]));
    // Same signature again: nonce 0 != mandate_seq 1.
    let mut replay = ix_redeem(&env, terms);
    replay.accounts[2].pubkey = mandate_pda(&env.vault, 1);
    let res = agent_send(&mut env, &[ed25519_ix(&owner, &msg, u16::MAX), replay]);
    assert_leash_err(&res, LeashError::InvalidMandateSignature);
}
