//! Requests for transaction data the wallet needs from the light wallet server.
//!
//! Mirrors the `tx_retrieval_queue` and `transparent_spend_search_queue` tables of
//! zcash_client_sqlite 0.23 (`wallet/db.rs`) and the rules of `queue_tx_retrieval`,
//! `queue_tx_status`, `delete_retrieval_queue_entries` and `transaction_data_requests`
//! (`wallet.rs`).

use std::collections::BTreeMap;

use zcash_primitives::transaction::TxId;

#[cfg(feature = "transparent-inputs")]
use ::transparent::address::TransparentAddress;

/// The kind of a queued transaction data request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum TxQueryType {
    /// The full transaction data is wanted (enhancement intent).
    Enhancement,
    /// The mined status is wanted. Durable while the transaction is mined, so that it
    /// becomes active again if a rewind un-mines the transaction.
    Status,
}

/// `tx_retrieval_queue`: at most one entry per (txid, query type), with the transaction
/// (if any) whose transparent inputs caused the request.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct TxRetrievalQueue(pub(crate) BTreeMap<(TxId, TxQueryType), Option<TxId>>);

impl TxRetrievalQueue {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// `queue_tx_retrieval` for one txid. `have_raw` says whether the wallet already has
    /// the transaction's data, in which case no request is needed.
    pub(crate) fn queue_enhancement(&mut self, txid: TxId, dependent: Option<TxId>, have_raw: bool) {
        if have_raw {
            return;
        }
        let entry = self
            .0
            .entry((txid, TxQueryType::Enhancement))
            .or_insert(None);
        *entry = dependent.or(*entry);
    }

    /// `queue_tx_status`.
    pub(crate) fn queue_status(&mut self, txid: TxId) {
        self.0.entry((txid, TxQueryType::Status)).or_insert(None);
    }

    pub(crate) fn remove(&mut self, txid: &TxId, query_type: TxQueryType) {
        self.0.remove(&(*txid, query_type));
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = (&TxId, TxQueryType, Option<&TxId>)> {
        self.0
            .iter()
            .map(|((txid, q), dep)| (txid, *q, dep.as_ref()))
    }

    /// `ON DELETE CASCADE` of `dependent_transaction_id`.
    pub(crate) fn remove_dependent_on(&mut self, txid: &TxId) {
        self.0.retain(|_, dep| dep.as_ref() != Some(txid));
    }
}

/// `transparent_spend_search_queue`: transparent outputs of the wallet whose spends must
/// be searched for (e.g. the ephemeral output of a ZIP 320 transaction pair), keyed by the
/// creating transaction and output index.
#[cfg(feature = "transparent-inputs")]
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct TransparentSpendSearchQueue(
    pub(crate) BTreeMap<(TxId, u32), TransparentAddress>,
);

#[cfg(feature = "transparent-inputs")]
impl TransparentSpendSearchQueue {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn queue(&mut self, address: TransparentAddress, txid: TxId, output_index: u32) {
        self.0.insert((txid, output_index), address);
    }

    pub(crate) fn remove(&mut self, txid: &TxId, output_index: u32) {
        self.0.remove(&(*txid, output_index));
    }

    pub(crate) fn remove_tx(&mut self, txid: &TxId) {
        self.0.retain(|(t, _), _| t != txid);
    }
}
