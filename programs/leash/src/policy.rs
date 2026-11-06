//! The authorization check every outgoing payment goes through. Pure: it reads state and returns either the
//! authorization or a `Refusal` (named error + whether it is a tripwire strike); callers decide whether to revert
//! (agent_spend) or record (guarded_spend / enforce_tripwire).

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as Token2022Mint,
};
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::errors::LeashError;
use crate::state::*;

pub struct Authorized {
    pub payee: Pubkey,
    pub via: AuthKind,
}

/// A refused payment. `strike` is true only for unauthorized attempts: no owner-signed authorization covers the
/// payee (`PayeeNotAuthorized`), or the money would land in an account the payee doesn't own (`RecipientMismatch`
/// to a foreign owner). Caps, budgets, expiry and a missing payee ATA are benign: an honest agent hits them too,
/// so they never count toward freezing the vault.
#[derive(Clone, Copy, Debug)]
pub struct Refusal {
    pub error: LeashError,
    pub strike: bool,
}

impl Refusal {
    pub fn strike(error: LeashError) -> Self {
        Self { error, strike: true }
    }
    pub fn benign(error: LeashError) -> Self {
        Self { error, strike: false }
    }
    /// Errors that always revert, even on the tripwire path: a large legitimate payment needs a co-sign, not a
    /// strike, and arithmetic overflow is never a policy outcome.
    pub fn is_hard(&self) -> bool {
        matches!(self.error, LeashError::RequiresCosign | LeashError::Overflow)
    }
}

impl From<Refusal> for anchor_lang::error::Error {
    fn from(r: Refusal) -> Self {
        r.error.into()
    }
}

impl From<LeashError> for Refusal {
    fn from(e: LeashError) -> Self {
        Refusal::benign(e)
    }
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

// ───────────────────────────── program accounts loaded by hand ─────────────────────────────

/// Deserialize a Leash account (owner + discriminator checked). `None` for a closed, foreign or fake account.
pub fn load_program_account<T: AccountDeserialize + Owner>(info: &AccountInfo) -> Option<T> {
    if info.owner != &T::owner() {
        return None;
    }
    let data = info.try_borrow_data().ok()?;
    let mut slice: &[u8] = &data[..];
    T::try_deserialize(&mut slice).ok()
}

pub fn store_program_account<T: AccountSerialize>(info: &AccountInfo, value: &T) -> Result<()> {
    let mut data = info.try_borrow_mut_data()?;
    let mut dst: &mut [u8] = &mut data[..];
    value.try_serialize(&mut dst)
}

/// Close a program-owned account: all lamports to `dest`, data cleared, owner reset to the system program.
pub fn close_program_account<'info>(info: &AccountInfo<'info>, dest: &AccountInfo<'info>) -> Result<()> {
    if info.key == dest.key {
        return Err(anchor_lang::error::ErrorCode::ConstraintClose.into());
    }
    dest.add_lamports(info.lamports())?;
    **info.lamports.borrow_mut() = 0;
    info.assign(&anchor_lang::solana_program::system_program::ID);
    info.resize(0).map_err(Into::into)
}

/// The payee / mandate accounts a spend was submitted with. `Err` if one was passed but isn't a live Leash
/// account of that type (closed PDA, another program's account, garbage): that is never an authorization.
pub fn load_authorization(
    payee_info: Option<&AccountInfo>,
    mandate_info: Option<&AccountInfo>,
) -> core::result::Result<(Option<Payee>, Option<Mandate>), Refusal> {
    let payee = match payee_info {
        Some(info) => Some(load_program_account::<Payee>(info).ok_or(Refusal::strike(LeashError::PayeeNotAuthorized))?),
        None => None,
    };
    let mandate = match mandate_info {
        Some(info) => {
            Some(load_program_account::<Mandate>(info).ok_or(Refusal::strike(LeashError::PayeeNotAuthorized))?)
        }
        None => None,
    };
    Ok((payee, mandate))
}

// ───────────────────────────── the check ─────────────────────────────

