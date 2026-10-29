//! zcash_client_backend's backend-independent test suite (`data_api::testing`), run over
//! [`MemoryWalletDb`].
//!
//! The [`WalletTest`] accessors follow zcash_client_sqlite 0.23 (`lib.rs` and
//! `wallet::testing`), in particular the `v_transactions` view for [`WalletTest::get_tx_history`],
//! so that the upstream tests check this backend against the same expectations.

use std::collections::BTreeMap;
use std::convert::Infallible;
use std::num::NonZeroU32;

use incrementalmerkletree::{Hashable, Position};
use shardtree::{ShardTree, store::{ShardStore, memory::MemoryShardStore}};
use zcash_client_backend::{
    data_api::{
        InputSource, OutputOfSentTx, WalletRead, WalletTest,
        anchor_retention::AnchorRetentionInterval,
        locking::LockFilter,
        testing::{
            CacheInsertionResult, DataStoreFactory, Reset, TestCache, TestState,
            TransactionSummary,
        },
    },
    proto::compact_formats::CompactBlock,
    wallet::{Note, NoteId, ReceivedNote},
};
use zcash_keys::address::Address;
use zcash_primitives::transaction::TxId;
use zcash_protocol::{
    PoolType, ShieldedPool,
    consensus::{self, BlockHeight},
    local_consensus::LocalNetwork,
    memo::MemoBytes,
    value::{ZatBalance, Zatoshis},
};

#[cfg(feature = "transparent-inputs")]
use {
    ::transparent::{
        address::TransparentAddress,
        bundle::OutPoint,
        keys::{NonHardenedChildIndex, TransparentKeyScope},
    },
    std::ops::Range,
    zcash_client_backend::{
        data_api::wallet::TargetHeight,
        wallet::{Exposure, GapMetadata, TransparentAddressMetadata, WalletTransparentOutput},
    },
    zcash_keys::keys::transparent::gap_limits::GapLimits,
};

use crate::{
    Account, AccountId, Error, MemBlockCache, MemoryWalletDb, PRUNING_DEPTH,
    types::memory_wallet::PoolTree,
};
#[cfg(feature = "transparent-inputs")]
use crate::{transparent_ops::epoch_seconds_to_time, types::address::KeyScope};

#[cfg(all(test, feature = "orchard"))]
mod mainnet_blocks;
#[cfg(all(test, feature = "orchard", feature = "pczt-tests"))]
mod pczt_branch;
#[cfg(test)]
mod pool;
#[cfg(all(test, feature = "orchard"))]
mod spend_maps;
#[cfg(all(test, feature = "transparent-inputs"))]
mod transparent;

/// Creates empty [`MemoryWalletDb`]s for the upstream test framework.
#[derive(Clone, Copy, Debug, Default)]
pub struct TestMemDbFactory;

impl TestMemDbFactory {
    pub fn new() -> Self {
        Self
    }
}

impl DataStoreFactory for TestMemDbFactory {
    type Error = Infallible;
    type AccountId = AccountId;
    type Account = Account;
    type DsError = Error;
    type DataStore = MemoryWalletDb<LocalNetwork>;

    fn new_data_store(
        &self,
        network: LocalNetwork,
        anchor_retention_interval: Option<AnchorRetentionInterval>,
        #[cfg(feature = "transparent-inputs")] gap_limits: Option<GapLimits>,
    ) -> Result<Self::DataStore, Self::Error> {
        let mut db = MemoryWalletDb::new(network, PRUNING_DEPTH as usize);
        if let Some(interval) = anchor_retention_interval {
            db = db.with_anchor_retention_interval(interval);
        }
        #[cfg(feature = "transparent-inputs")]
        if let Some(gap_limits) = gap_limits {
            db = db.with_gap_limits(gap_limits);
        }
        Ok(db)
    }
}

/// The txids of a block inserted into a [`MemBlockCache`].
#[derive(Debug)]
pub struct MemBlockCacheInsertionResult {
    txids: Vec<TxId>,
}

