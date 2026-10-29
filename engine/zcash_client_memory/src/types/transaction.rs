//! The wallet's transactions.
//!
//! Mirrors the `transactions` table of zcash_client_sqlite 0.23 (`wallet/db.rs`) and the
//! rules of its `put_tx_meta`, `put_tx_data`, `set_transaction_status`, `update_tx_fee`
//! and `put_zip318_classification` (`wallet.rs`). The wallet-internal transaction
//! reference (`LowLevelWalletRead::TxRef`) is the txid itself.

use std::collections::{BTreeMap, btree_map::Entry};

use time::OffsetDateTime;
use zcash_client_backend::data_api::wallet::TargetHeight;
use zcash_primitives::transaction::{Transaction, TxId, builder::default_tx_expiry_delta};
use zcash_protocol::{
    consensus::{self, BlockHeight, BranchId},
    value::Zatoshis,
    zip318::Zip318Classification,
};

use crate::error::Error;

/// A transaction the wallet tracks.
///
/// Field names and meanings follow the columns of zcash_client_sqlite's `transactions`.
#[derive(Clone, Debug, PartialEq)]
pub struct TransactionEntry {
    pub(crate) txid: TxId,
    /// When this wallet created the transaction, if it did.
    pub(crate) created: Option<OffsetDateTime>,
    /// The height of the mined block containing the transaction, set only once that block
    /// is in the wallet's `blocks` (that is, it has been scanned).
    pub(crate) block: Option<BlockHeight>,
    /// The height at which the transaction was mined, if known. Equal to `block` whenever
    /// `block` is set; may be known without the block having been scanned.
    pub(crate) mined_height: Option<BlockHeight>,
    /// The index of the transaction within its block, if known.
    pub(crate) tx_index: Option<u16>,
    /// The maximum height at which the transaction may be mined, if known (0: no expiry).
    pub(crate) expiry_height: Option<BlockHeight>,
    /// The serialized transaction, if retrieved, with the consensus branch ID it was parsed
    /// with (pre-v5 encodings do not commit to one, so it is stored next to the bytes).
    pub(crate) raw: Option<(Vec<u8>, BranchId)>,
    /// The fee paid, if known.
    pub(crate) fee: Option<Zatoshis>,
    /// The target height of a transaction this wallet built, if it did.
    pub(crate) target_height: Option<TargetHeight>,
    /// The mempool height when the wallet first saw the transaction, or its mined height,
    /// whichever is less.
    pub(crate) min_observed_height: BlockHeight,
    /// The greatest chain tip at which the wallet saw proof that the transaction was not
    /// mined. Always `None` while `mined_height` is set.
    pub(crate) confirmed_unmined_at_height: Option<BlockHeight>,
    /// Whether outputs of this transaction count as trusted for spending.
    pub(crate) trusted: bool,
    /// How the transaction classifies against ZIP 318. `Unknown` until classified, and
    /// never reported as `Nonconforming` unless that was decided.
    pub(crate) zip318: Zip318Classification,
}

impl TransactionEntry {
    fn new(txid: TxId, min_observed_height: BlockHeight) -> Self {
        Self {
            txid,
            created: None,
            block: None,
            mined_height: None,
            tx_index: None,
            expiry_height: None,
            raw: None,
            fee: None,
            target_height: None,
            min_observed_height,
            confirmed_unmined_at_height: None,
            trusted: false,
            zip318: Zip318Classification::Unknown,
        }
    }

    pub fn txid(&self) -> TxId {
        self.txid
    }
    pub fn mined_height(&self) -> Option<BlockHeight> {
        self.mined_height
    }
    pub fn block(&self) -> Option<BlockHeight> {
        self.block
    }
    pub fn tx_index(&self) -> Option<u16> {
        self.tx_index
    }
    pub fn expiry_height(&self) -> Option<BlockHeight> {
        self.expiry_height
    }
    pub fn fee(&self) -> Option<Zatoshis> {
        self.fee
    }
    pub fn created(&self) -> Option<OffsetDateTime> {
        self.created
    }
    pub fn target_height(&self) -> Option<TargetHeight> {
        self.target_height
    }
    pub fn min_observed_height(&self) -> BlockHeight {
        self.min_observed_height
    }
    pub fn confirmed_unmined_at_height(&self) -> Option<BlockHeight> {
        self.confirmed_unmined_at_height
    }
    pub fn is_trusted(&self) -> bool {
        self.trusted
    }
    pub fn zip318_classification(&self) -> Zip318Classification {
        self.zip318
    }
    pub fn raw(&self) -> Option<&[u8]> {
        self.raw.as_ref().map(|(bytes, _)| &bytes[..])
    }