pub struct SpendCheck<'a, 'info> {
    pub vault: &'a Vault,
    pub vault_key: Pubkey,
    pub payee: Option<&'a Payee>,
    pub mandate: Option<&'a Mandate>,
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
/// Step 4 needs to know *who* is authorized, so the authorization account is resolved first (no account → the
/// payee isn't authorized), then the recipient is matched against that payee's ATA, then limits apply.
pub fn check_spend(c: &SpendCheck) -> core::result::Result<Authorized, Refusal> {
    // 4a. Which owner-signed authorization covers this payment? (A Payee/Mandate of another vault never does.)
    let (auth_payee, via) = if let Some(p) = c.payee {
        if p.vault != c.vault_key || !p.active {
            return Err(Refusal::strike(LeashError::PayeeNotAuthorized));
        }
        (p.payee, AuthKind::Payee)
    } else if let Some(m) = c.mandate {
        if m.vault != c.vault_key {
            return Err(Refusal::strike(LeashError::PayeeNotAuthorized));
        }
        (m.payee, AuthKind::Mandate)
    } else {
        return Err(Refusal::strike(LeashError::PayeeNotAuthorized));
    };
    if let Some(expected) = c.expected_payee {
        if expected != auth_payee {
            return Err(Refusal::strike(LeashError::PayeeNotAuthorized));
        }
    }

    // 4b. The money must land in that payee's associated token account for the vault mint: the account the
    //     merchant actually watches, not a stray account it happens to own.
    let expected_ata = get_associated_token_address_with_program_id(&auth_payee, &c.vault.mint, &c.token_program);
    let recipient = read_token_account(c.recipient, &c.token_program);
    if *c.recipient.key != expected_ata {
        // The payee's own non-ATA account is a routing mistake; anything else is a redirect attempt.
        let payee_owned = matches!(recipient, Some((owner, _)) if owner == auth_payee);
        return Err(Refusal { error: LeashError::RecipientMismatch, strike: !payee_owned });
    }
    match recipient {
        Some((owner, mint)) if owner == auth_payee && mint == c.vault.mint => {}
        // The payee's ATA doesn't exist (yet): benign.
        _ => return Err(Refusal::benign(LeashError::RecipientMismatch)),
    }

    // 5. Limits of that authorization.
    match via {
        AuthKind::Payee => {
            let p = c.payee.unwrap();
            if c.amount > p.per_tx_max {
                return Err(LeashError::ExceedsPayeePerTx.into());
            }
            if p.budget_total != 0 {
                let after = p.spent.checked_add(c.amount).ok_or(LeashError::Overflow)?;
                if after > p.budget_total {
                    return Err(LeashError::PayeeBudgetExceeded.into());
                }
            }
        }
        AuthKind::Mandate => {
            let m = c.mandate.unwrap();
            if m.revoked {
                return Err(LeashError::MandateRevoked.into());
            }
            if c.now >= m.expires_at {
                return Err(LeashError::MandateExpired.into());
            }
            if c.amount > m.max_per_tx {
                return Err(LeashError::ExceedsPayeePerTx.into());
            }
            let after = m.spent.checked_add(c.amount).ok_or(LeashError::Overflow)?;
            if after > m.max_total {
                return Err(LeashError::MandateExhausted.into());
            }
        }
        AuthKind::Request => unreachable!(),
    }

    // 6. Vault per-transaction cap.
    if c.amount > c.vault.per_tx_cap {
        return Err(LeashError::ExceedsPerTxCap.into());
    }

    // 7. Rolling 24h cap (hourly buckets: every payment counts for 24-25h).
    let after = c.vault.spent_24h(c.now).checked_add(c.amount).ok_or(LeashError::Overflow)?;
    if after > c.vault.daily_cap {
        return Err(LeashError::ExceedsDailyCap.into());
    }

    // 8. Co-sign: a single large payment, or the agent's autonomous total in the rolling 24h.
    if c.enforce_cosign {
        if c.vault.cosign_threshold != 0 && c.amount >= c.vault.cosign_threshold {
            return Err(LeashError::RequiresCosign.into());
        }
        if c.vault.cosign_window_threshold != 0 {
            let auto_after = c.vault.autonomous_24h(c.now).checked_add(c.amount).ok_or(LeashError::Overflow)?;
            if auto_after >= c.vault.cosign_window_threshold {
                return Err(LeashError::RequiresCosign.into());
            }
        }
    }

    Ok(Authorized { payee: auth_payee, via })
}

/// Add a payment to the rolling rings (and the autonomous ring when no co-sign was involved).
pub fn commit_vault_counters(vault: &mut Vault, amount: u64, now: i64, autonomous: bool) -> Result<()> {
    vault.roll_buckets(now);
    let slot = vault.current_slot();
    vault.spent_buckets[slot] = vault.spent_buckets[slot].checked_add(amount).ok_or(LeashError::Overflow)?;
    if autonomous {
        vault.auto_buckets[slot] = vault.auto_buckets[slot].checked_add(amount).ok_or(LeashError::Overflow)?;
    }
    vault.total_spent = vault.total_spent.checked_add(amount).ok_or(LeashError::Overflow)?;
    Ok(())
}

// ───────────────────────────── token CPIs ─────────────────────────────

fn with_vault_seeds<R>(vault: &Vault, f: impl FnOnce(&[&[&[u8]]]) -> R) -> R {
    let owner = vault.owner;
    let id_bytes = vault.vault_id.to_le_bytes();
    let bump = [vault.bump];
    let seeds: &[&[u8]] = &[VAULT_SEED, owner.as_ref(), &id_bytes, &bump];
    f(&[seeds])
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
    with_vault_seeds(vault, |signer| {
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
    })
}

/// PDA-signed `close_account` of the (empty) vault token account, rent to `dest`.
pub fn close_vault_ata<'info>(
    vault: &Account<'info, Vault>,
    vault_ata: &InterfaceAccount<'info, TokenAccount>,
    dest: AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    with_vault_seeds(vault, |signer| {
        token_interface::close_account(CpiContext::new_with_signer(
            token_program.key(),
            CloseAccount { account: vault_ata.to_account_info(), destination: dest, authority: vault.to_account_info() },
            signer,
        ))
    })
}