impl CacheInsertionResult for MemBlockCacheInsertionResult {
    fn txids(&self) -> &[TxId] {
        &self.txids[..]
    }
}

impl TestCache for MemBlockCache {
    type BsError = Infallible;
    type BlockSource = MemBlockCache;
    type InsertResult = MemBlockCacheInsertionResult;

    fn block_source(&self) -> &Self::BlockSource {
        self
    }

    fn insert(&mut self, cb: &CompactBlock) -> Self::InsertResult {
        let txids = cb.vtx.iter().map(|tx| tx.txid()).collect();
        self.0
            .write()
            .expect("block cache lock is not poisoned")
            .insert(cb.height(), cb.clone());
        MemBlockCacheInsertionResult { txids }
    }

    fn truncate_to_height(&mut self, height: BlockHeight) {
        self.0
            .write()
            .expect("block cache lock is not poisoned")
            .retain(|k, _| *k <= height);
    }
}

impl Reset for MemoryWalletDb<LocalNetwork> {
    /// The replaced wallet.
    type Handle = MemoryWalletDb<LocalNetwork>;

    fn reset<C>(st: &mut TestState<C, Self, LocalNetwork>) -> Self::Handle {
        let old = st.wallet();
        let mut new_wallet = MemoryWalletDb::new(old.params, old.max_checkpoints)
            .with_anchor_retention_interval(old.anchor_retention_interval);
        #[cfg(feature = "transparent-inputs")]
        {
            new_wallet = new_wallet.with_gap_limits(old.gap_limits);
        }
        std::mem::replace(st.wallet_mut(), new_wallet)
    }
}

/// Every checkpoint of a note commitment tree, in height order (sqlite
/// `{pool}_tree_checkpoints`, which holds the retained checkpoints too).
fn checkpoint_history<H, const DEPTH: u8, const SHARD_HEIGHT: u8>(
    pool: &PoolTree<ShardTree<MemoryShardStore<H, BlockHeight>, DEPTH, SHARD_HEIGHT>, H>,
) -> Vec<(BlockHeight, Option<Position>)>
where
    H: Hashable + Clone + PartialEq,
{
    let mut out = vec![];
    pool.tree
        .store()
        .for_each_checkpoint(usize::MAX, |id, checkpoint| {
            out.push((*id, checkpoint.position()));
            Ok(())
        })
        .expect("the in-memory shard store is infallible");
    out.sort_by_key(|(id, _)| *id);
    out
}

/// One row of the `notes` CTE of sqlite's `v_transactions`: an output the account received in
/// the transaction, or one of its outputs that the transaction spent.
struct NoteRow {
    pool: PoolType,
    received_value: u64,
    spent_value: u64,
    is_spend: bool,
    is_change: bool,
    memo_present: bool,
}

impl NoteRow {
    fn does_not_match_shielding(&self) -> bool {
        // The wallet cannot receive transparent outputs, or spend shielded outputs, in a
        // shielding transaction.
        (self.pool == PoolType::TRANSPARENT) != self.is_spend
    }
}

fn memo_present(memo: Option<&MemoBytes>) -> bool {
    memo.is_some_and(|m| *m != MemoBytes::empty())
}

/// Per (sending account, transaction): sqlite's `sent_note_counts` CTE.
#[derive(Default)]
struct SentCounts {
    sent_notes: usize,
    memo_count: usize,
}

impl<P: consensus::Parameters> MemoryWalletDb<P> {
    /// Whether the wallet received the output a sent-output row describes, and if so whether
    /// it was received as change (sqlite `v_received_outputs.sent_note_id`).
    fn received_output_of_sent(&self, txid: &TxId, pool: PoolType, index: u32) -> Option<bool> {
        match pool {
            PoolType::Shielded(p) => {
                let index = u16::try_from(index).ok()?;
                self.received_notes
                    .get(&NoteId::new(*txid, p, index))
                    .map(|rn| rn.is_change())
            }
            PoolType::Transparent => {
                #[cfg(feature = "transparent-inputs")]
                {
                    self.transparent
                        .get(&OutPoint::new(txid.as_ref().to_owned(), index))
                        .map(|_| false)
                }
                #[cfg(not(feature = "transparent-inputs"))]
                {
                    let _ = index;
                    self.transparent
                        .iter()
                        .find(|o| o.outpoint().txid() == txid && o.outpoint().n() == index)
                        .map(|_| false)
                }
            }
        }
    }

