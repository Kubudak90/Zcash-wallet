//! Derived queries over several tables that WalletRead, InputSource and WalletWrite share.
//!
//! - The per-shard scan state: zcash_client_sqlite 0.23's `v_{pool}_shard_scan_ranges`,
//!   `v_{pool}_shard_unscanned_ranges` and `v_{pool}_shards_scan_state` views
//!   (`wallet/db.rs`), and `unscanned_tip_exists` (`wallet/common.rs`).
//! - Anchor heights: `get_anchor_height` (`wallet.rs`) and `get_max_checkpointed_height`
//!   (`wallet/commitment_tree.rs`).
//! - Per-output facts used by note selection and balances: the shielding-input join of
//!   `select_spendable_notes_matching_value` and the lock-filter predicates of
//!   `wallet/locking.rs` (`output_eligible_condition`, `locked_tier_expr`).

use std::collections::BTreeSet;
use std::num::NonZeroU32;

use incrementalmerkletree::{Address, Position};
use shardtree::{
    ShardTree,
    store::{ShardStore, memory::MemoryShardStore},
};
use zcash_client_backend::data_api::{
    SAPLING_SHARD_HEIGHT,
    locking::LockFilter,
    scanning::ScanPriority,
    wallet::TargetHeight,
};
use zcash_primitives::transaction::TxId;
use zcash_protocol::{
    ShieldedPool,
    consensus::{self, BlockHeight, NetworkUpgrade},
};

#[cfg(feature = "orchard")]
use zcash_client_backend::data_api::ORCHARD_SHARD_HEIGHT;

use crate::{
    AccountId, MemoryWalletDb,
    types::{locks::LockKey, memory_wallet::PoolTree},
};

impl<H: incrementalmerkletree::Hashable + Clone + PartialEq, const DEPTH: u8, const SHARD_HEIGHT: u8>
    PoolTree<ShardTree<MemoryShardStore<H, BlockHeight>, DEPTH, SHARD_HEIGHT>, H>
{
    /// The indices of the shards that have a `{pool}_tree_shards` row: those whose root the
    /// server reported, and those holding note commitment data.
    pub(crate) fn shard_indices(&self) -> BTreeSet<u64> {
        let mut indices: BTreeSet<u64> = self.subtrees.keys().copied().collect();
        // MemoryShardStore is infallible.
        let Ok(roots) = self.tree.store().get_shard_roots();
        indices.extend(roots.iter().map(|a| a.index()));
        indices
    }

    /// The ids of every checkpoint the tree holds, ascending.
    pub(crate) fn checkpoint_ids(&self) -> Vec<BlockHeight> {
        let mut ids = vec![];
        let _ = self.tree.store().for_each_checkpoint(usize::MAX, |id, _| {
            ids.push(*id);
            Ok(())
        });
        ids.sort();
        ids
    }

    pub(crate) fn has_checkpoint(&self, height: BlockHeight) -> bool {
        matches!(self.tree.store().get_checkpoint(&height), Ok(Some(_)))
    }
}

/// A row of zcash_client_sqlite's `v_{pool}_shard_scan_ranges` view, without the joined
/// scan range.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ShardRow {
    /// The shard index (read only through `Debug`; the row is looked up by it).
    #[allow(dead_code)]
    pub(crate) index: u64,
    pub(crate) subtree_start_height: Option<BlockHeight>,
    pub(crate) subtree_end_height: Option<BlockHeight>,
}

pub(crate) fn shard_height(pool: ShieldedPool) -> u8 {
    match pool {
        ShieldedPool::Sapling => SAPLING_SHARD_HEIGHT,
        #[cfg(feature = "orchard")]
        ShieldedPool::Orchard | ShieldedPool::Ironwood => ORCHARD_SHARD_HEIGHT,
        #[cfg(not(feature = "orchard"))]
        ShieldedPool::Orchard | ShieldedPool::Ironwood => 16,
    }
}

impl<P: consensus::Parameters> MemoryWalletDb<P> {
    /// The activation height of the network upgrade that introduced `pool`'s note
    /// commitment tree.
    pub(crate) fn pool_activation_height(&self, pool: ShieldedPool) -> Option<BlockHeight> {
        self.params.activation_height(match pool {
            ShieldedPool::Sapling => NetworkUpgrade::Sapling,
            ShieldedPool::Orchard => NetworkUpgrade::Nu5,
            ShieldedPool::Ironwood => NetworkUpgrade::Nu6_3,
        })
    }

    pub(crate) fn pool_shard_indices(&self, pool: ShieldedPool) -> BTreeSet<u64> {
        match pool {
            ShieldedPool::Sapling => self.sapling.shard_indices(),
            #[cfg(feature = "orchard")]
            ShieldedPool::Orchard => self.orchard.shard_indices(),
            #[cfg(feature = "orchard")]
            ShieldedPool::Ironwood => self.ironwood.shard_indices(),
            #[cfg(not(feature = "orchard"))]
            _ => BTreeSet::new(),
        }
    }

