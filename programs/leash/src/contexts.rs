use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::LeashError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, owner.key().as_ref(), &vault_id.to_le_bytes()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// `init_if_needed`: the vault PDA (and so its ATA address) is predictable, and anyone can create an ATA for any
    /// owner. A pre-created ATA must not brick this vault_id. Anchor still checks it is the ATA of (vault, mint).
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Owner-only changes to the vault itself (policy, agent, pause, strikes, mandate sequence).
#[derive(Accounts)]
pub struct OwnerVault<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ LeashError::NotOwner)]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
#[instruction(payee: Pubkey)]
pub struct AddPayee<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ LeashError::NotOwner)]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = owner,
        space = 8 + Payee::INIT_SPACE,
        seeds = [PAYEE_SEED, vault.key().as_ref(), payee.as_ref()],
        bump,
    )]
    pub payee_account: Account<'info, Payee>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePayee<'info> {
    pub owner: Signer<'info>,
    #[account(has_one = owner @ LeashError::NotOwner)]
    pub vault: Account<'info, Vault>,
    #[account(mut, has_one = vault @ LeashError::NotOwner)]
    pub payee_account: Account<'info, Payee>,
}

#[derive(Accounts)]
pub struct RemovePayee<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ LeashError::NotOwner)]
    pub vault: Account<'info, Vault>,
    #[account(mut, has_one = vault @ LeashError::NotOwner, close = owner)]
    pub payee_account: Account<'info, Payee>,
}

#[derive(Accounts)]
pub struct CreateMandate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ LeashError::NotOwner)]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = owner,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [MANDATE_SEED, vault.key().as_ref(), &vault.mandate_seq.to_le_bytes()],
        bump,
    )]
    pub mandate: Account<'info, Mandate>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RedeemSignedMandate<'info> {
    /// The agent submits (and pays for) the owner's signed mandate.
    #[account(mut)]
    pub agent: Signer<'info>,
    #[account(mut, constraint = vault.agent == agent.key() @ LeashError::NotAgent)]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = agent,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [MANDATE_SEED, vault.key().as_ref(), &vault.mandate_seq.to_le_bytes()],
        bump,
    )]
    pub mandate: Account<'info, Mandate>,
    /// The vault mint: its decimals turn base units into the UI amounts the owner read.
    #[account(address = vault.mint @ LeashError::RecipientMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: the instructions sysvar, pinned by address.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeMandate<'info> {
    pub owner: Signer<'info>,
    #[account(has_one = owner @ LeashError::NotOwner)]
    pub vault: Account<'info, Vault>,
    #[account(mut, has_one = vault @ LeashError::NotOwner)]
    pub mandate: Account<'info, Mandate>,
}

/// Close a mandate (any state); rent goes to the owner.
#[derive(Accounts)]
pub struct CloseMandate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ LeashError::NotOwner)]
    pub vault: Account<'info, Vault>,
    #[account(mut, has_one = vault @ LeashError::NotOwner, close = owner)]
    pub mandate: Account<'info, Mandate>,
}

/// Shared by `agent_spend` (violations revert, unless the vault enforces the tripwire) and `guarded_spend`
/// (violations are recorded). No separate fee payer: an x402 facilitator can pay the fee without appearing here.
#[derive(Accounts)]
pub struct Spend<'info> {
    pub agent: Signer<'info>,
    #[account(mut, constraint = vault.agent == agent.key() @ LeashError::NotAgent)]
    pub vault: Account<'info, Vault>,
    #[account(address = vault.mint @ LeashError::RecipientMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: validated in the handler (must be the authorized payee's ATA for the vault mint) so that a bad
    /// recipient yields a named Leash error, and so the tripwire can record it instead of reverting.
    #[account(mut)]
    pub recipient_ata: UncheckedAccount<'info>,
    /// CHECK: loaded in the handler. A closed, foreign or fake Payee account is `PayeeNotAuthorized` (a named error
    /// the tripwire can record), not an Anchor deserialization error.
    #[account(mut)]
    pub payee_account: Option<UncheckedAccount<'info>>,
    /// CHECK: loaded in the handler, same as `payee_account`.
    #[account(mut)]
    pub mandate_account: Option<UncheckedAccount<'info>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RequestSpend<'info> {
    /// The agent pays the request account's rent (refunded when the request is resolved or closed).
    #[account(mut)]
    pub agent: Signer<'info>,
    #[account(mut, constraint = vault.agent == agent.key() @ LeashError::NotAgent)]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = agent,
        space = 8 + SpendRequest::INIT_SPACE,
        seeds = [REQUEST_SEED, vault.key().as_ref(), &vault.request_seq.to_le_bytes()],
        bump,
    )]
    pub request: Account<'info, SpendRequest>,
    /// CHECK: loaded in the handler (invalid → PayeeNotAuthorized).
    pub payee_account: Option<UncheckedAccount<'info>>,
    /// CHECK: loaded in the handler (invalid → PayeeNotAuthorized).
    pub mandate_account: Option<UncheckedAccount<'info>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveRequest<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ LeashError::NotOwner)]
    pub vault: Account<'info, Vault>,
    /// CHECK: loaded in the handler; an already-resolved (closed) request is `RequestNotPending`.
    #[account(mut)]
    pub request: UncheckedAccount<'info>,
    #[account(address = vault.mint @ LeashError::RecipientMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: validated in the handler against request.payee and the vault mint.
    #[account(mut)]
    pub recipient_ata: UncheckedAccount<'info>,
    /// CHECK: loaded in the handler (invalid → PayeeNotAuthorized).
    #[account(mut)]
    pub payee_account: Option<UncheckedAccount<'info>>,
    /// CHECK: loaded in the handler (invalid → PayeeNotAuthorized).
    #[account(mut)]
    pub mandate_account: Option<UncheckedAccount<'info>>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: receives the request's rent; pinned to the vault's agent.
    #[account(mut, address = vault.agent @ LeashError::NotAgent)]
    pub agent: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RejectRequest<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ LeashError::NotOwner)]
    pub vault: Account<'info, Vault>,
    /// CHECK: loaded in the handler; an already-resolved (closed) request is `RequestNotPending`.
    #[account(mut)]
    pub request: UncheckedAccount<'info>,
    /// CHECK: receives the request's rent; pinned to the vault's agent.
    #[account(mut, address = vault.agent @ LeashError::NotAgent)]
    pub agent: UncheckedAccount<'info>,
}

/// Permissionless crank: close an expired request and refund its rent to the agent.
#[derive(Accounts)]
pub struct CloseRequest<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    /// CHECK: loaded in the handler.
    #[account(mut)]
    pub request: UncheckedAccount<'info>,
    /// CHECK: receives the request's rent; pinned to the vault's agent.
    #[account(mut, address = vault.agent @ LeashError::NotAgent)]
    pub agent: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,
    #[account(has_one = owner @ LeashError::NotOwner)]
    pub vault: Account<'info, Vault>,
    #[account(address = vault.mint @ LeashError::RecipientMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Close an empty vault and its token account; all rent goes to the owner.
#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ LeashError::NotOwner, close = owner)]
    pub vault: Account<'info, Vault>,
    #[account(address = vault.mint @ LeashError::RecipientMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}
