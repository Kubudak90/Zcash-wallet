//! Outputs of transactions the wallet's accounts funded.
//!
//! Mirrors the `sent_notes` table of zcash_client_sqlite 0.23 (`wallet/db.rs`) and the
//! upsert of `put_sent_output` / `recipient_params` (`wallet.rs`). Outputs of every pool
//! (transparent included) are stored here, keyed by transaction, pool and output index.

use std::collections::BTreeMap;

use zcash_primitives::transaction::TxId;
use zcash_protocol::{PoolType, memo::MemoBytes, value::Zatoshis};

use crate::AccountId;

/// The key of a sent output: transaction, output pool, index within that pool's bundle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct SentOutputId {
    pub(crate) txid: TxId,
    pub(crate) pool: PoolType,
    pub(crate) output_index: u32,
}

impl SentOutputId {
    pub fn txid(&self) -> &TxId {
        &self.txid
    }
    pub fn pool(&self) -> PoolType {
        self.pool
    }
    pub fn output_index(&self) -> u32 {
        self.output_index
    }
}

/// A sent output.
#[derive(Debug, Clone, PartialEq)]
pub struct SentOutput {
    /// The account that funded the transaction.
    pub(crate) from_account_id: AccountId,
    /// The recipient address (encoded), unless the output went to one of the wallet's
    /// accounts under an internal address.
    pub(crate) to_address: Option<String>,
    /// The receiving account, if the output went to one of the wallet's accounts.
    pub(crate) to_account_id: Option<AccountId>,
    pub(crate) value: Zatoshis,
    /// The memo, if known; never set for transparent outputs.
    pub(crate) memo: Option<MemoBytes>,
}

impl SentOutput {
    pub fn from_account_id(&self) -> AccountId {
        self.from_account_id
    }
    pub fn to_address(&self) -> Option<&str> {
        self.to_address.as_deref()
    }
    pub fn to_account_id(&self) -> Option<AccountId> {
        self.to_account_id
    }
    pub fn value(&self) -> Zatoshis {
        self.value
    }
    pub fn memo(&self) -> Option<&MemoBytes> {
        self.memo.as_ref()
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SentNoteTable(pub(crate) BTreeMap<SentOutputId, SentOutput>);

impl SentNoteTable {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&SentOutputId, &SentOutput)> {
        self.0.iter()
    }

    pub fn get(&self, id: &SentOutputId) -> Option<&SentOutput> {
        self.0.get(id)
    }

    /// The sent outputs of `txid`.
    pub fn of_tx<'a>(
        &'a self,
        txid: &'a TxId,
    ) -> impl Iterator<Item = (&'a SentOutputId, &'a SentOutput)> + 'a {
        self.0.iter().filter(move |(id, _)| id.txid == *txid)
    }

    /// `put_sent_output` upsert: on conflict the funding account and value are replaced,
    /// the recipient address and account are kept if already known, and the memo is
    /// replaced only by a known memo.
    pub(crate) fn put(&mut self, id: SentOutputId, output: SentOutput) {
        match self.0.get_mut(&id) {
            None => {
                self.0.insert(id, output);
            }
            Some(existing) => {
                existing.from_account_id = output.from_account_id;
                existing.to_address = existing.to_address.take().or(output.to_address);
                existing.to_account_id = existing.to_account_id.or(output.to_account_id);
                existing.value = output.value;
                existing.memo = output.memo.or(existing.memo.take());
            }
        }
    }

    pub(crate) fn remove_tx(&mut self, txid: &TxId) {
        self.0.retain(|id, _| id.txid != *txid);
    }

    /// `ON DELETE CASCADE` on `from_account_id`, `ON DELETE SET NULL` on `to_account_id`.
    pub(crate) fn remove_account(&mut self, account: AccountId) {
        self.0.retain(|_, o| o.from_account_id != account);
        for o in self.0.values_mut() {
            if o.to_account_id == Some(account) {
                o.to_account_id = None;
            }
        }
    }
}
