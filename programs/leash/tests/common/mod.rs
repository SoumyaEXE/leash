#![allow(dead_code)]
//! LiteSVM harness for the Leash program: token accounts are written directly (fixed SPL layouts), every
//! instruction is built from the Anchor-generated `leash::instruction` / `leash::accounts` types.

use anchor_lang::{
    prelude::Pubkey,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        system_program,
    },
    AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas,
};
use leash::errors::LeashError;
use leash::state::{Mandate, Payee, Policy, SpendRequest, Vault};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub const TOKEN_PROGRAM: Pubkey = anchor_spl::token::ID;
pub const TOKEN_2022_PROGRAM: Pubkey = anchor_spl::token_2022::ID;
pub const ATA_PROGRAM: Pubkey = anchor_spl::associated_token::ID;
pub const DECIMALS: u8 = 6;
pub const ONE: u64 = 1_000_000; // 1.00 dUSDC
pub const HOUR: i64 = 3_600;
pub const DAY: i64 = 86_400;
/// Test clock start: 2026-11-06T21:20:00Z.
pub const T0: i64 = 1_794_000_000;

pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

/// Demo policy from prompts A2: per-tx 1.00, 24h 5.00, co-sign at 0.20, 1h request TTL.
pub fn demo_policy() -> Policy {
    Policy {
        per_tx_cap: ONE,
        daily_cap: 5 * ONE,
        cosign_threshold: ONE / 5,
        request_ttl_secs: 3600,
        freeze_after_strikes: 0,
        cosign_window_threshold: 0,
        enforce_tripwire: false,
    }
}

pub fn no_cosign() -> Policy {
    Policy { cosign_threshold: 0, ..demo_policy() }
}

pub struct Env {
    pub svm: LiteSVM,
    pub owner: Keypair,
    pub agent: Keypair,
    pub mint: Pubkey,
    pub mint_authority: Keypair,
    pub token_program: Pubkey,
    pub merchant: Pubkey,
    pub merchant_ata: Pubkey,
    pub attacker: Pubkey,
    pub attacker_ata: Pubkey,
    pub owner_ata: Pubkey,
    pub vault: Pubkey,
    pub vault_ata: Pubkey,
    pub vault_id: u64,
}

pub fn ata_with(wallet: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[wallet.as_ref(), token_program.as_ref(), mint.as_ref()], &ATA_PROGRAM).0
}
pub fn ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    ata_with(wallet, mint, &TOKEN_PROGRAM)
}

pub fn vault_pda(owner: &Pubkey, vault_id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", owner.as_ref(), &vault_id.to_le_bytes()], &leash::ID).0
}
pub fn payee_pda(vault: &Pubkey, payee: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"payee", vault.as_ref(), payee.as_ref()], &leash::ID).0
}
pub fn mandate_pda(vault: &Pubkey, id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"mandate", vault.as_ref(), &id.to_le_bytes()], &leash::ID).0
}
pub fn request_pda(vault: &Pubkey, seq: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"request", vault.as_ref(), &seq.to_le_bytes()], &leash::ID).0
}

fn coption_pubkey(out: &mut Vec<u8>, v: Option<&Pubkey>) {
    match v {
        Some(pk) => {
            out.extend_from_slice(&1u32.to_le_bytes());
            out.extend_from_slice(pk.as_ref());
        }
        None => {
            out.extend_from_slice(&0u32.to_le_bytes());
            out.extend_from_slice(&[0u8; 32]);
        }
    }
}

/// SPL Token Mint layout (82 bytes).
pub fn mint_data_with_decimals(authority: &Pubkey, supply: u64, decimals: u8) -> Vec<u8> {
    let mut d = Vec::with_capacity(82);
    coption_pubkey(&mut d, Some(authority));
    d.extend_from_slice(&supply.to_le_bytes());
    d.push(decimals);
    d.push(1); // is_initialized
    coption_pubkey(&mut d, None);
    assert_eq!(d.len(), 82);
    d
}
pub fn mint_data(authority: &Pubkey, supply: u64) -> Vec<u8> {
    mint_data_with_decimals(authority, supply, DECIMALS)
}