    /// The rows of sqlite's `notes` CTE, keyed by (account, transaction).
    fn history_note_rows(&self) -> BTreeMap<(AccountId, TxId), Vec<NoteRow>> {
        let mut rows: BTreeMap<(AccountId, TxId), Vec<NoteRow>> = BTreeMap::new();
        for rn in self.received_notes.iter() {
            let pool = PoolType::Shielded(rn.pool());
            let value = rn.note().value().into_u64();
            rows.entry((rn.account_id(), rn.txid())).or_default().push(NoteRow {
                pool,
                received_value: value,
                spent_value: 0,
                is_spend: false,
                is_change: rn.is_change(),
                memo_present: memo_present(rn.memo()),
            });
            for spender in self.received_notes.spends_of(&rn.note_id()) {
                rows.entry((rn.account_id(), *spender)).or_default().push(NoteRow {
                    pool,
                    received_value: 0,
                    spent_value: value,
                    is_spend: true,
                    is_change: false,
                    memo_present: false,
                });
            }
        }
        for o in self.transparent.iter() {
            let value = o.txout().value().into_u64();
            rows.entry((o.account_id(), *o.outpoint().txid()))
                .or_default()
                .push(NoteRow {
                    pool: PoolType::TRANSPARENT,
                    received_value: value,
                    spent_value: 0,
                    is_spend: false,
                    is_change: false,
                    memo_present: false,
                });
            for spender in self.transparent.spends_of(o.outpoint()) {
                rows.entry((o.account_id(), *spender)).or_default().push(NoteRow {
                    pool: PoolType::TRANSPARENT,
                    received_value: 0,
                    spent_value: value,
                    is_spend: true,
                    is_change: false,
                    memo_present: false,
                });
            }
        }
        // `JOIN transactions`: only transactions the wallet stores.
        rows.retain(|(_, txid), _| self.tx_table.contains(txid));
        rows
    }

    /// sqlite's `sent_note_counts` CTE: the outputs the account sent in each transaction that
    /// the wallet did not receive as change, and how many of those carry a memo the wallet did
    /// not also receive.
    fn history_sent_counts(&self) -> BTreeMap<(AccountId, TxId), SentCounts> {
        let mut counts: BTreeMap<(AccountId, TxId), SentCounts> = BTreeMap::new();
        for (id, sent) in self.sent_notes.iter() {
            let received = self.received_output_of_sent(id.txid(), id.pool(), id.output_index());
            if received == Some(true) {
                continue;
            }
            let entry = counts.entry((sent.from_account_id(), *id.txid())).or_default();
            entry.sent_notes += 1;
            if received.is_none() && memo_present(sent.memo()) {
                entry.memo_count += 1;
            }
        }
        counts
    }
}

