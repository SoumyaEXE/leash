//! Verify that the instruction right before ours is an Ed25519 precompile check of the vault owner's signature
//! over exactly the expected message. Every check below closes a known bypass:
//! - program id must be the Ed25519 precompile (not a look-alike program),
//! - exactly one signature,
//! - all three instruction indices == u16::MAX, so offsets point into *this* instruction's data and can't be
//!   redirected at bytes in another instruction,
//! - every offset + length in bounds,
//! - signer pubkey == vault.owner, message bytes == expected (prefix + hex(borsh(terms))).

use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use crate::errors::LeashError;
use crate::state::{MandateTerms, MANDATE_MESSAGE_PREFIX};

const HEADER_LEN: usize = 2; // num_signatures u8 + padding u8
const OFFSETS_LEN: usize = 14; // 7 x u16
const PUBKEY_LEN: usize = 32;
const SIGNATURE_LEN: usize = 64;

/// `"LEASH_MANDATE_V1:" || lowercase_hex(borsh(terms))`. UTF-8 so any wallet's signMessage can display it.
pub fn mandate_message(terms: &MandateTerms) -> Result<Vec<u8>> {
    let mut raw = Vec::with_capacity(128);
    terms.serialize(&mut raw).map_err(|_| error!(LeashError::InvalidMandateSignature))?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut msg = Vec::with_capacity(MANDATE_MESSAGE_PREFIX.len() + raw.len() * 2);
    msg.extend_from_slice(MANDATE_MESSAGE_PREFIX);
    for b in raw {
        msg.push(HEX[(b >> 4) as usize]);
        msg.push(HEX[(b & 0x0f) as usize]);
    }
    Ok(msg)
}

fn u16_at(data: &[u8], at: usize) -> Result<u16> {
    let bytes = data.get(at..at + 2).ok_or(error!(LeashError::InvalidMandateSignature))?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn slice_at(data: &[u8], offset: usize, len: usize) -> Result<&[u8]> {
    let end = offset.checked_add(len).ok_or(error!(LeashError::InvalidMandateSignature))?;
    data.get(offset..end).ok_or(error!(LeashError::InvalidMandateSignature))
}

pub fn verify_owner_signature(ix_sysvar: &AccountInfo, owner: &Pubkey, expected_msg: &[u8]) -> Result<()> {
    let current = load_current_index_checked(ix_sysvar).map_err(|_| error!(LeashError::InvalidMandateSignature))?;
    require!(current > 0, LeashError::InvalidMandateSignature);
    let ix = load_instruction_at_checked((current - 1) as usize, ix_sysvar)
        .map_err(|_| error!(LeashError::InvalidMandateSignature))?;

    require!(ix.program_id == solana_sdk_ids::ed25519_program::ID, LeashError::InvalidMandateSignature);
    let data = &ix.data;
    require!(data.len() >= HEADER_LEN + OFFSETS_LEN, LeashError::InvalidMandateSignature);
    require!(data[0] == 1, LeashError::InvalidMandateSignature);

    let o = HEADER_LEN;
    let sig_offset = u16_at(data, o)? as usize;
    let sig_ix = u16_at(data, o + 2)?;
    let pk_offset = u16_at(data, o + 4)? as usize;
    let pk_ix = u16_at(data, o + 6)?;
    let msg_offset = u16_at(data, o + 8)? as usize;
    let msg_size = u16_at(data, o + 10)? as usize;
    let msg_ix = u16_at(data, o + 12)?;

    require!(
        sig_ix == u16::MAX && pk_ix == u16::MAX && msg_ix == u16::MAX,
        LeashError::InvalidMandateSignature
    );
    slice_at(data, sig_offset, SIGNATURE_LEN)?; // bounds only; the precompile verified the signature itself
    let pk = slice_at(data, pk_offset, PUBKEY_LEN)?;
    let msg = slice_at(data, msg_offset, msg_size)?;

    require!(pk == owner.as_ref(), LeashError::InvalidMandateSignature);
    require!(msg == expected_msg, LeashError::InvalidMandateSignature);
    Ok(())
}