/// Token-2022 mint with extensions: base mint, zero padding to 165, account type 1 (Mint), then TLV entries.
pub fn mint_2022_with_extensions(authority: &Pubkey, supply: u64, exts: &[(u16, Vec<u8>)]) -> Vec<u8> {
    let mut d = mint_data(authority, supply);
    if exts.is_empty() {
        return d;
    }
    d.resize(165, 0);
    d.push(1); // AccountType::Mint
    for (ty, value) in exts {
        d.extend_from_slice(&ty.to_le_bytes());
        d.extend_from_slice(&(value.len() as u16).to_le_bytes());
        d.extend_from_slice(value);
    }
    d
}

/// SPL Token Account layout (165 bytes; also a valid extension-less Token-2022 account).
pub fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = Vec::with_capacity(165);
    d.extend_from_slice(mint.as_ref());
    d.extend_from_slice(owner.as_ref());
    d.extend_from_slice(&amount.to_le_bytes());
    coption_pubkey(&mut d, None); // delegate
    d.push(1); // state = Initialized
    d.extend_from_slice(&0u32.to_le_bytes()); // is_native COption<u64>
    d.extend_from_slice(&0u64.to_le_bytes());
    d.extend_from_slice(&0u64.to_le_bytes()); // delegated_amount
    coption_pubkey(&mut d, None); // close_authority
    assert_eq!(d.len(), 165);
    d
}

pub fn set_token_account_with(svm: &mut LiteSVM, address: Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64, program: Pubkey) {
    let data = token_account_data(mint, owner, amount);
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(address, Account { lamports, data, owner: program, executable: false, rent_epoch: 0 }).unwrap();
}
pub fn set_token_account(svm: &mut LiteSVM, address: Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64) {
    set_token_account_with(svm, address, mint, owner, amount, TOKEN_PROGRAM);
}

pub fn set_mint(svm: &mut LiteSVM, address: Pubkey, data: Vec<u8>, program: Pubkey) {
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(address, Account { lamports, data, owner: program, executable: false, rent_epoch: 0 }).unwrap();
}

pub fn token_balance(svm: &LiteSVM, address: &Pubkey) -> u64 {
    let acct = svm.get_account(address).expect("token account exists");
    u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
}

pub fn lamports(svm: &LiteSVM, address: &Pubkey) -> u64 {
    svm.get_account(address).map(|a| a.lamports).unwrap_or(0)
}

/// Closed = gone, or 0 lamports and no data.
pub fn is_closed(svm: &LiteSVM, address: &Pubkey) -> bool {
    match svm.get_account(address) {
        None => true,
        Some(a) => a.lamports == 0 && a.data.is_empty(),
    }
}