impl<P: consensus::Parameters> WalletTest for MemoryWalletDb<P> {
    /// sqlite `v_transactions`, ordered by `mined_height DESC, tx_index DESC` (unmined last).
    /// Ties (unmined transactions) are ordered by account, then txid; sqlite leaves their
    /// order unspecified.
    fn get_tx_history(&self) -> Result<Vec<TransactionSummary<AccountId>>, Error> {
        let sent_counts = self.history_sent_counts();
        let max_block_height = self.max_scanned_height();
        let mut out = vec![];
        for ((account, txid), rows) in self.history_note_rows() {
            let tx = self
                .tx_table
                .get(&txid)
                .expect("history rows are restricted to stored transactions");
            let sent = sent_counts.get(&(account, txid));
            let sent_notes = sent.map_or(0, |s| s.sent_notes);

            let mut delta: i64 = 0;
            let mut total_spent: u64 = 0;
            let mut total_received: u64 = 0;
            let mut spent_note_count = 0usize;
            let mut change_note_count = 0usize;
            let mut received_note_count = 0usize;
            let mut memo_count = sent.map_or(0, |s| s.memo_count);
            let mut mismatches_shielding = false;
            // notes_by_pool: (spent notes, received notes incl. change, received value)
            let mut by_pool: BTreeMap<u8, (usize, usize, u64)> = BTreeMap::new();
            for row in &rows {
                let pool_key = match row.pool {
                    PoolType::Transparent => 0,
                    PoolType::Shielded(ShieldedPool::Sapling) => 2,
                    PoolType::Shielded(ShieldedPool::Orchard) => 3,
                    PoolType::Shielded(ShieldedPool::Ironwood) => 4,
                };
                let per_pool = by_pool.entry(pool_key).or_default();
                mismatches_shielding |= row.does_not_match_shielding();
                if row.is_spend {
                    delta -= i64::try_from(row.spent_value).map_err(|_| Error::Other("value overflow".into()))?;
                    total_spent += row.spent_value;
                    spent_note_count += 1;
                    per_pool.0 += 1;
                } else {
                    delta += i64::try_from(row.received_value).map_err(|_| Error::Other("value overflow".into()))?;
                    total_received += row.received_value;
                    if row.is_change {
                        change_note_count += 1;
                    } else {
                        received_note_count += 1;
                    }
                    if row.memo_present {
                        memo_count += 1;
                    }
                    per_pool.1 += 1;
                    per_pool.2 += row.received_value;
                }
            }

            let is_shielding = !mismatches_shielding
                && spent_note_count > 0
                && (received_note_count + change_note_count) > 0
                && sent_notes == 0;

            // pool_crossings
            let transparent_involved = by_pool.get(&0).is_some_and(|(s, r, _)| s + r > 0);
            let received_where_nothing_spent: usize = by_pool
                .values()
                .filter(|(s, _, _)| *s == 0)
                .map(|(_, r, _)| *r)
                .sum();
            let pool_crossing_value = if !transparent_involved
                && spent_note_count > 0
                && received_where_nothing_spent > 0
                && sent_notes == 0
            {
                let v: u64 = by_pool
                    .values()
                    .filter(|(s, _, _)| *s == 0)
                    .map(|(_, _, v)| *v)
                    .sum();
                Some(Zatoshis::from_u64(v).map_err(|_| Error::Other("value overflow".into()))?)
            } else {
                None
            };

            let expired_unmined = tx.mined_height().is_none()
                && match (tx.expiry_height(), max_block_height) {
                    (Some(expiry), Some(max)) => u32::from(expiry) >= 1 && expiry <= max,
                    _ => false,
                };

            out.push((
                tx.mined_height(),
                tx.tx_index(),
                TransactionSummary::from_parts(
                    account,
                    txid,
                    tx.expiry_height(),
                    tx.mined_height(),
                    ZatBalance::from_i64(delta).map_err(|_| Error::Other("value overflow".into()))?,
                    Zatoshis::from_u64(total_spent).map_err(|_| Error::Other("value overflow".into()))?,
                    Zatoshis::from_u64(total_received)
                        .map_err(|_| Error::Other("value overflow".into()))?,
                    tx.fee(),
                    spent_note_count,
                    change_note_count > 0,
                    sent_notes,
                    received_note_count,
                    memo_count,
                    expired_unmined,
                    is_shielding,
                    pool_crossing_value,
                ),
            ));
        }
        // `ORDER BY mined_height DESC, tx_index DESC`: SQLite sorts NULLs first ascending,
        // so last when descending; `Option`'s ordering puts `None` first, so reversing the
        // comparison gives the same order. The sort is stable, keeping (account, txid) order
        // among ties.
        out.sort_by(|a, b| (b.0, b.1).cmp(&(a.0, a.1)));
        Ok(out.into_iter().map(|(_, _, s)| s).collect())
    }