// ───────────────────────────── policy + mint validation ─────────────────────────────

pub fn validate_policy(p: &Policy) -> Result<()> {
    require!(p.per_tx_cap > 0, LeashError::InvalidPolicy);
    require!(p.daily_cap >= p.per_tx_cap, LeashError::InvalidPolicy);
    require!(p.request_ttl_secs > 0, LeashError::InvalidPolicy);
    Ok(())
}

/// Token-2022 extensions a vault mint may carry. Everything else is refused at init, including types this build
/// doesn't know: transfer fees (payee receives less), transfer hooks (arbitrary code on every payment), permanent
/// delegate (a third party can move vault funds), pausable / default-frozen state / non-transferable (funds can be
/// locked), mint close authority (the mint can be re-created with different rules), and interest-bearing / scaled
/// UI amounts (the UI amounts in a signed mandate would not be what the wallet shows).
fn allowed_mint_extension(t: ExtensionType) -> bool {
    matches!(
        t,
        ExtensionType::Uninitialized
            | ExtensionType::MetadataPointer
            | ExtensionType::TokenMetadata
            | ExtensionType::GroupPointer
            | ExtensionType::TokenGroup
            | ExtensionType::GroupMemberPointer
            | ExtensionType::TokenGroupMember
            | ExtensionType::ConfidentialTransferMint
            | ExtensionType::ConfidentialMintBurn
    )
}

pub fn validate_mint(mint: &AccountInfo, decimals: u8) -> Result<()> {
    require!(decimals <= MAX_MINT_DECIMALS, LeashError::UnsupportedMint);
    if mint.owner == &anchor_spl::token_2022::ID {
        let data = mint.try_borrow_data()?;
        let state = StateWithExtensions::<Token2022Mint>::unpack(&data[..]).map_err(|_| error!(LeashError::UnsupportedMint))?;
        let types = state.get_extension_types().map_err(|_| error!(LeashError::UnsupportedMint))?;
        require!(types.into_iter().all(allowed_mint_extension), LeashError::UnsupportedMint);
    }
    Ok(())
}