/// Plain SPL `Transfer` (tag 3): this is how anyone deposits into a vault.
pub fn spl_transfer_ix(source: &Pubkey, dest: &Pubkey, authority: &Pubkey, amount: u64) -> Instruction {
    let mut data = vec![3u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: TOKEN_PROGRAM,
        accounts: vec![
            AccountMeta::new(*source, false),
            AccountMeta::new(*dest, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

/// Associated Token Account program `CreateIdempotent` (anyone can create anyone's ATA).
pub fn create_ata_ix(payer: &Pubkey, wallet: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Instruction {
    Instruction {
        program_id: ATA_PROGRAM,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(ata_with(wallet, mint, token_program), false),
            AccountMeta::new_readonly(*wallet, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(*token_program, false),
        ],
        data: vec![1],
    }
}

pub fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> TxResult {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    let res = svm.send_transaction(tx);
    svm.expire_blockhash();
    res
}

pub fn code(e: LeashError) -> u32 {
    anchor_lang::error::ERROR_CODE_OFFSET + e as u32
}

#[track_caller]
pub fn assert_ok(res: &TxResult) {
    if let Err(f) = res {
        panic!("expected success, got {:?}\nlogs:\n{}", f.err, f.meta.logs.join("\n"));
    }
}

#[track_caller]
pub fn assert_leash_err(res: &TxResult, e: LeashError) {
    match res {
        Ok(m) => panic!("expected {:?}, tx succeeded\nlogs:\n{}", e, m.logs.join("\n")),
        Err(f) => {
            let want = format!("Custom({})", code(e));
            let got = format!("{:?}", f.err);
            assert!(got.contains(&want), "expected {:?} ({want}), got {got}\nlogs:\n{}", e, f.meta.logs.join("\n"));
        }
    }
}

#[track_caller]
pub fn assert_failed(res: &TxResult) {
    if let Ok(m) = res {
        panic!("expected failure, tx succeeded\nlogs:\n{}", m.logs.join("\n"));
    }
}

/// Every Anchor event of type `E` in the tx logs (`Program data: base64(discriminator || borsh)`).
pub fn events<E: AnchorDeserialize + Discriminator>(logs: &[String]) -> Vec<E> {
    use anchor_lang::__private::base64::{engine::general_purpose::STANDARD, Engine};
    logs.iter()
        .filter_map(|l| l.strip_prefix("Program data: "))
        .filter_map(|b64| STANDARD.decode(b64).ok())
        .filter(|d| d.starts_with(E::DISCRIMINATOR))
        .map(|d| E::deserialize(&mut &d[E::DISCRIMINATOR.len()..]).expect("event decodes"))
        .collect()
}

#[track_caller]
pub fn ok_events<E: AnchorDeserialize + Discriminator>(res: &TxResult) -> Vec<E> {
    match res {
        Ok(m) => events::<E>(&m.logs),
        Err(f) => panic!("expected success, got {:?}\nlogs:\n{}", f.err, f.meta.logs.join("\n")),
    }
}

pub fn read<T: AccountDeserialize>(svm: &LiteSVM, address: &Pubkey) -> T {
    let acct = svm.get_account(address).expect("account exists");
    T::try_deserialize(&mut acct.data.as_slice()).unwrap()
}

pub fn vault(env: &Env) -> Vault {
    read(&env.svm, &env.vault)
}
pub fn payee(env: &Env, payee: &Pubkey) -> Payee {
    read(&env.svm, &payee_pda(&env.vault, payee))
}
pub fn mandate(env: &Env, id: u64) -> Mandate {
    read(&env.svm, &mandate_pda(&env.vault, id))
}
pub fn request(env: &Env, seq: u64) -> SpendRequest {
    read(&env.svm, &request_pda(&env.vault, seq))
}

pub fn now(env: &Env) -> i64 {
    env.svm.get_sysvar::<solana_clock::Clock>().unix_timestamp
}

pub fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut clock = svm.get_sysvar::<solana_clock::Clock>();
    clock.unix_timestamp = ts;
    clock.slot += 1;
    svm.set_sysvar::<solana_clock::Clock>(&clock);
}

pub fn warp(env: &mut Env, secs: i64) {
    let t = now(env) + secs;
    set_time(&mut env.svm, t);
}

// ───────────────────────────── instruction builders ─────────────────────────────

pub fn ix_initialize(env: &Env, vault_id: u64, agent: Pubkey, policy: Policy) -> Instruction {
    let vault = vault_pda(&env.owner.pubkey(), vault_id);
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::InitializeVault { vault_id, agent, policy }.data(),
        leash::accounts::InitializeVault {
            owner: env.owner.pubkey(),
            vault,
            mint: env.mint,
            vault_ata: ata_with(&vault, &env.mint, &env.token_program),
            token_program: env.token_program,
            associated_token_program: ATA_PROGRAM,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// Owner-only ix on the vault itself (update_policy, set_agent, set_paused, reset_strikes, bump_mandate_seq).
pub fn ix_owner_vault(env: &Env, data: Vec<u8>, signer: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        leash::ID,
        &data,
        leash::accounts::OwnerVault { owner: *signer, vault: env.vault }.to_account_metas(None),
    )
}

pub fn ix_add_payee(env: &Env, payee: Pubkey, label: &str, per_tx_max: u64, budget_total: u64) -> Instruction {
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::AddPayee { payee, label: label.to_string(), per_tx_max, budget_total }.data(),
        leash::accounts::AddPayee {
            owner: env.owner.pubkey(),
            vault: env.vault,
            payee_account: payee_pda(&env.vault, &payee),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_update_payee(env: &Env, payee: Pubkey, per_tx_max: u64, budget_total: u64, active: bool) -> Instruction {
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::UpdatePayee { per_tx_max, budget_total, active }.data(),
        leash::accounts::UpdatePayee {
            owner: env.owner.pubkey(),
            vault: env.vault,
            payee_account: payee_pda(&env.vault, &payee),
        }
        .to_account_metas(None),
    )
}

pub fn ix_remove_payee(env: &Env, payee: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::RemovePayee {}.data(),
        leash::accounts::RemovePayee {
            owner: env.owner.pubkey(),
            vault: env.vault,
            payee_account: payee_pda(&env.vault, &payee),
        }
        .to_account_metas(None),
    )
}

pub fn ix_create_mandate(env: &Env, payee: Pubkey, max_total: u64, max_per_tx: u64, expires_at: i64) -> Instruction {
    let id = vault(env).mandate_seq;
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::CreateMandate { payee, max_total, max_per_tx, expires_at, intent_hash: [7u8; 32] }
            .data(),
        leash::accounts::CreateMandate {
            owner: env.owner.pubkey(),
            vault: env.vault,
            mandate: mandate_pda(&env.vault, id),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_revoke_mandate(env: &Env, id: u64) -> Instruction {
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::RevokeMandate {}.data(),
        leash::accounts::RevokeMandate { owner: env.owner.pubkey(), vault: env.vault, mandate: mandate_pda(&env.vault, id) }
            .to_account_metas(None),
    )
}

pub fn ix_close_mandate(env: &Env, id: u64) -> Instruction {
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::CloseMandate {}.data(),
        leash::accounts::CloseMandate { owner: env.owner.pubkey(), vault: env.vault, mandate: mandate_pda(&env.vault, id) }
            .to_account_metas(None),
    )
}

pub fn ix_bump_mandate_seq(env: &Env, new_seq: u64) -> Instruction {
    ix_owner_vault(env, leash::instruction::BumpMandateSeq { new_seq }.data(), &env.owner.pubkey())
}

pub enum Auth {
    Payee(Pubkey),
    Mandate(u64),
    None,
}

impl Auth {
    fn accounts(&self, vault: &Pubkey) -> (Option<Pubkey>, Option<Pubkey>) {
        match self {
            Auth::Payee(p) => (Some(payee_pda(vault, p)), None),
            Auth::Mandate(id) => (None, Some(mandate_pda(vault, *id))),
            Auth::None => (None, None),
        }
    }
}

/// Spend with explicit authorization accounts (any address, e.g. another vault's Payee PDA).
pub fn ix_spend_raw(
    env: &Env,
    signer: &Pubkey,
    recipient_ata: Pubkey,
    payee_account: Option<Pubkey>,
    mandate_account: Option<Pubkey>,
    amount: u64,
    guarded: bool,
) -> Instruction {
    let data = if guarded {
        leash::instruction::GuardedSpend { amount, reason_hash: [1u8; 32], memo: None }.data()
    } else {
        leash::instruction::AgentSpend { amount, reason_hash: [1u8; 32], memo: Some([9u8; 32]) }.data()
    };
    Instruction::new_with_bytes(
        leash::ID,
        &data,
        leash::accounts::Spend {
            agent: *signer,
            vault: env.vault,
            mint: env.mint,
            vault_ata: env.vault_ata,
            recipient_ata,
            payee_account,
            mandate_account,
            token_program: env.token_program,
        }
        .to_account_metas(None),
    )
}

pub fn ix_spend(env: &Env, signer: &Pubkey, recipient_ata: Pubkey, auth: Auth, amount: u64, guarded: bool) -> Instruction {
    let (p, m) = auth.accounts(&env.vault);
    ix_spend_raw(env, signer, recipient_ata, p, m, amount, guarded)
}

pub fn ix_request_raw(env: &Env, payee: Pubkey, payee_account: Option<Pubkey>, mandate_account: Option<Pubkey>, amount: u64) -> Instruction {
    let seq = vault(env).request_seq;
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::RequestSpend { payee, amount, reason_hash: [2u8; 32], memo: Some([3u8; 32]) }.data(),
        leash::accounts::RequestSpend {
            agent: env.agent.pubkey(),
            vault: env.vault,
            request: request_pda(&env.vault, seq),
            payee_account,
            mandate_account,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_request(env: &Env, payee: Pubkey, auth: Auth, amount: u64) -> Instruction {
    let (p, m) = auth.accounts(&env.vault);
    ix_request_raw(env, payee, p, m, amount)
}

pub fn ix_approve_raw(env: &Env, seq: u64, recipient_ata: Pubkey, payee_account: Option<Pubkey>, mandate_account: Option<Pubkey>) -> Instruction {
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::ApproveRequest {}.data(),
        leash::accounts::ApproveRequest {
            owner: env.owner.pubkey(),
            vault: env.vault,
            request: request_pda(&env.vault, seq),
            mint: env.mint,
            vault_ata: env.vault_ata,
            recipient_ata,
            payee_account,
            mandate_account,
            token_program: env.token_program,
            agent: env.agent.pubkey(),
        }
        .to_account_metas(None),
    )
}

pub fn ix_approve(env: &Env, seq: u64, recipient_ata: Pubkey, auth: Auth) -> Instruction {
    let (p, m) = auth.accounts(&env.vault);
    ix_approve_raw(env, seq, recipient_ata, p, m)
}

pub fn ix_reject(env: &Env, seq: u64) -> Instruction {
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::RejectRequest {}.data(),
        leash::accounts::RejectRequest {
            owner: env.owner.pubkey(),
            vault: env.vault,
            request: request_pda(&env.vault, seq),
            agent: env.agent.pubkey(),
        }
        .to_account_metas(None),
    )
}

pub fn ix_close_request(env: &Env, seq: u64) -> Instruction {
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::CloseRequest {}.data(),
        leash::accounts::CloseRequest { vault: env.vault, request: request_pda(&env.vault, seq), agent: env.agent.pubkey() }
            .to_account_metas(None),
    )
}

pub fn ix_withdraw(env: &Env, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::Withdraw { amount }.data(),
        leash::accounts::Withdraw {
            owner: env.owner.pubkey(),
            vault: env.vault,
            mint: env.mint,
            vault_ata: env.vault_ata,
            owner_token_account: env.owner_ata,
            token_program: env.token_program,
        }
        .to_account_metas(None),
    )
}

pub fn ix_close_vault(env: &Env) -> Instruction {
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::CloseVault {}.data(),
        leash::accounts::CloseVault {
            owner: env.owner.pubkey(),
            vault: env.vault,
            mint: env.mint,
            vault_ata: env.vault_ata,
            token_program: env.token_program,
        }
        .to_account_metas(None),
    )
}

// ───────────────────────────── setup ─────────────────────────────

/// Fresh SVM with the program, clock at T0, funded owner/agent, a 6-decimal mint (`mint_bytes` owned by
/// `token_program`, default: plain SPL mint) and token accounts for merchant, attacker and owner. The vault PDA is
/// computed but NOT initialized.
pub fn base_env_with_mint(token_program: Pubkey, mint_bytes: Option<Vec<u8>>) -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/leash.so"));
    svm.add_program(leash::ID, bytes).unwrap();
    set_time(&mut svm, T0);

    let owner = Keypair::new();
    let agent = Keypair::new();
    let mint_authority = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&agent.pubkey(), 1_000_000_000).unwrap();

    let mint = Pubkey::new_unique();
    let mdata = mint_bytes.unwrap_or_else(|| mint_data(&mint_authority.pubkey(), 3_000 * ONE));
    set_mint(&mut svm, mint, mdata, token_program);

    let merchant = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();
    let merchant_ata = ata_with(&merchant, &mint, &token_program);
    let attacker_ata = ata_with(&attacker, &mint, &token_program);
    let owner_ata = ata_with(&owner.pubkey(), &mint, &token_program);
    set_token_account_with(&mut svm, merchant_ata, &mint, &merchant, 0, token_program);
    set_token_account_with(&mut svm, attacker_ata, &mint, &attacker, 0, token_program);
    set_token_account_with(&mut svm, owner_ata, &mint, &owner.pubkey(), 2_000 * ONE, token_program);

    let vault_id = 1u64;
    let vault = vault_pda(&owner.pubkey(), vault_id);
    Env {
        svm,
        owner,
        agent,
        mint,
        mint_authority,
        token_program,
        merchant,
        merchant_ata,
        attacker,
        attacker_ata,
        owner_ata,
        vault,
        vault_ata: ata_with(&vault, &mint, &token_program),
        vault_id,
    }
}

