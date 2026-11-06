#![allow(dead_code)]
//! LiteSVM harness for the Leash program: token accounts are written directly (fixed SPL layouts), every
//! instruction is built from the Anchor-generated `leash::instruction` / `leash::accounts` types.

use anchor_lang::{
    prelude::Pubkey,
    solana_program::{instruction::Instruction, system_program},
    AccountDeserialize, InstructionData, ToAccountMetas,
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
pub const ATA_PROGRAM: Pubkey = anchor_spl::associated_token::ID;
pub const DECIMALS: u8 = 6;
pub const ONE: u64 = 1_000_000; // 1.00 dUSDC

pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

/// Demo policy from prompts A2: per-tx 1.00, 24h 5.00, co-sign at 0.20, 1h request TTL.
pub fn demo_policy() -> Policy {
    Policy {
        per_tx_cap: ONE,
        daily_cap: 5 * ONE,
        cosign_threshold: ONE / 5,
        request_ttl_secs: 3600,
        freeze_after_strikes: 0,
    }
}

pub struct Env {
    pub svm: LiteSVM,
    pub owner: Keypair,
    pub agent: Keypair,
    pub mint: Pubkey,
    pub mint_authority: Keypair,
    pub merchant: Pubkey,
    pub merchant_ata: Pubkey,
    pub attacker: Pubkey,
    pub attacker_ata: Pubkey,
    pub owner_ata: Pubkey,
    pub vault: Pubkey,
    pub vault_ata: Pubkey,
    pub vault_id: u64,
}

pub fn ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[wallet.as_ref(), TOKEN_PROGRAM.as_ref(), mint.as_ref()], &ATA_PROGRAM).0
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
pub fn mint_data(authority: &Pubkey, supply: u64) -> Vec<u8> {
    let mut d = Vec::with_capacity(82);
    coption_pubkey(&mut d, Some(authority));
    d.extend_from_slice(&supply.to_le_bytes());
    d.push(DECIMALS);
    d.push(1); // is_initialized
    coption_pubkey(&mut d, None);
    assert_eq!(d.len(), 82);
    d
}

/// SPL Token Account layout (165 bytes).
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

pub fn set_token_account(svm: &mut LiteSVM, address: Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64) {
    let data = token_account_data(mint, owner, amount);
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(address, Account { lamports, data, owner: TOKEN_PROGRAM, executable: false, rent_epoch: 0 })
        .unwrap();
}

pub fn token_balance(svm: &LiteSVM, address: &Pubkey) -> u64 {
    let acct = svm.get_account(address).expect("token account exists");
    u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
}