    /// Parses the stored transaction, if its data has been retrieved.
    pub fn parse(&self) -> Result<Option<Transaction>, Error> {
        self.raw
            .as_ref()
            .map(|(bytes, branch_id)| Transaction::read(&bytes[..], *branch_id))
            .transpose()
            .map_err(Error::from)
    }

    /// Whether, for a transaction to be mined at `target_height`, this transaction counts
    /// as mined or as still minable: zcash_client_sqlite's `tx_unexpired_condition`
    /// (`wallet/common.rs`), which decides whether a note it spends is spent.
    ///
    /// - mined below the target height, or
    /// - expiry height 0 (never expires), or
    /// - expiry height at or above the target height, or
    /// - expiry height unknown, and the target height within the default expiry delta of
    ///   the height at which the wallet first observed the transaction (guessing that the
    ///   wallet that created it used the default delta).
    pub fn is_mined_or_unexpired_for<P: consensus::Parameters>(
        &self,
        params: &P,
        target_height: BlockHeight,
    ) -> bool {
        if self.mined_height.is_some_and(|h| h < target_height) {
            return true;
        }
        match self.expiry_height {
            Some(e) if u32::from(e) == 0 => true,
            Some(e) => e >= target_height,
            None => {
                let delta = default_tx_expiry_delta(BranchId::for_height(
                    params,
                    self.min_observed_height,
                ));
                self.min_observed_height + delta >= target_height
            }
        }
    }
}

/// The wallet's transactions, keyed by txid.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TransactionTable(pub(crate) BTreeMap<TxId, TransactionEntry>);