    pub(crate) fn pool_subtree_end_height(&self, pool: ShieldedPool, index: u64) -> Option<BlockHeight> {
        match pool {
            ShieldedPool::Sapling => self.sapling.subtree_end_height(index),
            #[cfg(feature = "orchard")]
            ShieldedPool::Orchard => self.orchard.subtree_end_height(index),
            #[cfg(feature = "orchard")]
            ShieldedPool::Ironwood => self.ironwood.subtree_end_height(index),
            #[cfg(not(feature = "orchard"))]
            _ => None,
        }
    }

    /// The indices of the completed subtrees the server reported, with their end heights.
    pub(crate) fn pool_subtree_ends(&self, pool: ShieldedPool) -> Vec<(u64, BlockHeight)> {
        fn ends<H>(subtrees: &std::collections::BTreeMap<u64, crate::types::memory_wallet::SubtreeInfo<H>>) -> Vec<(u64, BlockHeight)> {
            subtrees.iter().map(|(i, s)| (*i, s.end_height)).collect()
        }
        match pool {
            ShieldedPool::Sapling => ends(&self.sapling.subtrees),
            #[cfg(feature = "orchard")]
            ShieldedPool::Orchard => ends(&self.orchard.subtrees),
            #[cfg(feature = "orchard")]
            ShieldedPool::Ironwood => ends(&self.ironwood.subtrees),
            #[cfg(not(feature = "orchard"))]
            _ => vec![],
        }
    }

    pub(crate) fn pool_checkpoint_ids(&self, pool: ShieldedPool) -> Vec<BlockHeight> {
        match pool {
            ShieldedPool::Sapling => self.sapling.checkpoint_ids(),
            #[cfg(feature = "orchard")]
            ShieldedPool::Orchard => self.orchard.checkpoint_ids(),
            #[cfg(feature = "orchard")]
            ShieldedPool::Ironwood => self.ironwood.checkpoint_ids(),
            #[cfg(not(feature = "orchard"))]
            _ => vec![],
        }
    }

    pub(crate) fn pool_has_checkpoint(&self, pool: ShieldedPool, height: BlockHeight) -> bool {
        match pool {
            ShieldedPool::Sapling => self.sapling.has_checkpoint(height),
            #[cfg(feature = "orchard")]
            ShieldedPool::Orchard => self.orchard.has_checkpoint(height),
            #[cfg(feature = "orchard")]
            ShieldedPool::Ironwood => self.ironwood.has_checkpoint(height),
            #[cfg(not(feature = "orchard"))]
            _ => false,
        }
    }

    /// The `v_{pool}_shard_scan_ranges` row of shard `index` (without the scan range):
    /// the subtree start height is the end height of the previous shard, or the pool's
    /// activation height.
    pub(crate) fn shard_row(&self, pool: ShieldedPool, index: u64) -> ShardRow {
        let prev_end = index
            .checked_sub(1)
            .and_then(|i| self.pool_subtree_end_height(pool, i));
        ShardRow {
            index,
            subtree_start_height: prev_end.or_else(|| self.pool_activation_height(pool)),
            subtree_end_height: self.pool_subtree_end_height(pool, index),
        }
    }