/// Plain SPL `Transfer` (tag 3): this is how anyone deposits into a vault.
pub fn spl_transfer_ix(source: &Pubkey, dest: &Pubkey, authority: &Pubkey, amount: u64) -> Instruction {
    let mut data = vec![3u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: TOKEN_PROGRAM,
        accounts: vec![
            anchor_lang::solana_program::instruction::AccountMeta::new(*source, false),
            anchor_lang::solana_program::instruction::AccountMeta::new(*dest, false),
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(*authority, true),
        ],
        data,
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

pub fn warp(env: &mut Env, secs: i64) {
    let mut clock = env.svm.get_sysvar::<solana_clock::Clock>();
    clock.unix_timestamp += secs;
    clock.slot += 1;
    env.svm.set_sysvar::<solana_clock::Clock>(&clock);
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
            vault_ata: ata(&vault, &env.mint),
            token_program: TOKEN_PROGRAM,
            associated_token_program: ATA_PROGRAM,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

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

pub enum Auth {
    Payee(Pubkey),
    Mandate(u64),
    None,
}

pub fn spend_accounts(env: &Env, signer: &Pubkey, recipient_ata: Pubkey, auth: &Auth) -> leash::accounts::Spend {
    leash::accounts::Spend {
        agent: *signer,
        vault: env.vault,
        mint: env.mint,
        vault_ata: env.vault_ata,
        recipient_ata,
        payee_account: match auth {
            Auth::Payee(p) => Some(payee_pda(&env.vault, p)),
            _ => None,
        },
        mandate_account: match auth {
            Auth::Mandate(id) => Some(mandate_pda(&env.vault, *id)),
            _ => None,
        },
        token_program: TOKEN_PROGRAM,
    }
}

pub fn ix_spend(env: &Env, signer: &Pubkey, recipient_ata: Pubkey, auth: Auth, amount: u64, guarded: bool) -> Instruction {
    let data = if guarded {
        leash::instruction::GuardedSpend { amount, reason_hash: [1u8; 32], memo: None }.data()
    } else {
        leash::instruction::AgentSpend { amount, reason_hash: [1u8; 32], memo: Some([9u8; 32]) }.data()
    };
    Instruction::new_with_bytes(
        leash::ID,
        &data,
        spend_accounts(env, signer, recipient_ata, &auth).to_account_metas(None),
    )
}

pub fn ix_request(env: &Env, payee: Pubkey, auth: Auth, amount: u64) -> Instruction {
    let seq = vault(env).request_seq;
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::RequestSpend { payee, amount, reason_hash: [2u8; 32], memo: Some([3u8; 32]) }.data(),
        leash::accounts::RequestSpend {
            agent: env.agent.pubkey(),
            vault: env.vault,
            request: request_pda(&env.vault, seq),
            payee_account: match auth {
                Auth::Payee(p) => Some(payee_pda(&env.vault, &p)),
                _ => None,
            },
            mandate_account: match auth {
                Auth::Mandate(id) => Some(mandate_pda(&env.vault, id)),
                _ => None,
            },
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_approve(env: &Env, seq: u64, recipient_ata: Pubkey, auth: Auth) -> Instruction {
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
            payee_account: match auth {
                Auth::Payee(p) => Some(payee_pda(&env.vault, &p)),
                _ => None,
            },
            mandate_account: match auth {
                Auth::Mandate(id) => Some(mandate_pda(&env.vault, id)),
                _ => None,
            },
            token_program: TOKEN_PROGRAM,
        }
        .to_account_metas(None),
    )
}

pub fn ix_reject(env: &Env, seq: u64) -> Instruction {
    Instruction::new_with_bytes(
        leash::ID,
        &leash::instruction::RejectRequest {}.data(),
        leash::accounts::RejectRequest {
            owner: env.owner.pubkey(),
            vault: env.vault,
            request: request_pda(&env.vault, seq),
        }
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
            token_program: TOKEN_PROGRAM,
        }
        .to_account_metas(None),
    )
}

// ───────────────────────────── setup ─────────────────────────────

/// Fresh SVM with the program, a 6-decimal mint, funded owner/agent, token accounts for merchant, attacker and
/// owner, and vault 1 initialized with `policy`, holding 1,000 dUSDC deposited by plain SPL transfer.
/// The merchant is an allowlisted payee: per-tx 0.50, budget 5.00.
pub fn setup(policy: Policy) -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/leash.so"));
    svm.add_program(leash::ID, bytes).unwrap();

    let owner = Keypair::new();
    let agent = Keypair::new();
    let mint_authority = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&agent.pubkey(), 1_000_000_000).unwrap();

    let mint = Pubkey::new_unique();
    let mdata = mint_data(&mint_authority.pubkey(), 3_000 * ONE);
    let lamports = svm.minimum_balance_for_rent_exemption(mdata.len());
    svm.set_account(mint, Account { lamports, data: mdata, owner: TOKEN_PROGRAM, executable: false, rent_epoch: 0 })
        .unwrap();

    let merchant = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();
    let merchant_ata = ata(&merchant, &mint);
    let attacker_ata = ata(&attacker, &mint);
    let owner_ata = ata(&owner.pubkey(), &mint);
    set_token_account(&mut svm, merchant_ata, &mint, &merchant, 0);
    set_token_account(&mut svm, attacker_ata, &mint, &attacker, 0);
    set_token_account(&mut svm, owner_ata, &mint, &owner.pubkey(), 2_000 * ONE);

    let vault_id = 1u64;
    let vault = vault_pda(&owner.pubkey(), vault_id);
    let mut env = Env {
        svm,
        owner,
        agent,
        mint,
        mint_authority,
        merchant,
        merchant_ata,
        attacker,
        attacker_ata,
        owner_ata,
        vault,
        vault_ata: ata(&vault, &mint),
        vault_id,
    };

    let ix = ix_initialize(&env, vault_id, env.agent.pubkey(), policy);
    let res = send(&mut env.svm, &[ix], &env.owner.insecure_clone(), &[]);
    assert_ok(&res);

    // Deposit: anyone can fund a vault with a plain SPL transfer into its token account.
    let dep = spl_transfer_ix(&env.owner_ata, &env.vault_ata, &env.owner.pubkey(), 1_000 * ONE);
    let res = send(&mut env.svm, &[dep], &env.owner.insecure_clone(), &[]);
    assert_ok(&res);

    let add = ix_add_payee(&env, env.merchant, "Market Data API", ONE / 2, 5 * ONE);
    let res = send(&mut env.svm, &[add], &env.owner.insecure_clone(), &[]);
    assert_ok(&res);
    env
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