    fn get_sent_note_ids(&self, txid: &TxId, protocol: ShieldedPool) -> Result<Vec<NoteId>, Error> {
        self.sent_notes
            .of_tx(txid)
            .filter(|(id, _)| id.pool() == PoolType::Shielded(protocol))
            .map(|(id, _)| {
                let index = u16::try_from(id.output_index())
                    .map_err(|_| Error::CorruptedData("output index out of range".into()))?;
                Ok(NoteId::new(*txid, protocol, index))
            })
            .collect()
    }

    /// sqlite: every sent output of the transaction, joined with each transparent output the
    /// wallet received in it (with the address's derivation index when that address is
    /// ephemeral), ordered by value.
    fn get_sent_outputs(&self, txid: &TxId) -> Result<Vec<OutputOfSentTx>, Error> {
        if !self.tx_table.contains(txid) {
            return Ok(vec![]);
        }
        #[cfg(feature = "transparent-inputs")]
        let ephemeral_joins: Vec<Option<(Address, NonHardenedChildIndex)>> = {
            let joins: Vec<_> = self
                .transparent
                .iter()
                .filter(|o| o.outpoint().txid() == txid)
                .map(|o| {
                    self.addresses
                        .get(o.address_id)
                        .filter(|a| a.key_scope == KeyScope::Ephemeral)
                        .and_then(|a| {
                            a.transparent_child_index
                                .map(|i| (Address::from(*o.address()), i))
                        })
                })
                .collect();
            if joins.is_empty() { vec![None] } else { joins }
        };

        let mut out = vec![];
        for (_, sent) in self.sent_notes.of_tx(txid) {
            let external_recipient = sent
                .to_address()
                .map(|s| {
                    Address::decode(&self.params, s).ok_or_else(|| {
                        Error::CorruptedData(format!("invalid recipient address: {s}"))
                    })
                })
                .transpose()?;
            #[cfg(feature = "transparent-inputs")]
            for ephemeral in &ephemeral_joins {
                out.push(OutputOfSentTx::from_parts(
                    sent.value(),
                    external_recipient.clone(),
                    ephemeral.clone(),
                ));
            }
            #[cfg(not(feature = "transparent-inputs"))]
            out.push(OutputOfSentTx::from_parts(sent.value(), external_recipient));
        }
        out.sort_by_key(|o| o.value());
        Ok(out)
    }

    fn get_checkpoint_history(
        &self,
        protocol: &ShieldedPool,
    ) -> Result<Vec<(BlockHeight, Option<Position>)>, Error> {
        Ok(match protocol {
            ShieldedPool::Sapling => checkpoint_history(&self.sapling),
            #[cfg(feature = "orchard")]
            ShieldedPool::Orchard => checkpoint_history(&self.orchard),
            #[cfg(feature = "orchard")]
            ShieldedPool::Ironwood => checkpoint_history(&self.ironwood),
            #[cfg(not(feature = "orchard"))]
            _ => vec![],
        })
    }

    /// sqlite `get_wallet_transparent_output`.
    #[cfg(feature = "transparent-inputs")]
    fn get_transparent_output(
        &self,
        outpoint: &OutPoint,
        spendable_as_of: Option<TargetHeight>,
    ) -> Result<Option<WalletTransparentOutput<AccountId>>, Error> {
        let Some(o) = self.transparent.get(outpoint) else {
            return Ok(None);
        };
        let Some(tx) = self.tx_table.get(outpoint.txid()) else {
            return Ok(None);
        };
        if self.addresses.get(o.address_id).is_none() {
            return Ok(None);
        }
        if let Some(target) = spendable_as_of {
            let target = BlockHeight::from(target);
            if !tx.is_mined_or_unexpired_for(&self.params, target)
                || self.is_utxo_spent(outpoint, target)
                || !self.ephemeral_output_eligible(o)?
            {
                return Ok(None);
            }
        }
        self.to_wallet_transparent_output(o).map(Some)
    }