pub fn base_env() -> Env {
    base_env_with_mint(TOKEN_PROGRAM, None)
}

/// `base_env` + vault 1 initialized with `policy`, holding 1,000 dUSDC deposited by plain SPL transfer, and the
/// merchant as an allowlisted payee: per-tx 0.50, budget 5.00.
pub fn setup(policy: Policy) -> Env {
    let mut env = base_env();
    let ix = ix_initialize(&env, env.vault_id, env.agent.pubkey(), policy);
    assert_ok(&owner_send(&mut env, &[ix]));

    // Deposit: anyone can fund a vault with a plain SPL transfer into its token account.
    let dep = spl_transfer_ix(&env.owner_ata, &env.vault_ata, &env.owner.pubkey(), 1_000 * ONE);
    assert_ok(&owner_send(&mut env, &[dep]));

    let add = ix_add_payee(&env, env.merchant, "Market Data API", ONE / 2, 5 * ONE);
    assert_ok(&owner_send(&mut env, &[add]));
    env
}

/// Allowlist a fresh payee (with its ATA) and return (payee, payee_ata).
pub fn add_funded_payee(env: &mut Env, label: &str, per_tx_max: u64, budget_total: u64) -> (Pubkey, Pubkey) {
    let p = Pubkey::new_unique();
    let p_ata = ata_with(&p, &env.mint, &env.token_program);
    let tp = env.token_program;
    let mint = env.mint;
    set_token_account_with(&mut env.svm, p_ata, &mint, &p, 0, tp);
    let ix = ix_add_payee(env, p, label, per_tx_max, budget_total);
    assert_ok(&owner_send(env, &[ix]));
    (p, p_ata)
}

/// Owner-signed tx helper.
pub fn owner_send(env: &mut Env, ixs: &[Instruction]) -> TxResult {
    let owner = env.owner.insecure_clone();
    send(&mut env.svm, ixs, &owner, &[])
}

/// Agent-signed tx helper.
pub fn agent_send(env: &mut Env, ixs: &[Instruction]) -> TxResult {
    let agent = env.agent.insecure_clone();
    send(&mut env.svm, ixs, &agent, &[])
}
