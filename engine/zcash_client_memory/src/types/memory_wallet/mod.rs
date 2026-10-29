//! The in-memory wallet database.
//!
//! The data model follows the tables of zcash_client_sqlite 0.23 (see each type's module
//! for the table it mirrors), because zcash_client_backend 0.25's low-level traits
//! (`data_api::ll`) are shaped around those tables and their upsert rules. Upstream logic
//! (`data_api::ll::wallet::{put_blocks, store_decrypted_tx, ..}`) drives every write; this
//! module only stores rows.

use std::collections::BTreeMap;
use std::sync::Arc;

use shardtree::{ShardTree, store::memory::MemoryShardStore};
use zcash_client_backend::data_api::{
    AccountBirthday, AccountSource, SAPLING_SHARD_HEIGHT,
    anchor_retention::AnchorRetentionInterval,
};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::{
    ShieldedPool,
    consensus::{self, BlockHeight},
};

#[cfg(feature = "orchard")]
use zcash_client_backend::data_api::ORCHARD_SHARD_HEIGHT;

#[cfg(feature = "transparent-inputs")]
use zcash_keys::keys::transparent::gap_limits::GapLimits;

use crate::error::Error;
use crate::types::{
    address::AddressTable,
    data_requests::TxRetrievalQueue,
    locks::OutputLocks,
    nullifier::SpendMaps,
    scanning::ScanQueue,
    transparent::TransparentOutputs,
    *,
};

#[cfg(feature = "transparent-inputs")]
use crate::types::data_requests::TransparentSpendSearchQueue;

/// The Sapling note commitment tree.
pub(crate) type SaplingTree = ShardTree<
    MemoryShardStore<sapling::Node, BlockHeight>,
    { sapling::NOTE_COMMITMENT_TREE_DEPTH },
    SAPLING_SHARD_HEIGHT,
>;

/// The Orchard note commitment tree; the Ironwood tree has the same shape.
#[cfg(feature = "orchard")]
pub(crate) type OrchardTree = ShardTree<
    MemoryShardStore<orchard::tree::MerkleHashOrchard, BlockHeight>,
    { ORCHARD_SHARD_HEIGHT * 2 },
    ORCHARD_SHARD_HEIGHT,
>;

/// A completed subtree of a note commitment tree, as reported by the light wallet server
/// (`GetSubtreeRoots`): its root and the height of the block that completed it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SubtreeInfo<H> {
    pub(crate) root: H,
    pub(crate) end_height: BlockHeight,
}

/// The note commitment tree of one pool, with the subtree roots the server reported.
#[derive(Debug)]
pub(crate) struct PoolTree<T, H> {
    pub(crate) tree: T,
    /// `{pool}_tree_shards.(subtree_end_height, root_hash)`, keyed by shard index.
    pub(crate) subtrees: BTreeMap<u64, SubtreeInfo<H>>,
}

impl<T, H> PoolTree<T, H> {
    pub(crate) fn new(tree: T) -> Self {
        Self {
            tree,
            subtrees: BTreeMap::new(),
        }
    }

    /// The height of the block that completed the subtree with the given index, if known.
    pub(crate) fn subtree_end_height(&self, index: u64) -> Option<BlockHeight> {
        self.subtrees.get(&index).map(|s| s.end_height)
    }
}

/// What the scan queue holds for scanning ([`MemoryWalletDb::scan_queue_size`]).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ScanQueueSize {
    /// Blocks still to scan: the lengths of the ranges `WalletRead::suggest_scan_ranges`
    /// returns, summed, up to `chain_tip` (no range ends above it: the chain tip is the end of
    /// the highest queued range).
    pub unscanned_blocks: u32,
    /// The wallet's view of the chain tip (`WalletRead::chain_height`), which bounds
    /// `unscanned_blocks`: the tip the last `update_chain_tip` set; for an account no sync has
    /// reached yet, its birthday - 1 (the end of the ignored range below it). `None` while no
    /// range is queued (no account).
    pub chain_tip: Option<BlockHeight>,
}

/// Told [`ScanQueueSize`] after every write that may change the scan queue
/// ([`MemoryWalletDb::set_scan_queue_observer`]).
pub type ScanQueueObserver = Arc<dyn Fn(ScanQueueSize) + Send + Sync>;

/// The wallet's [`ScanQueueObserver`], if any. Not wallet data: neither encoded nor copied
/// into a decoded wallet.
#[derive(Clone, Default)]
pub(crate) struct ObserverSlot(pub(crate) Option<ScanQueueObserver>);