impl TransactionTable {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, txid: &TxId) -> Option<&TransactionEntry> {
        self.0.get(txid)
    }

    /// Test-only: lets a test reproduce sqlite's direct SQL updates of a transaction row.
    #[cfg(test)]
    pub(crate) fn get_mut(&mut self, txid: &TxId) -> Option<&mut TransactionEntry> {
        self.0.get_mut(txid)
    }

    pub fn iter(&self) -> impl Iterator<Item = (&TxId, &TransactionEntry)> {
        self.0.iter()
    }

    pub(crate) fn contains(&self, txid: &TxId) -> bool {
        self.0.contains_key(txid)
    }

    /// `put_tx_meta`: records a transaction observed in a scanned block at `height`.
    ///
    /// `block_known` says whether `height` is in the wallet's `blocks` (it is during
    /// `put_blocks`, which inserts the block first).
    pub(crate) fn put_tx_meta(
        &mut self,
        txid: TxId,
        tx_index: u16,
        height: BlockHeight,
        block_known: bool,
    ) -> TxId {
        let entry = self
            .0
            .entry(txid)
            .or_insert_with(|| TransactionEntry::new(txid, height));
        entry.block = block_known.then_some(height);
        entry.mined_height = Some(height);
        entry.tx_index = Some(tx_index);
        entry.min_observed_height = entry.min_observed_height.min(height);
        entry.confirmed_unmined_at_height = None;
        txid
    }

    /// `put_tx_data`: records the full data of a transaction.
    pub(crate) fn put_tx_data(
        &mut self,
        tx: &Transaction,
        fee: Option<Zatoshis>,
        created_at: Option<OffsetDateTime>,
        target_height: Option<TargetHeight>,
        observed_height: BlockHeight,
    ) -> Result<TxId, Error> {
        let txid = tx.txid();
        let mut raw = vec![];
        tx.write(&mut raw)?;
        let raw = (raw, tx.consensus_branch_id());
        // A coinbase transaction is always at index 0 of its block.
        let coinbase_index = tx
            .transparent_bundle()
            .and_then(|b| b.is_coinbase().then_some(0u16));

        match self.0.entry(txid) {
            Entry::Vacant(e) => {
                let mut entry = TransactionEntry::new(txid, observed_height);
                entry.tx_index = coinbase_index;
                entry.created = created_at;
                entry.expiry_height = Some(tx.expiry_height());
                entry.raw = Some(raw);
                entry.fee = fee;
                entry.target_height = target_height;
                e.insert(entry);
            }
            Entry::Occupied(mut e) => {
                // ON CONFLICT: created and target_height are only set on insert.
                let entry = e.get_mut();
                entry.expiry_height = Some(tx.expiry_height());
                entry.raw = Some(raw);
                entry.fee = fee.or(entry.fee);
                entry.tx_index = entry.tx_index.or(coinbase_index);
                entry.min_observed_height = entry.min_observed_height.min(observed_height);
            }
        }
        Ok(txid)
    }

    /// The transaction row written by `put_transparent_output`: inserted if absent; on
    /// conflict the block is kept if set, a known mined height replaces the stored one (an
    /// unknown one does not erase it: un-mining is truncation's job), the minimum observed
    /// height decreases, and a known mined height clears `confirmed_unmined_at_height`.
    #[cfg(feature = "transparent-inputs")]
    pub(crate) fn upsert_for_transparent_output(
        &mut self,
        txid: TxId,
        mined_height: Option<BlockHeight>,
        block_known: bool,
        observation_height: BlockHeight,
    ) {
        let block = mined_height.filter(|_| block_known);
        let entry = self
            .0
            .entry(txid)
            .or_insert_with(|| TransactionEntry::new(txid, observation_height));
        entry.block = entry.block.or(block);
        entry.mined_height = mined_height.or(entry.mined_height);
        entry.min_observed_height = entry.min_observed_height.min(observation_height);
        if mined_height.is_some() {
            entry.confirmed_unmined_at_height = None;
        }
    }

    /// Records a mined height learned from a status query or a decrypted transaction
    /// (`set_transaction_status(Mined)`). `block_known` as for [`Self::put_tx_meta`].
    pub(crate) fn set_mined(&mut self, txid: &TxId, height: BlockHeight, block_known: bool) {
        if let Some(entry) = self.0.get_mut(txid) {
            entry.min_observed_height = entry
                .min_observed_height
                .min(entry.mined_height.unwrap_or(height))
                .min(height);
            entry.mined_height = Some(height);
            entry.confirmed_unmined_at_height = None;
            if block_known {
                entry.block = Some(height);
            }
        }
    }

    /// Records that the transaction was observed as not mined as of `chain_tip`
    /// (`set_transaction_status(NotInMainChain | TxidNotRecognized)`).
    pub(crate) fn set_unmined_at(&mut self, txid: &TxId, chain_tip: BlockHeight) {
        if let Some(entry) = self.0.get_mut(txid) {
            if entry.mined_height.is_none() {
                entry.confirmed_unmined_at_height = Some(chain_tip);
            }
        }
    }

    /// `update_tx_fee`.
    pub(crate) fn update_fee(&mut self, txid: &TxId, fee: Zatoshis) -> Result<(), Error> {
        self.0
            .get_mut(txid)
            .map(|entry| entry.fee = Some(fee))
            .ok_or(Error::TransactionNotFound(*txid))
    }

    /// `put_zip318_classification`.
    pub(crate) fn put_zip318_classification(
        &mut self,
        txid: &TxId,
        classification: Zip318Classification,
    ) -> Result<(), Error> {
        self.0
            .get_mut(txid)
            .map(|entry| entry.zip318 = classification)
            .ok_or_else(|| {
                Error::CorruptedData(format!(
                    "ZIP 318 classification names transaction {txid}, which does not exist"
                ))
            })
    }

    /// `set_tx_trust`.
    pub(crate) fn set_trusted(&mut self, txid: &TxId, trusted: bool) -> Result<(), Error> {
        self.0
            .get_mut(txid)
            .map(|entry| entry.trusted = trusted)
            .ok_or(Error::TransactionNotFound(*txid))
    }

    /// Un-mines every transaction mined above `height` (chain truncation): their block,
    /// mined height and index are cleared, as zcash_client_sqlite's `truncate_to_height`
    /// does, and the transactions stay in the wallet as unmined.
    pub(crate) fn unmine_above(&mut self, height: BlockHeight) {
        for entry in self.0.values_mut() {
            if entry.mined_height.is_some_and(|h| h > height) {
                entry.block = None;
                entry.mined_height = None;
                entry.tx_index = None;
            }
        }
    }
}