    /// sqlite: the account's notes in a scanned block, with key scope, nullifier and
    /// position. sqlite unwraps `get_spendable_note` for each; notes it does not return
    /// (spent ones) are skipped here instead.
    fn get_notes(&self, protocol: ShieldedPool) -> Result<Vec<ReceivedNote<NoteId, Note>>, Error> {
        let (target_height, _) = self
            .get_target_and_anchor_heights(NonZeroU32::MIN)?
            .ok_or(Error::ChainHeightUnknown)?;
        let mut out = vec![];
        for rn in self.received_notes.iter() {
            if rn.pool() != protocol {
                continue;
            }
            let Some(tx) = self.tx_table.get(&rn.txid()) else {
                continue;
            };
            if tx.block().is_none()
                || rn.recipient_key_scope().is_none()
                || rn.nullifier().is_none()
                || rn.commitment_tree_position().is_none()
            {
                continue;
            }
            if let Some(note) = self.get_spendable_note(
                &rn.txid(),
                protocol,
                u32::from(rn.output_index()),
                target_height,
                LockFilter::Unfiltered,
            )? {
                out.push(note);
            }
        }
        Ok(out)
    }

    /// sqlite `get_known_ephemeral_addresses`.
    #[cfg(feature = "transparent-inputs")]
    fn get_known_ephemeral_addresses(
        &self,
        account: AccountId,
        index_range: Option<Range<NonHardenedChildIndex>>,
    ) -> Result<Vec<(TransparentAddress, TransparentAddressMetadata)>, Error> {
        if self.accounts.get(account).is_none() {
            return Err(Error::AccountUnknown(account));
        }
        let gap_limit = self.gap_limits.ephemeral();
        let gap_start = self.gap_start(account, KeyScope::Ephemeral, gap_limit);
        let start = index_range
            .as_ref()
            .map_or(NonHardenedChildIndex::ZERO, |r| r.start);
        let end = index_range
            .as_ref()
            .map_or(NonHardenedChildIndex::MAX, |r| r.end);
        let mut out = vec![];
        for (_, row) in self.addresses.for_account(account) {
            if row.key_scope != KeyScope::Ephemeral {
                continue;
            }
            let (Some(index), Some(taddr)) = (row.transparent_child_index, row.transparent_receiver)
            else {
                continue;
            };
            if index < start || index >= end {
                continue;
            }
            let exposure = row.exposed_at_height.map_or(Exposure::Unknown, |at_height| {
                Exposure::Exposed {
                    at_height,
                    gap_metadata: gap_start.map_or(GapMetadata::DerivationUnknown, |gap_start| {
                        match index.index().checked_sub(gap_start.index()) {
                            Some(gap_position) => GapMetadata::InGap {
                                gap_position,
                                gap_limit,
                            },
                            None => GapMetadata::GapRecoverable { gap_limit },
                        }
                    }),
                }
            });
            out.push((
                index,
                taddr,
                TransparentAddressMetadata::derived(
                    TransparentKeyScope::EPHEMERAL,
                    index,
                    exposure,
                    row.next_check_time.map(epoch_seconds_to_time),
                ),
            ));
        }
        out.sort_by_key(|(index, _, _)| *index);
        Ok(out.into_iter().map(|(_, a, m)| (a, m)).collect())
    }

    /// sqlite `find_account_for_ephemeral_address_str`.
    #[cfg(feature = "transparent-inputs")]
    fn find_account_for_ephemeral_address(
        &self,
        address: &TransparentAddress,
    ) -> Result<Option<AccountId>, Error> {
        Ok(self
            .addresses
            .find_by_transparent_receiver(address)
            .filter(|(_, a)| a.key_scope == KeyScope::Ephemeral)
            .map(|(_, a)| a.account_id))
    }

    /// At the end of every upstream test, the wallet must survive a save and load unchanged.
    fn finally(&self) {
        let mut bytes = vec![];
        self.encode(&mut bytes).expect("the wallet encodes");
        let decoded = MemoryWalletDb::decode_new(&bytes, self.params.clone(), self.max_checkpoints)
            .expect("the encoded wallet decodes");
        let mut again = vec![];
        decoded.encode(&mut again).expect("the decoded wallet encodes");
        assert!(bytes == again, "the wallet changed across a save and load");
    }
}