impl std::fmt::Debug for ObserverSlot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(if self.0.is_some() { "ScanQueueObserver(set)" } else { "ScanQueueObserver(none)" })
    }
}

/// The main in-memory wallet database. Implements all the traits needed to be used as a
/// zcash_client_backend wallet backend.
#[derive(Debug)]
pub struct MemoryWalletDb<P: consensus::Parameters> {
    /// Zcash network parameters.
    pub(crate) params: P,
    /// The maximum number of checkpoints each note commitment tree keeps.
    pub(crate) max_checkpoints: usize,
    /// `accounts`.
    pub(crate) accounts: Accounts,
    /// `addresses`.
    pub(crate) addresses: AddressTable,
    /// `blocks`: scanned block metadata.
    pub(crate) blocks: BTreeMap<BlockHeight, MemoryWalletBlock>,
    /// `transactions`.
    pub(crate) tx_table: TransactionTable,
    /// `{sapling,orchard,ironwood}_received_notes` and `_received_note_spends`.
    pub(crate) received_notes: ReceivedNoteTable,
    /// `sent_notes`.
    pub(crate) sent_notes: SentNoteTable,
    /// `tx_locator_map`, `nullifier_map`, `transparent_spend_locator_map`.
    pub(crate) spend_maps: SpendMaps,
    /// `transparent_received_outputs`, `_output_spends`, `transparent_spend_map`.
    pub(crate) transparent: TransparentOutputs,
    /// `tx_retrieval_queue`.
    pub(crate) tx_retrieval_queue: TxRetrievalQueue,
    /// `transparent_spend_search_queue`.
    #[cfg(feature = "transparent-inputs")]
    pub(crate) transparent_spend_search_queue: TransparentSpendSearchQueue,
    /// `scan_queue`.
    pub(crate) scan_queue: ScanQueue,
    /// The `lock_expiry_height` / `lock_owner` columns of the received-output tables.
    pub(crate) output_locks: OutputLocks,
    /// Sapling note commitment tree.
    pub(crate) sapling: PoolTree<SaplingTree, sapling::Node>,
    /// Orchard note commitment tree.
    #[cfg(feature = "orchard")]
    pub(crate) orchard: PoolTree<OrchardTree, orchard::tree::MerkleHashOrchard>,
    /// Ironwood (NU6.3) note commitment tree: Orchard-shaped, separate from Orchard's.
    #[cfg(feature = "orchard")]
    pub(crate) ironwood: PoolTree<OrchardTree, orchard::tree::MerkleHashOrchard>,
    /// Transparent address gap limits.
    #[cfg(feature = "transparent-inputs")]
    pub(crate) gap_limits: GapLimits,
    /// The grid of anchor checkpoints retained from NU6.3 activation (ZIP 318).
    pub(crate) anchor_retention_interval: AnchorRetentionInterval,
    /// Told the scan queue's size after each write ([`Self::set_scan_queue_observer`]).
    pub(crate) scan_queue_observer: ObserverSlot,
}

impl<P: consensus::Parameters> MemoryWalletDb<P> {
    /// Creates an empty wallet. `max_checkpoints` bounds the number of (non-retained)
    /// checkpoints each note commitment tree keeps; use at least the pruning depth (100).
    pub fn new(params: P, max_checkpoints: usize) -> Self {
        Self {
            params,
            max_checkpoints,
            accounts: Accounts::new(),
            addresses: AddressTable::new(),
            blocks: BTreeMap::new(),
            tx_table: TransactionTable::new(),
            received_notes: ReceivedNoteTable::new(),
            sent_notes: SentNoteTable::new(),
            spend_maps: SpendMaps::new(),
            transparent: TransparentOutputs::new(),
            tx_retrieval_queue: TxRetrievalQueue::new(),
            #[cfg(feature = "transparent-inputs")]
            transparent_spend_search_queue: TransparentSpendSearchQueue::new(),
            scan_queue: ScanQueue::new(),
            output_locks: OutputLocks::new(),
            sapling: PoolTree::new(ShardTree::new(MemoryShardStore::empty(), max_checkpoints)),
            #[cfg(feature = "orchard")]
            orchard: PoolTree::new(ShardTree::new(MemoryShardStore::empty(), max_checkpoints)),
            #[cfg(feature = "orchard")]
            ironwood: PoolTree::new(ShardTree::new(MemoryShardStore::empty(), max_checkpoints)),
            #[cfg(feature = "transparent-inputs")]
            gap_limits: GapLimits::default(),
            anchor_retention_interval: AnchorRetentionInterval::ZIP_318,
            scan_queue_observer: ObserverSlot::default(),
        }
    }