    /// The scan queue entries joined to a shard row in `v_{pool}_shard_scan_ranges`: those
    /// overlapping the blocks the shard's subtree spans.
    pub(crate) fn shard_scan_entries<'a>(
        &'a self,
        row: &'a ShardRow,
    ) -> impl Iterator<Item = &'a (BlockHeight, BlockHeight, ScanPriority)> + 'a {
        self.scan_queue.iter().filter(move |(start, end, _)| {
            row.subtree_start_height.is_some_and(|s| s < *end)
                && row.subtree_end_height.is_none_or(|e| *start <= e)
        })
    }

    /// `v_{pool}_shards_scan_state.max_priority` of the shard containing `position`, or
    /// `None` if the shard has no row or no scan range overlaps it.
    pub(crate) fn shard_max_priority(
        &self,
        pool: ShieldedPool,
        position: Position,
    ) -> Option<ScanPriority> {
        let index = Address::above_position(shard_height(pool).into(), position).index();
        if !self.pool_shard_indices(pool).contains(&index) {
            return None;
        }
        let row = self.shard_row(pool, index);
        self.shard_scan_entries(&row).map(|(_, _, p)| *p).max()
    }

    /// `unscanned_tip_exists` (`wallet/common.rs`): whether the shard containing the anchor
    /// height has an unscanned range (above the wallet birthday) starting at or below it.
    /// While one exists, witnesses of notes without stable witness data cannot be built.
    pub(crate) fn unscanned_tip_exists(&self, pool: ShieldedPool, anchor_height: BlockHeight) -> bool {
        let Some(birthday) = self.wallet_birthday() else {
            // `v_{pool}_shard_unscanned_ranges` is empty without accounts.
            return false;
        };
        self.pool_shard_indices(pool).into_iter().any(|index| {
            let row = self.shard_row(pool, index);
            let contains_anchor = row
                .subtree_start_height
                .is_some_and(|s| s <= anchor_height)
                && anchor_height <= row.subtree_end_height.unwrap_or(anchor_height);
            contains_anchor
                && self.shard_scan_entries(&row).any(|(start, end, p)| {
                    *p > ScanPriority::Scanned && *end > birthday && *start <= anchor_height
                })
        })
    }

    /// `get_max_checkpointed_height`: the greatest checkpoint of `pool`'s tree at or below
    /// `target_height - min_confirmations`.
    pub(crate) fn max_checkpointed_height(
        &self,
        pool: ShieldedPool,
        target_height: TargetHeight,
        min_confirmations: NonZeroU32,
    ) -> Option<BlockHeight> {
        let max_checkpoint_height = target_height.saturating_sub(u32::from(min_confirmations));
        self.pool_checkpoint_ids(pool)
            .into_iter()
            .filter(|h| *h <= max_checkpoint_height)
            .max()
    }

    /// `get_anchor_height`: the lesser of the Sapling and Orchard anchor heights. (As in
    /// zcash_client_sqlite, the Ironwood tree is not consulted: `put_blocks` keeps the same
    /// checkpoints in all three trees.)
    pub(crate) fn anchor_height(
        &self,
        target_height: TargetHeight,
        min_confirmations: NonZeroU32,
    ) -> Option<BlockHeight> {
        let sapling =
            self.max_checkpointed_height(ShieldedPool::Sapling, target_height, min_confirmations);
        #[cfg(feature = "orchard")]
        let orchard =
            self.max_checkpointed_height(ShieldedPool::Orchard, target_height, min_confirmations);
        #[cfg(not(feature = "orchard"))]
        let orchard: Option<BlockHeight> = None;
        sapling
            .zip(orchard)
            .map(|(s, o)| std::cmp::min(s, o))
            .or(sapling)
            .or(orchard)
    }

    /// `mempool_height`: the height of the next block.
    pub(crate) fn mempool_height(&self) -> Option<TargetHeight> {
        self.chain_tip_height().map(|h| TargetHeight::from(h + 1))
    }

    /// The `MAX(tt.mined_height)` / `MIN(IFNULL(tt.trust_status, 0))` join of note
    /// selection: over the transparent outputs of `account` that `txid` spends (a shielding
    /// transaction), the greatest mined height and whether all of them are trusted. With no
    /// such outputs: `(None, false)`.
    pub(crate) fn shielding_inputs(&self, account: AccountId, txid: &TxId) -> (Option<BlockHeight>, bool) {
        let mut any = false;
        let mut max_height: Option<BlockHeight> = None;
        let mut all_trusted = true;
        for o in self.transparent.iter() {
            if o.account_id != account || !self.transparent.spends_of(&o.outpoint).any(|t| t == txid) {
                continue;
            }
            any = true;
            let creating = self.tx_table.get(o.outpoint.txid());
            if let Some(h) = creating.and_then(|t| t.mined_height()) {
                max_height = Some(max_height.map_or(h, |m| m.max(h)));
            }
            all_trusted &= creating.is_some_and(|t| t.is_trusted());
        }
        if any { (max_height, all_trusted) } else { (None, false) }
    }

    /// `output_eligible_condition`: whether the output may be selected under `lock_filter`
    /// for a transaction to be mined at `target_height`.
    pub(crate) fn lock_eligible(
        &self,
        key: &LockKey,
        target_height: BlockHeight,
        lock_filter: LockFilter<'_>,
    ) -> bool {
        match lock_filter {
            LockFilter::Unfiltered => true,
            LockFilter::Policy(policy) => match self.output_locks.get(key) {
                None => true,
                Some(lock) => {
                    lock.expiry_height < target_height
                        || policy.overridable_owners().contains(&lock.owner)
                }
            },
        }
    }

    /// `locked_tier_expr`: when the policy admits locked outputs, the selection order key
    /// that puts the preferred tier first (`false` sorts first); otherwise `None`.
    pub(crate) fn lock_tier_key(
        &self,
        key: &LockKey,
        target_height: BlockHeight,
        lock_filter: LockFilter<'_>,
    ) -> Option<bool> {
        match lock_filter {
            LockFilter::Policy(policy) if policy.admits_locked() => {
                let locked = self.output_locks.is_locked_at(key, target_height);
                // ASC for PreferUnlocked (unlocked = 0 first), DESC for PreferLocked.
                Some(if policy.prefers_locked() { !locked } else { locked })
            }
            _ => None,
        }
    }
}