    /// Sets the interval of the anchor checkpoints the note commitment trees retain from
    /// NU6.3 activation. The default is the ZIP 318 interval; a wallet should only change it
    /// before its first scan, since checkpoints already pruned cannot be recovered.
    pub fn with_anchor_retention_interval(mut self, interval: AnchorRetentionInterval) -> Self {
        self.anchor_retention_interval = interval;
        self
    }

    /// Sets the transparent address gap limits. These are not persisted by
    /// [`Self::encode`]; a decoded wallet uses the defaults.
    #[cfg(feature = "transparent-inputs")]
    pub fn with_gap_limits(mut self, gap_limits: GapLimits) -> Self {
        self.gap_limits = gap_limits;
        self
    }

    pub fn params(&self) -> &P {
        &self.params
    }

    /// What the scan queue holds for scanning, up to the wallet's chain tip: what
    /// `WalletRead::suggest_scan_ranges` would hand to a sync pass, in blocks.
    pub fn scan_queue_size(&self) -> ScanQueueSize {
        let chain_tip = self.chain_tip_height();
        ScanQueueSize {
            unscanned_blocks: chain_tip.map_or(0, |tip| self.scan_queue.unscanned_blocks(tip)),
            chain_tip,
        }
    }

    /// Has `observer` told [`Self::scan_queue_size`] now, and again after every write that
    /// may change the scan queue: each write that runs through `transactionally` (among them
    /// `update_chain_tip`, the `put_blocks` of every batch a sync pass scans, truncations and
    /// account imports), whether it succeeds or is rolled back, `rewind_to_chain_state`,
    /// `queue_rescan` and `prune_scan_queue_below`.
    ///
    /// A sync pass (`zcash_client_backend::sync::run`) holds the wallet for its whole length,
    /// behind whatever lock its caller keeps it in; the observer lets a reader follow what is
    /// left to scan at every batch boundary without that lock (Celari's progress counters).
    /// It runs while the wallet is borrowed mutably: it must not block or reach the wallet.
    /// Not persisted: a decoded wallet has none. `None` removes it.
    pub fn set_scan_queue_observer(&mut self, observer: Option<ScanQueueObserver>) {
        self.scan_queue_observer = ObserverSlot(observer);
        self.publish_scan_queue();
    }

    /// Tells the observer (if any) the scan queue's size.
    pub(crate) fn publish_scan_queue(&self) {
        if let Some(observer) = &self.scan_queue_observer.0 {
            observer(self.scan_queue_size());
        }
    }

    /// The wallet's view of the chain tip: the end of the highest scan range, minus one
    /// (zcash_client_sqlite `chain_tip_height`).
    pub(crate) fn chain_tip_height(&self) -> Option<BlockHeight> {
        self.scan_queue.iter().map(|(_, end, _)| *end).max().map(|end| end - 1)
    }

    /// Whether the block at `height` has been scanned.
    pub(crate) fn block_known(&self, height: BlockHeight) -> bool {
        self.blocks.contains_key(&height)
    }

    /// The highest scanned block.
    pub(crate) fn max_scanned_height(&self) -> Option<BlockHeight> {
        self.blocks.keys().next_back().copied()
    }

    /// Records a new account row (zcash_client_sqlite `add_account`, the `INSERT INTO
    /// accounts` part). The rest of sqlite's `add_account` (rewind to the birthday's prior
    /// chain state, the ignored range below the birthday, addresses) is in
    /// `MemoryWalletDb::add_account_full` (`wallet_write.rs`).
    pub(crate) fn add_account_row(
        &mut self,
        account_name: &str,
        kind: AccountSource,
        viewing_key: UnifiedFullViewingKey,
        birthday: AccountBirthday,
    ) -> Result<(AccountId, Account), Error> {
        self.accounts
            .new_account(account_name, kind, viewing_key, birthday)
    }

    // ---- public read-only views (transaction history in webzjs-wallet) ----

    /// The received notes of every pool.
    pub fn received_notes(&self) -> &ReceivedNoteTable {
        &self.received_notes
    }

    /// The sent outputs of every pool.
    pub fn sent_notes(&self) -> &SentNoteTable {
        &self.sent_notes
    }

    /// The wallet's transactions.
    pub fn tx_table(&self) -> &TransactionTable {
        &self.tx_table
    }

    /// The transparent outputs received by the wallet, with their spends.
    pub fn transparent_outputs(&self) -> &TransparentOutputs {
        &self.transparent
    }

    /// The time of the block at `height`, if the block has been scanned.
    pub fn get_block_time(&self, height: BlockHeight) -> Option<u32> {
        self.blocks.get(&height).map(|block| block.block_time)
    }

    /// The pools this build tracks.
    pub(crate) fn shielded_pools() -> &'static [ShieldedPool] {
        #[cfg(feature = "orchard")]
        {
            &[
                ShieldedPool::Sapling,
                ShieldedPool::Orchard,
                ShieldedPool::Ironwood,
            ]
        }
        #[cfg(not(feature = "orchard"))]
        {
            &[ShieldedPool::Sapling]
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use secrecy::SecretVec;
    use zcash_client_backend::data_api::{AccountBirthday, WalletRead, WalletWrite, chain::ChainState};
    use zcash_primitives::block::BlockHash;
    use zcash_protocol::consensus::{BlockHeight, Network};

    use super::{MemoryWalletDb, ScanQueueSize};

    /// The scan queue observer is told the queue's size when it is set and after the writes
    /// that change the queue (an account import, a chain tip update, a rescan, a prune), and
    /// the size is the one `suggest_scan_ranges` describes; a decoded copy of the wallet has
    /// no observer.
    #[test]
    fn scan_queue_observer_follows_the_writes() {
        let h = BlockHeight::from_u32;
        let mut db = MemoryWalletDb::new(Network::MainNetwork, 100);
        let seen = Arc::new(Mutex::new(vec![]));
        let s = seen.clone();
        db.set_scan_queue_observer(Some(Arc::new(move |q| s.lock().unwrap().push(q))));
        let birthday = AccountBirthday::from_parts(ChainState::empty(h(2_999_999), BlockHash([0; 32])), None);
        db.create_account("a", &SecretVec::new(vec![7; 32]), &birthday, None).unwrap();
        let after_import = *seen.lock().unwrap().last().unwrap();
        db.update_chain_tip(h(3_000_099)).unwrap();
        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen[0], ScanQueueSize { unscanned_blocks: 0, chain_tip: None }, "{seen:?}");
        // Only the ignored range below the birthday: the tip is the birthday - 1.
        assert_eq!(after_import, ScanQueueSize { unscanned_blocks: 0, chain_tip: Some(h(2_999_999)) }, "{seen:?}");
        let last = *seen.last().unwrap();
        assert_eq!(last, ScanQueueSize { unscanned_blocks: 100, chain_tip: Some(h(3_000_099)) }, "{seen:?}");
        assert_eq!(db.scan_queue_size(), last);
        let suggested: usize = db.suggest_scan_ranges().unwrap().iter().map(|r| r.len()).sum();
        assert_eq!(suggested, 100);

        // queue_rescan and prune_scan_queue_below change the queue outside `transactionally`:
        // the observer hears of both. A rescan of 50 blocks of the ignored range below the
        // birthday queues them (150 left); pruning below 3_000_050 ignores 3_000_000..3_000_050
        // again, among them, as no range is retained (50 left).
        let seen = Arc::new(Mutex::new(vec![]));
        let s = seen.clone();
        db.set_scan_queue_observer(Some(Arc::new(move |q| s.lock().unwrap().push(q))));
        db.queue_rescan(h(2_999_950)..h(3_000_000)).unwrap();
        let after_rescan = ScanQueueSize { unscanned_blocks: 150, chain_tip: Some(h(3_000_099)) };
        assert_eq!(db.scan_queue_size(), after_rescan);
        let told = seen.lock().unwrap().clone();
        assert_eq!(told.last(), Some(&after_rescan), "queue_rescan: {told:?}");
        assert!(db.prune_scan_queue_below(h(3_000_050), None).unwrap() > 0);
        let after_prune = ScanQueueSize { unscanned_blocks: 50, chain_tip: Some(h(3_000_099)) };
        assert_eq!(db.scan_queue_size(), after_prune);
        let told = seen.lock().unwrap().clone();
        assert_eq!(told.last(), Some(&after_prune), "prune_scan_queue_below: {told:?}");
        let last = after_prune;

        let mut bytes = vec![];
        db.encode(&mut bytes).unwrap();
        let copy = MemoryWalletDb::decode_new(&bytes, Network::MainNetwork, 100).unwrap();
        assert!(copy.scan_queue_observer.0.is_none());
        assert_eq!(copy.scan_queue_size(), last);
    }
}
