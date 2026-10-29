//! `WalletWrite` for [`MemoryWalletDb`].
//!
//! Block and transaction storage delegate to zcash_client_backend's
//! `data_api::ll::wallet::{put_blocks, store_decrypted_tx}`; the rest follows the
//! zcash_client_sqlite 0.23 function named in each method's comment.
//!
//! Every multi-step mutation runs through [`MemoryWalletDb::transactionally`]: on error the
//! wallet is restored to its state before the call, as a rolled-back SQL transaction would
//! leave zcash_client_sqlite's database. A half-applied `put_blocks` must never be persisted.

use std::cmp::{max, min};
use std::collections::{HashMap, HashSet};
use std::ops::Range;

use incrementalmerkletree::{Marking, Retention};
use secrecy::{ExposeSecret, SecretVec};
use shardtree::{ShardTree, store::{ShardStore, memory::MemoryShardStore}};
use zcash_client_backend::{
    data_api::{
        Account as _, AccountBirthday, AccountPurpose, AccountSource, DecryptedTransaction,
        ScannedBlock, SentTransaction, TransactionStatus, WalletRead,
        WalletWrite, Zip32Derivation,
        anchor_retention::AnchorRetention,
        chain::ChainState,
        error::RewindError,
        ll::{LowLevelWalletWrite, wallet as ll_wallet},
        scanning::{ScanPriority, ScanRange},
    },
    wallet::{Note, Recipient},
    DecryptedOutput, TransferType,
};
use zcash_keys::{
    address::UnifiedAddress,
    keys::{
        AddressGenerationError, ReceiverRequirement, UnifiedAddressRequest,
        UnifiedFullViewingKey, UnifiedSpendingKey,
    },
};
use zcash_primitives::transaction::TxId;
use zcash_protocol::{
    ShieldedPool,
    consensus::{self, BlockHeight, NetworkUpgrade},
    memo::MemoBytes,
};
use zip32::{DiversifierIndex, fingerprint::SeedFingerprint};

#[cfg(feature = "transparent-inputs")]
use {
    ::transparent::{
        address::TransparentAddress,
        bundle::{OutPoint, TxOut},
        keys::{NonHardenedChildIndex, TransparentKeyScope},
    },
    zcash_client_backend::{
        data_api::TransactionsInvolvingAddress,
        wallet::{TransparentAddressMetadata, WalletTransparentOutput},
    },
    zcash_keys::{
        address::Address,
        keys::{
            ReceiverRequirement::{Allow, Require},
            transparent::gap_limits::{generate_address_list, generate_gap_addresses},
        },
    },
    zcash_protocol::PoolType,
};

use crate::{
    Account, AccountId, MemoryWalletDb, PRUNING_DEPTH, VERIFY_LOOKAHEAD,
    error::Error,
    types::{
        address::KeyScope,
        memory_wallet::{PoolTree, SubtreeInfo},
    },
};

/// The offset added to the current Unix time to pick the first diversifier index tried for a
/// new shielded-only address (zcash_client_sqlite `MIN_SHIELDED_DIVERSIFIER_OFFSET`).
const MIN_SHIELDED_DIVERSIFIER_OFFSET: u64 = 2817325936;

/// The current Unix time in seconds. Uses the `time` crate, which reads the JavaScript clock
/// on wasm32 (`std::time::SystemTime::now` panics there).
pub(crate) fn unix_time_now() -> u64 {
    u64::try_from(time::OffsetDateTime::now_utc().unix_timestamp()).unwrap_or(0)
}

/// A structural copy of a note commitment tree, through the store interface (the shardtree
/// types do not implement `Clone`). Includes retained checkpoints. Infallible: every
/// operation of `MemoryShardStore` is.
pub(crate) fn copy_tree<H: incrementalmerkletree::Hashable + Clone + PartialEq, const DEPTH: u8, const SHARD_HEIGHT: u8>(
    tree: &ShardTree<MemoryShardStore<H, BlockHeight>, DEPTH, SHARD_HEIGHT>,
    max_checkpoints: usize,
) -> ShardTree<MemoryShardStore<H, BlockHeight>, DEPTH, SHARD_HEIGHT> {
    fn ok<T>(r: Result<T, std::convert::Infallible>) -> T {
        match r {
            Ok(t) => t,
            Err(e) => match e {},
        }
    }
    let src = tree.store();
    let mut store = MemoryShardStore::<H, BlockHeight>::empty();
    for addr in ok(src.get_shard_roots()) {
        if let Some(shard) = ok(src.get_shard(addr)) {
            ok(store.put_shard(shard));
        }
    }
    ok(store.put_cap(ok(src.get_cap())));
    let mut checkpoints = vec![];
    ok(src.for_each_checkpoint(usize::MAX, |id, cp| {
        checkpoints.push((*id, cp.clone()));
        Ok(())
    }));
    for (id, cp) in checkpoints {
        ok(store.add_checkpoint(id, cp));
    }
    for id in ok(src.retained_checkpoints()) {
        ok(store.add_retained_checkpoint(id));
    }
    ShardTree::new(store, max_checkpoints)
}

impl<H: incrementalmerkletree::Hashable + Clone + PartialEq, const DEPTH: u8, const SHARD_HEIGHT: u8>
    PoolTree<ShardTree<MemoryShardStore<H, BlockHeight>, DEPTH, SHARD_HEIGHT>, H>
{
    fn deep_copy(&self, max_checkpoints: usize) -> Self {
        PoolTree {
            tree: copy_tree(&self.tree, max_checkpoints),
            subtrees: self.subtrees.clone(),
        }
    }
}

/// How truncation affects one note commitment tree (`TreeTruncation`).
enum TreeTruncation {
    ToCheckpoint,
    Unaffected,
    ResetToSubtreeRoots,
    WouldDestroyWitnesses,
    DivergedCheckpoints,
}

impl<P: consensus::Parameters> MemoryWalletDb<P> {
    /// A full copy of the wallet.
    pub(crate) fn snapshot(&self) -> Self {
        Self {
            params: self.params.clone(),
            max_checkpoints: self.max_checkpoints,
            accounts: self.accounts.clone(),
            addresses: self.addresses.clone(),
            blocks: self.blocks.clone(),
            tx_table: self.tx_table.clone(),
            received_notes: self.received_notes.clone(),
            sent_notes: self.sent_notes.clone(),
            spend_maps: self.spend_maps.clone(),
            transparent: self.transparent.clone(),
            tx_retrieval_queue: self.tx_retrieval_queue.clone(),
            #[cfg(feature = "transparent-inputs")]
            transparent_spend_search_queue: self.transparent_spend_search_queue.clone(),
            scan_queue: self.scan_queue.clone(),
            output_locks: self.output_locks.clone(),
            sapling: self.sapling.deep_copy(self.max_checkpoints),
            #[cfg(feature = "orchard")]
            orchard: self.orchard.deep_copy(self.max_checkpoints),
            #[cfg(feature = "orchard")]
            ironwood: self.ironwood.deep_copy(self.max_checkpoints),
            #[cfg(feature = "transparent-inputs")]
            gap_limits: self.gap_limits,
            anchor_retention_interval: self.anchor_retention_interval,
        }
    }

    /// Runs `f`; if it fails, restores the wallet to its state before the call.
    pub(crate) fn transactionally<T, E>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<T, E>,
    ) -> Result<T, E> {
        let backup = self.snapshot();
        match f(self) {
            Ok(t) => Ok(t),
            Err(e) => {
                *self = backup;
                Err(e)
            }
        }
    }

    /// The anchor retention policy: from NU6.3 activation, at this wallet's interval
    /// (zcash_client_sqlite `put_blocks`). ZIP 318 pool migrations are not supported by this
    /// backend, so no migration-committed intervals are added.
    fn anchor_retention(&self) -> Option<AnchorRetention> {
        self.params
            .activation_height(NetworkUpgrade::Nu6_3)
            .map(|from_height| {
                AnchorRetention::new(
                    from_height,
                    zcash_protocol::zip318::BlockSpacing::for_network(&self.params),
                    self.anchor_retention_interval(),
                )
            })
    }

    /// `max_zip32_account_index`: the highest ZIP 32 index of accounts with this seed.
    fn max_zip32_account_index(&self, seed_fp: &SeedFingerprint) -> Option<zip32::AccountId> {
        self.accounts
            .iter()
            .filter_map(|a| match a.source() {
                AccountSource::Derived { derivation, .. }
                | AccountSource::Imported {
                    purpose:
                        AccountPurpose::Spending {
                            derivation: Some(derivation),
                        },
                    ..
                } if derivation.seed_fingerprint() == seed_fp => Some(derivation.account_index()),
                _ => None,
            })
            .max()
    }

    /// `add_account` (zcash_client_sqlite `wallet.rs`): records the account, its default
    /// address and its transparent gap addresses.
    fn add_account_full(
        &mut self,
        account_name: &str,
        source: AccountSource,
        ufvk: UnifiedFullViewingKey,
        birthday: &AccountBirthday,
    ) -> Result<Account, Error> {
        let uivk = ufvk.to_unified_incoming_viewing_key();
        if let Some(existing) = self.account_for_uivk(&uivk)? {
            // `upgrade_account_ufvk`: only a strictly more capable key replaces the stored
            // one; anything else is a collision.
            let existing_id = existing.id();
            let existing_ufvk = existing.ufvk.clone();
            if !ufvk.subsumes_uivk(&existing.uivk()) || existing_ufvk.subsumes_ufvk(&ufvk) {
                return Err(Error::Other(format!(
                    "the key collides with existing account {existing_id:?}"
                )));
            }
            let account = self
                .accounts
                .get_mut(existing_id)
                .ok_or(Error::AccountUnknown(existing_id))?;
            account.ufvk = ufvk;
            return Ok(account.clone());
        }

        let (account_id, account) =
            self.add_account_row(account_name, source, ufvk, birthday.clone())?;

        // Bring the note commitment trees, the scan queue and the birthday metadata into a
        // state consistent with the new account's birthday by rewinding to the chain state
        // before it; the new account is the only one whose birthday may be reset (sqlite
        // `add_account`). On a wallet that has not scanned past the birthday this changes
        // nothing; otherwise it truncates within the pruning window and queues the blocks
        // from the birthday for rescanning.
        match self.rewind_to_chain_state_internal(
            &birthday.prior_chain_state(),
            std::iter::once(account_id).collect(),
        ) {
            Ok(()) => {}
            Err(RewindError::DataSource(e)) => return Err(e),
            Err(RewindError::RewindBeyondBirthdays(_)) => {
                return Err(Error::CorruptedData(
                    "rewind for a new account refused although its birthday may be reset"
                        .into(),
                ));
            }
            Err(e) => return Err(Error::Other(format!("rewind for a new account failed: {e:?}"))),
        }

        // Blocks below the birthday (from Sapling activation) are ignored.
        let sapling_activation_height = self
            .params
            .activation_height(NetworkUpgrade::Sapling)
            .unwrap_or_else(|| BlockHeight::from_u32(0));
        if sapling_activation_height < birthday.height() {
            let ignored_range = sapling_activation_height..birthday.height();
            self.scan_queue.replace_queue_entries(
                &ignored_range,
                Some(ScanRange::from_parts(
                    ignored_range.clone(),
                    ScanPriority::Ignored,
                ))
                .into_iter(),
                false,
            )?;
        }

        // The default Unified Address, exposed at the birthday.
        let (address, d_idx) = account
            .ufvk
            .default_address(UnifiedAddressRequest::AllAvailableKeys)?;
        self.addresses.upsert_unified(
            account_id,
            d_idx,
            &address,
            Some(birthday.height()),
            false,
        )?;

        #[cfg(feature = "transparent-inputs")]
        {
            // The external addresses below the default address's index, then the gap
            // addresses of each scope.
            if let Ok(default_idx) = NonHardenedChildIndex::try_from(d_idx) {
                let list = generate_address_list(
                    &uivk,
                    Some(&account.ufvk),
                    TransparentKeyScope::EXTERNAL,
                    UnifiedAddressRequest::ALLOW_ALL,
                    NonHardenedChildIndex::ZERO..default_idx,
                    false,
                )?;
                self.addresses
                    .store_range(account_id, KeyScope::External, list)?;
            }
            for key_scope in [
                TransparentKeyScope::EXTERNAL,
                TransparentKeyScope::INTERNAL,
                TransparentKeyScope::EPHEMERAL,
            ] {
                let gap_limits = self.gap_limits;
                generate_gap_addresses(
                    self,
                    &gap_limits,
                    account_id,
                    &uivk,
                    Some(&account.ufvk),
                    key_scope,
                    UnifiedAddressRequest::unsafe_custom(Allow, Allow, Require),
                    false,
                )?;
            }
        }

        self.accounts
            .get(account_id)
            .cloned()
            .ok_or(Error::AccountUnknown(account_id))
    }

    /// `scanning::update_chain_tip`.
    fn update_chain_tip_internal(&mut self, new_tip: BlockHeight) -> Result<(), Error> {
        let sapling_activation = match self.params.activation_height(NetworkUpgrade::Sapling) {
            Some(h) if h <= new_tip => h,
            _ => return Ok(()),
        };
        let max_scanned = self.max_scanned_height();
        let wallet_birthday = self.wallet_birthday();

        // A tip below the max scanned height means a reorg is in progress; scanning will
        // detect the discontinuity and truncate.
        if let Some(h) = max_scanned {
            if new_tip < h {
                return Ok(());
            }
        }

        let chain_end = new_tip + 1;

        // The least of the pools' last subtree end heights, so that the last incomplete
        // shard of every pool (Ironwood included) is covered.
        let min_shard_tip = Self::shielded_pools()
            .iter()
            .filter_map(|pool| {
                self.pool_subtree_ends(*pool)
                    .into_iter()
                    .map(|(_, end)| end)
                    .max()
            })
            .min();

        let tip_shard_entry = min_shard_tip.filter(|h| h < &chain_end).map(|h| {
            let min_to_scan = wallet_birthday.filter(|b| b > &h).unwrap_or(h);
            ScanRange::from_parts(min_to_scan..chain_end, ScanPriority::ChainTip)
        });

        let tip_entry = match max_scanned {
            None => match wallet_birthday {
                None => ScanRange::from_parts(sapling_activation..chain_end, ScanPriority::Ignored),
                Some(b) => ScanRange::from_parts(b..chain_end, ScanPriority::Historic),
            },
            Some(max_scanned) => {
                let min_unscanned = max_scanned + 1;
                if tip_shard_entry.is_none() {
                    ScanRange::from_parts(min_unscanned..chain_end, ScanPriority::Historic)
                } else {
                    let stable_height = new_tip.saturating_sub(PRUNING_DEPTH);
                    if max_scanned > stable_height {
                        ScanRange::from_parts(min_unscanned..chain_end, ScanPriority::ChainTip)
                    } else {
                        ScanRange::from_parts(
                            min_unscanned..min(stable_height + 1, min_unscanned + VERIFY_LOOKAHEAD),
                            ScanPriority::Verify,
                        )
                    }
                }
            }
        };

        let query_range = match tip_shard_entry.as_ref() {
            Some(se) => Range {
                start: min(se.block_range().start, tip_entry.block_range().start),
                end: max(se.block_range().end, tip_entry.block_range().end),
            },
            None => tip_entry.block_range().clone(),
        };

        self.scan_queue.replace_queue_entries(
            &query_range,
            tip_shard_entry.into_iter().chain(Some(tip_entry)),
            false,
        )
    }

    /// `min_shared_checkpoint_height`: the least checkpoint height present in every tree
    /// that has checkpoints.
    fn min_shared_checkpoint_height(&self) -> Option<BlockHeight> {
        let sets: Vec<Vec<BlockHeight>> = Self::shielded_pools()
            .iter()
            .map(|p| self.pool_checkpoint_ids(*p))
            .collect();
        let mut all: Vec<BlockHeight> = sets.iter().flatten().copied().collect();
        all.sort();
        all.dedup();
        all.into_iter()
            .find(|h| sets.iter().all(|s| s.is_empty() || s.contains(h)))
    }

    /// `pool_truncation_tolerance_sql`: whether truncating to `height` is acceptable for
    /// `pool`.
    fn pool_tolerates_truncation(&self, pool: ShieldedPool, height: BlockHeight) -> bool {
        let ids = self.pool_checkpoint_ids(pool);
        ids.contains(&height)
            || !ids.iter().any(|c| *c > height)
            || (!ids.iter().any(|c| *c < height) && !self.has_positioned_note_mined_at_or_below(pool, height))
    }

    fn has_positioned_note_mined_at_or_below(&self, pool: ShieldedPool, height: BlockHeight) -> bool {
        self.received_notes.iter().any(|rn| {
            rn.pool() == pool
                && rn.commitment_tree_position().is_some()
                && self
                    .tx_table
                    .get(&rn.txid())
                    .and_then(|t| t.mined_height())
                    .is_some_and(|h| h <= height)
        })
    }

    /// `select_truncation_height`.
    fn select_truncation_height(&self, requested: BlockHeight) -> Result<BlockHeight, Error> {
        self.blocks
            .keys()
            .rev()
            .copied()
            .find(|h| {
                *h <= requested
                    && Self::shielded_pools()
                        .iter()
                        .all(|p| self.pool_tolerates_truncation(*p, *h))
            })
            .ok_or_else(|| {
                Error::RequestedRewindInvalid(self.min_shared_checkpoint_height(), requested)
            })
    }

    /// `plan_tree_truncation`.
    fn plan_tree_truncation(
        &self,
        pool: ShieldedPool,
        truncation_height: BlockHeight,
        rescan_floor: BlockHeight,
    ) -> TreeTruncation {
        let ids = self.pool_checkpoint_ids(pool);
        let has_at = ids.contains(&truncation_height);
        let has_above = ids.iter().any(|c| *c > truncation_height);
        let has_below = ids.iter().any(|c| *c < truncation_height);
        match (has_at, has_above, has_below) {
            (true, _, _) => TreeTruncation::ToCheckpoint,
            (false, false, _) => TreeTruncation::Unaffected,
            (false, true, false) => {
                if self.has_positioned_note_mined_at_or_below(pool, rescan_floor) {
                    TreeTruncation::WouldDestroyWitnesses
                } else {
                    TreeTruncation::ResetToSubtreeRoots
                }
            }
            (false, true, true) => TreeTruncation::DivergedCheckpoints,
        }
    }

    /// `truncate_tree_to_subtree_roots`: rebuilds a tree from the server-provided roots of
    /// the leading run of complete subtrees ending at or below `truncation_height`.
    fn reset_pool_to_subtree_roots<H, const DEPTH: u8, const SHARD_HEIGHT: u8>(
        pool_tree: &mut PoolTree<ShardTree<MemoryShardStore<H, BlockHeight>, DEPTH, SHARD_HEIGHT>, H>,
        truncation_height: BlockHeight,
        max_checkpoints: usize,
    ) -> Result<(), Error>
    where
        H: incrementalmerkletree::Hashable + Clone + PartialEq,
    {
        let mut roots = vec![];
        for (index, info) in pool_tree.subtrees.iter() {
            if *index != roots.len() as u64 || info.end_height > truncation_height {
                break;
            }
            roots.push(info.clone());
        }
        pool_tree.tree = ShardTree::new(MemoryShardStore::empty(), max_checkpoints);
        pool_tree.subtrees.clear();
        for (index, info) in roots.into_iter().enumerate() {
            let index = index as u64;
            pool_tree.tree.insert(
                incrementalmerkletree::Address::from_parts(SHARD_HEIGHT.into(), index),
                info.root.clone(),
            )?;
            pool_tree.subtrees.insert(index, SubtreeInfo { root: info.root, end_height: info.end_height });
        }
        Ok(())
    }

    fn truncate_pool(
        &mut self,
        pool: ShieldedPool,
        truncation_height: BlockHeight,
        rescan_floor: BlockHeight,
    ) -> Result<(), Error> {
        match self.plan_tree_truncation(pool, truncation_height, rescan_floor) {
            TreeTruncation::Unaffected => Ok(()),
            TreeTruncation::ToCheckpoint => {
                let truncated = match pool {
                    ShieldedPool::Sapling => self.sapling.tree.truncate_to_checkpoint(&truncation_height)?,
                    #[cfg(feature = "orchard")]
                    ShieldedPool::Orchard => self.orchard.tree.truncate_to_checkpoint(&truncation_height)?,
                    #[cfg(feature = "orchard")]
                    ShieldedPool::Ironwood => self.ironwood.tree.truncate_to_checkpoint(&truncation_height)?,
                    #[cfg(not(feature = "orchard"))]
                    _ => true,
                };
                if truncated {
                    Ok(())
                } else {
                    Err(Error::CorruptedData(format!(
                        "the {pool:?} note commitment tree has no checkpoint at height {truncation_height} to truncate to"
                    )))
                }
            }
            TreeTruncation::ResetToSubtreeRoots => {
                let max_checkpoints = self.max_checkpoints;
                match pool {
                    ShieldedPool::Sapling => Self::reset_pool_to_subtree_roots(&mut self.sapling, truncation_height, max_checkpoints),
                    #[cfg(feature = "orchard")]
                    ShieldedPool::Orchard => Self::reset_pool_to_subtree_roots(&mut self.orchard, truncation_height, max_checkpoints),
                    #[cfg(feature = "orchard")]
                    ShieldedPool::Ironwood => Self::reset_pool_to_subtree_roots(&mut self.ironwood, truncation_height, max_checkpoints),
                    #[cfg(not(feature = "orchard"))]
                    _ => Ok(()),
                }
            }
            TreeTruncation::WouldDestroyWitnesses => Err(Error::RequestedRewindInvalid(
                self.min_shared_checkpoint_height(),
                rescan_floor,
            )),
            TreeTruncation::DivergedCheckpoints => Err(Error::CorruptedData(format!(
                "the {pool:?} note commitment tree's checkpoints have diverged at height {truncation_height}"
            ))),
        }
    }

    /// `truncate_to_height_internal`.
    fn truncate_to_height_internal(
        &mut self,
        truncation_height: BlockHeight,
        rescan_floor: BlockHeight,
    ) -> Result<BlockHeight, Error> {
        let last_scanned_height = self.max_scanned_height().unwrap_or_else(|| {
            self.params
                .activation_height(NetworkUpgrade::Sapling)
                .map_or(BlockHeight::from_u32(0), |h| h - 1)
        });

        self.scan_queue.trim_to(truncation_height);

        // Observations of unspent outputs above the truncation height are forgotten.
        let unspent_updates: Vec<_> = self
            .transparent
            .iter()
            .filter(|o| o.max_observed_unspent_height.is_some_and(|h| h > truncation_height))
            .map(|o| {
                let mined_below = self
                    .tx_table
                    .get(o.outpoint.txid())
                    .and_then(|t| t.mined_height())
                    .is_some_and(|h| h <= truncation_height);
                (o.outpoint.clone(), mined_below.then_some(truncation_height))
            })
            .collect();
        for (op, h) in unspent_updates {
            if let Some(o) = self.transparent.outputs.get_mut(&op) {
                o.max_observed_unspent_height = h;
            }
        }

        self.tx_table.unmine_above(truncation_height);

        if truncation_height < last_scanned_height {
            for pool in Self::shielded_pools() {
                self.truncate_pool(*pool, truncation_height, rescan_floor)?;
            }
            self.blocks.retain(|h, _| *h <= truncation_height);
            self.spend_maps.truncate_above(truncation_height);
        }
        Ok(truncation_height)
    }

    /// The least checkpoint of `pool`'s tree at or above `height` (`min_checkpoint_id_at_or_above`).
    fn min_checkpoint_at_or_above(&self, pool: ShieldedPool, height: BlockHeight) -> Option<BlockHeight> {
        self.pool_checkpoint_ids(pool).into_iter().find(|c| *c >= height)
    }

    /// `rewind_to_chain_state`.
    fn rewind_to_chain_state_internal(
        &mut self,
        chain_state: &ChainState,
        reset_account_birthdays: HashSet<AccountId>,
    ) -> Result<(), RewindError<AccountId, Error>> {
        let account_birthdays: HashMap<AccountId, BlockHeight> = self
            .accounts
            .iter()
            .map(|a| (a.id(), a.birthday().height()))
            .collect();
        if !reset_account_birthdays
            .iter()
            .all(|id| account_birthdays.contains_key(id))
        {
            return Err(RewindError::DataSource(Error::CorruptedData(
                "Account ids provided for birthday reset do not exist in the wallet.".to_string(),
            )));
        }
        let target_height = chain_state.block_height();
        let new_birthday = target_height + 1;
        if account_birthdays.values().all(|b| b > &new_birthday) && reset_account_birthdays.is_empty() {
            return Err(RewindError::RewindBeyondBirthdays(account_birthdays));
        }

        let chain_tip = self.chain_tip_height();
        if let Some(max_scanned) = self.max_scanned_height() {
            if target_height < max_scanned {
                let pruning_floor = max_scanned.saturating_sub(PRUNING_DEPTH - 1);
                let truncation_target = target_height.max(pruning_floor);
                let window_floor = Self::shielded_pools()
                    .iter()
                    .filter_map(|p| self.min_checkpoint_at_or_above(*p, truncation_target))
                    .min();
                let truncation_height = window_floor.unwrap_or(pruning_floor);
                self.truncate_to_height_internal(truncation_height, target_height)
                    .map_err(RewindError::DataSource)?;
            }
        }

        if let Some(t) = chain_tip {
            if target_height < t {
                let rescan_range = (target_height + 1)..(t + 1);
                self.scan_queue
                    .replace_queue_entries(
                        &rescan_range,
                        std::iter::once(ScanRange::from_parts(
                            rescan_range.clone(),
                            ScanPriority::Historic,
                        )),
                        true,
                    )
                    .map_err(RewindError::DataSource)?;
            }
        }

        for id in &reset_account_birthdays {
            if let Some(account) = self.accounts.get_mut(*id) {
                if account.birthday.height() > new_birthday {
                    account.birthday = AccountBirthday::from_parts(
                        chain_state.clone(),
                        account.birthday.recover_until(),
                    );
                }
            }
        }
        Ok(())
    }

    /// `truncate_to_chain_state`.
    fn truncate_to_chain_state_internal(&mut self, chain_state: ChainState) -> Result<(), Error> {
        let target_height = chain_state.block_height();
        let truncate_trees = self.max_scanned_height().is_some_and(|h| h > target_height);
        if truncate_trees {
            match self.select_truncation_height(target_height) {
                Ok(h) => {
                    if h == target_height {
                        return self.truncate_to_height_internal(h, h).map(|_| ());
                    }
                }
                Err(Error::RequestedRewindInvalid(safe, _)) => {
                    if let Some(min_checkpoint_height) = safe {
                        self.truncate_to_height_internal(min_checkpoint_height, min_checkpoint_height)?;
                    }
                }
                Err(e) => return Err(e),
            }
            let checkpoint = Retention::Checkpoint {
                id: target_height,
                marking: Marking::None,
            };
            self.sapling
                .tree
                .insert_frontier(chain_state.final_sapling_tree().clone(), checkpoint)?;
            #[cfg(feature = "orchard")]
            self.orchard
                .tree
                .insert_frontier(chain_state.final_orchard_tree().clone(), checkpoint)?;
            #[cfg(feature = "orchard")]
            self.ironwood
                .tree
                .insert_frontier(chain_state.final_ironwood_tree().clone(), checkpoint)?;
        }
        let truncated = self.truncate_to_height_internal(target_height, target_height)?;
        if truncated != target_height {
            return Err(Error::CorruptedData(format!(
                "truncation to the chain state at {target_height} stopped at {truncated}"
            )));
        }
        Ok(())
    }

    /// `delete_account`.
    fn delete_account_internal(&mut self, account: AccountId) -> Result<(), Error> {
        if self.accounts.get(account).is_none() {
            return Err(Error::AccountUnknown(account));
        }
        // Outputs sent to the account keep their recipient address.
        let sent_to_account: Vec<_> = self
            .sent_notes
            .iter()
            .filter(|(_, o)| o.to_account_id() == Some(account))
            .map(|(id, _)| *id)
            .collect();
        for id in sent_to_account {
            let address = match id.pool() {
                zcash_protocol::PoolType::Shielded(pool) => u16::try_from(id.output_index())
                    .ok()
                    .and_then(|idx| {
                        self.received_notes
                            .get(&zcash_client_backend::wallet::NoteId::new(*id.txid(), pool, idx))
                    })
                    .and_then(|rn| rn.address_id())
                    .and_then(|a| self.addresses.get(a))
                    .map(|a| a.address.encode(&self.params)),
                zcash_protocol::PoolType::Transparent => self
                    .transparent
                    .get(&::transparent::bundle::OutPoint::new(*id.txid().as_ref(), id.output_index()))
                    .map(|o| zcash_keys::encoding::AddressCodec::encode(&o.address, &self.params)),
            };
            if let Some(o) = self.sent_notes.0.get_mut(&id) {
                if let Some(address) = address {
                    o.to_address = Some(address);
                    o.to_account_id = None;
                }
            }
        }

        // Transactions involving only this account are deleted.
        let involves = |db: &Self, txid: &TxId, pred: &dyn Fn(AccountId) -> bool| -> bool {
            db.received_notes.iter().any(|rn| {
                pred(rn.account_id())
                    && (rn.txid() == *txid || db.received_notes.spends_of(&rn.note_id()).any(|t| t == txid))
            }) || db.transparent.iter().any(|o| {
                pred(o.account_id)
                    && (o.outpoint.txid() == txid || db.transparent.spends_of(&o.outpoint).any(|t| t == txid))
            })
        };
        let to_delete: Vec<TxId> = self
            .tx_table
            .iter()
            .map(|(txid, _)| *txid)
            .filter(|txid| {
                involves(self, txid, &|a| a == account) && !involves(self, txid, &|a| a != account)
            })
            .collect();
        for txid in to_delete {
            self.remove_transaction(&txid);
        }

        self.received_notes.remove_account(account);
        self.transparent.remove_account(account);
        self.sent_notes.remove_account(account);
        self.addresses.remove_account(account);
        self.accounts.remove(account);
        Ok(())
    }

    /// Deletes a transaction row and the rows that cascade from it.
    fn remove_transaction(&mut self, txid: &TxId) {
        self.tx_table.0.remove(txid);
        self.received_notes.remove_notes_of(txid);
        self.received_notes.remove_spends_by(txid);
        self.sent_notes.remove_tx(txid);
        self.transparent.remove_tx(txid);
        self.tx_retrieval_queue.remove(txid, crate::types::data_requests::TxQueryType::Enhancement);
        self.tx_retrieval_queue.remove(txid, crate::types::data_requests::TxQueryType::Status);
        self.tx_retrieval_queue.remove_dependent_on(txid);
        #[cfg(feature = "transparent-inputs")]
        self.transparent_spend_search_queue.remove_tx(txid);
        self.output_locks.0.retain(|(t, _, _), _| t != txid);
    }

    /// `get_next_available_address`.
    fn next_available_address(
        &mut self,
        account_id: AccountId,
        request: UnifiedAddressRequest,
    ) -> Result<Option<(UnifiedAddress, DiversifierIndex)>, Error> {
        let Some(account) = self.accounts.get(account_id).cloned() else {
            return Ok(None);
        };
        let uivk = account.uivk();
        let requirements = uivk.receiver_requirements(request)?;

        let (addr, diversifier_index) = if requirements.p2pkh() == ReceiverRequirement::Require {
            #[cfg(not(feature = "transparent-inputs"))]
            {
                return Err(Error::AddressGeneration(
                    AddressGenerationError::ReceiverTypeNotSupported(
                        zcash_address::unified::Typecode::P2PKH,
                    ),
                ));
            }
            #[cfg(feature = "transparent-inputs")]
            {
                let gap_limits = self.gap_limits;
                generate_gap_addresses(
                    self,
                    &gap_limits,
                    account_id,
                    &uivk,
                    Some(&account.ufvk),
                    TransparentKeyScope::EXTERNAL,
                    UnifiedAddressRequest::unsafe_custom(Allow, Allow, Require),
                    true,
                )?;
                // `select_addrs_to_reserve` with n = gap limit: the unexposed addresses of
                // the current gap, lowest index first.
                let gap_limit = self.gap_limits.external();
                let gap_start = self
                    .gap_start(account_id, KeyScope::External, gap_limit)
                    .ok_or(Error::AddressGeneration(
                        AddressGenerationError::DiversifierSpaceExhausted,
                    ))?;
                let gap_end = gap_start.index().saturating_add(gap_limit);
                let mut candidates: Vec<NonHardenedChildIndex> = self
                    .addresses
                    .for_account(account_id)
                    .filter(|(_, a)| a.key_scope == KeyScope::External && a.exposed_at_height.is_none())
                    .filter_map(|(_, a)| a.transparent_child_index)
                    .filter(|i| i.index() >= gap_start.index() && i.index() < gap_end)
                    .collect();
                candidates.sort_by_key(|i| i.index());
                candidates
                    .into_iter()
                    .find_map(|i| {
                        let j = DiversifierIndex::from(i);
                        uivk.address(j, request).ok().map(|ua| (ua, j))
                    })
                    .ok_or(Error::ReachedGapLimit(account_id, gap_end))?
            }
        } else {
            // Start from a time-derived index, skipping indices already handed out.
            let mut j = DiversifierIndex::from(
                unix_time_now().saturating_add(MIN_SHIELDED_DIVERSIFIER_OFFSET),
            );
            loop {
                let found = uivk.find_address(j, request)?;
                let exposed = self
                    .addresses
                    .find(account_id, KeyScope::External, &found.1)
                    .and_then(|id| self.addresses.get(id))
                    .and_then(|row| row.exposed_at_height);
                if exposed.is_none() {
                    break found;
                }
                j = found.1;
                j.increment()
                    .map_err(|_| Error::AddressGeneration(AddressGenerationError::DiversifierSpaceExhausted))?;
            }
        };

        let chain_tip = self.chain_tip_height().ok_or(Error::ChainHeightUnknown)?;
        self.addresses.upsert_unified(
            account_id,
            diversifier_index,
            &addr,
            Some(chain_tip),
            true,
        )?;
        Ok(Some((addr, diversifier_index)))
    }

    /// `store_transaction_to_be_sent`.
    fn store_transaction_to_be_sent(
        &mut self,
        sent_tx: &SentTransaction<AccountId>,
    ) -> Result<TxId, Error> {
        let tx_ref = self.put_tx_data(
            sent_tx.tx(),
            Some(sent_tx.fee_amount()),
            Some(sent_tx.created()),
            Some(sent_tx.target_height()),
            sent_tx.target_height().into(),
        )?;

        let mut detectable_via_scanning = false;
        if let Some(bundle) = sent_tx.tx().sapling_bundle() {
            for spend in bundle.shielded_spends() {
                detectable_via_scanning |= self.mark_sapling_note_spent(spend.nullifier(), tx_ref)?;
            }
        }
        if let Some(_bundle) = sent_tx.tx().orchard_bundle() {
            #[cfg(feature = "orchard")]
            for action in _bundle.actions() {
                detectable_via_scanning |= self.mark_orchard_note_spent(action.nullifier(), tx_ref)?;
            }
            #[cfg(not(feature = "orchard"))]
            return Err(Error::OrchardNotEnabled);
        }
        if let Some(_bundle) = sent_tx.tx().ironwood_bundle() {
            #[cfg(feature = "orchard")]
            for action in _bundle.actions() {
                detectable_via_scanning |= self.mark_ironwood_note_spent(action.nullifier(), tx_ref)?;
            }
            #[cfg(not(feature = "orchard"))]
            return Err(Error::OrchardNotEnabled);
        }
        #[cfg(feature = "transparent-inputs")]
        for utxo_outpoint in sent_tx.utxos_spent() {
            self.mark_transparent_utxo_spent(utxo_outpoint, tx_ref)?;
        }

        // `unlock_spent_notes`: the locks of the outputs this transaction spends are
        // released (they are now spent).
        let spent_keys: Vec<_> = self
            .received_notes
            .spent_by(&tx_ref)
            .map(Self::note_lock_key)
            .chain(
                self.transparent
                    .spends
                    .iter()
                    .filter(|(_, txs)| txs.contains(&tx_ref))
                    .map(|(op, _)| (*op.txid(), zcash_protocol::PoolType::TRANSPARENT, op.n())),
            )
            .collect();
        for key in spent_keys {
            self.output_locks.clear(&key);
        }

        for output in sent_tx.outputs() {
            self.put_sent_output(
                *sent_tx.funding_account(),
                tx_ref,
                output.output_index(),
                output.recipient(),
                output.value(),
                output.memo(),
            )?;

            match output.recipient() {
                Recipient::External {
                    recipient_address: _zaddr,
                    output_pool: _pool,
                } => {
                    #[cfg(feature = "transparent-inputs")]
                    if _pool == &PoolType::Transparent {
                        let address = Address::try_from_zcash_address(&self.params, _zaddr.clone())
                            .map_err(|e| Error::Other(format!("recipient address: {e}")))?;
                        if let Some(taddr) = address.to_transparent_address() {
                            use zcash_client_backend::data_api::ll::LowLevelWalletRead as _;
                            if self.find_account_for_transparent_address(&taddr)?.is_some() {
                                let wto = WalletTransparentOutput::from_parts(
                                    OutPoint::new(
                                        sent_tx.tx().txid().into(),
                                        u32::try_from(output.output_index())?,
                                    ),
                                    TxOut::new(output.value(), taddr.script().into()),
                                    None,
                                    None,
                                    Some(TransparentKeyScope::EXTERNAL),
                                    Some(*sent_tx.funding_account()),
                                )
                                .ok_or_else(|| Error::CorruptedData("transparent output script".into()))?;
                                self.put_transparent_output(&wto, sent_tx.target_height().into(), true)?;
                            }
                        }
                    }
                }
                Recipient::InternalShielded {
                    receiving_account,
                    note,
                    ..
                } => {
                    detectable_via_scanning = true;
                    let memo = output.memo().map_or_else(MemoBytes::empty, |m| m.clone());
                    match note.as_ref() {
                        Note::Sapling(note) => {
                            self.put_received_sapling_note(
                                &DecryptedOutput::new(
                                    output.output_index(),
                                    note.clone(),
                                    ShieldedPool::Sapling,
                                    *receiving_account,
                                    memo,
                                    TransferType::AccountInternal,
                                ),
                                tx_ref,
                                Some(sent_tx.target_height().into()),
                                None,
                            )?;
                        }
                        #[cfg(feature = "orchard")]
                        orchard_note @ Note::Orchard { note, pool } => {
                            let shielded_pool = orchard_note.pool();
                            let decrypted = DecryptedOutput::new(
                                output.output_index(),
                                (*note, *pool),
                                shielded_pool,
                                *receiving_account,
                                memo,
                                TransferType::AccountInternal,
                            );
                            match shielded_pool {
                                ShieldedPool::Ironwood => self.put_received_ironwood_note(
                                    &decrypted,
                                    tx_ref,
                                    Some(sent_tx.target_height().into()),
                                    None,
                                )?,
                                _ => self.put_received_orchard_note(
                                    &decrypted,
                                    tx_ref,
                                    Some(sent_tx.target_height().into()),
                                    None,
                                )?,
                            }
                        }
                    }
                }
                #[cfg(feature = "transparent-inputs")]
                Recipient::EphemeralTransparent {
                    ephemeral_address,
                    outpoint,
                    ..
                } => {
                    self.check_ephemeral_address_reuse(ephemeral_address)?;
                    use zcash_client_backend::data_api::ll::LowLevelWalletRead as _;
                    let (recipient_account, _) = self
                        .find_account_for_transparent_address(ephemeral_address)?
                        .ok_or_else(|| {
                            Error::CorruptedData(
                                "ephemeral address does not belong to any wallet account".into(),
                            )
                        })?;
                    let wto = WalletTransparentOutput::from_parts(
                        outpoint.clone(),
                        TxOut::new(output.value(), ephemeral_address.script().into()),
                        None,
                        Some(recipient_account),
                        Some(TransparentKeyScope::EPHEMERAL),
                        Some(*sent_tx.funding_account()),
                    )
                    .ok_or_else(|| Error::CorruptedData("ephemeral output script".into()))?;
                    self.put_transparent_output(&wto, sent_tx.target_height().into(), true)?;
                }
                #[cfg(feature = "transparent-inputs")]
                Recipient::InternalTransparent {
                    receiving_account,
                    recipient_address,
                } => {
                    let wto = WalletTransparentOutput::from_parts(
                        OutPoint::new(
                            sent_tx.tx().txid().into(),
                            u32::try_from(output.output_index())?,
                        ),
                        TxOut::new(output.value(), recipient_address.script().into()),
                        None,
                        Some(*receiving_account),
                        None,
                        Some(*sent_tx.funding_account()),
                    )
                    .ok_or_else(|| Error::CorruptedData("transparent output script".into()))?;
                    self.put_transparent_output(&wto, sent_tx.target_height().into(), true)?;
                }
            }
        }

        if !detectable_via_scanning {
            self.queue_tx_status(sent_tx.tx().txid())?;
        }
        Ok(tx_ref)
    }

    /// `check_ephemeral_address_reuse`: an ephemeral address may receive only once, except
    /// in the transaction being stored again.
    #[cfg(feature = "transparent-inputs")]
    fn check_ephemeral_address_reuse(&self, address: &TransparentAddress) -> Result<(), Error> {
        let Some((id, row)) = self.addresses.find_by_transparent_receiver(address) else {
            return Ok(());
        };
        if row.key_scope != KeyScope::Ephemeral {
            return Ok(());
        }
        let used_in: Vec<TxId> = self
            .transparent
            .iter()
            .filter(|o| o.address_id == id)
            .map(|o| *o.outpoint.txid())
            .collect();
        if used_in.is_empty() {
            Ok(())
        } else {
            Err(Error::Other(format!(
                "ephemeral address {} was already used in transaction(s) {:?}",
                zcash_keys::encoding::AddressCodec::encode(address, &self.params),
                used_in
            )))
        }
    }
}

impl<P: consensus::Parameters> WalletWrite for MemoryWalletDb<P> {
    #[cfg(feature = "transparent-inputs")]
    type UtxoRef = OutPoint;
    #[cfg(not(feature = "transparent-inputs"))]
    type UtxoRef = ();

    fn create_account(
        &mut self,
        account_name: &str,
        seed: &SecretVec<u8>,
        birthday: &AccountBirthday,
        key_source: Option<&str>,
    ) -> Result<(AccountId, UnifiedSpendingKey), Error> {
        let seed_fingerprint =
            SeedFingerprint::from_seed(seed.expose_secret()).ok_or(Error::InvalidSeedLength)?;
        let account_index = self
            .max_zip32_account_index(&seed_fingerprint)
            .map(|a| a.next().ok_or(Error::AccountOutOfRange))
            .transpose()?
            .unwrap_or(zip32::AccountId::ZERO);
        let usk = UnifiedSpendingKey::from_seed(&self.params, seed.expose_secret(), account_index)?;
        let ufvk = usk.to_unified_full_viewing_key();
        let account = self.transactionally(|db| {
            db.add_account_full(
                account_name,
                AccountSource::Derived {
                    derivation: Zip32Derivation::new(seed_fingerprint, account_index),
                    key_source: key_source.map(str::to_owned),
                },
                ufvk,
                birthday,
            )
        })?;
        Ok((account.id(), usk))
    }

    fn import_account_hd(
        &mut self,
        account_name: &str,
        seed: &SecretVec<u8>,
        account_index: zip32::AccountId,
        birthday: &AccountBirthday,
        key_source: Option<&str>,
    ) -> Result<(Self::Account, UnifiedSpendingKey), Error> {
        let seed_fingerprint =
            SeedFingerprint::from_seed(seed.expose_secret()).ok_or(Error::InvalidSeedLength)?;
        let usk = UnifiedSpendingKey::from_seed(&self.params, seed.expose_secret(), account_index)?;
        let ufvk = usk.to_unified_full_viewing_key();
        let account = self.transactionally(|db| {
            db.add_account_full(
                account_name,
                AccountSource::Derived {
                    derivation: Zip32Derivation::new(seed_fingerprint, account_index),
                    key_source: key_source.map(str::to_owned),
                },
                ufvk,
                birthday,
            )
        })?;
        Ok((account, usk))
    }

    fn import_account_ufvk(
        &mut self,
        account_name: &str,
        unified_key: &UnifiedFullViewingKey,
        birthday: &AccountBirthday,
        purpose: AccountPurpose,
        key_source: Option<&str>,
    ) -> Result<Self::Account, Error> {
        self.transactionally(|db| {
            db.add_account_full(
                account_name,
                AccountSource::Imported {
                    purpose,
                    key_source: key_source.map(str::to_owned),
                },
                unified_key.clone(),
                birthday,
            )
        })
    }

    fn delete_account(&mut self, account: AccountId) -> Result<(), Error> {
        self.transactionally(|db| db.delete_account_internal(account))
    }

    fn set_account_name(&mut self, account: AccountId, name: &str) -> Result<(), Error> {
        let a = self
            .accounts
            .get_mut(account)
            .ok_or(Error::AccountUnknown(account))?;
        a.name = Some(name.to_owned());
        Ok(())
    }

    #[cfg(feature = "transparent-key-import")]
    fn import_standalone_transparent_address(
        &mut self,
        _account: AccountId,
        _address: TransparentAddress,
    ) -> Result<(), Error> {
        Err(Error::Other(
            "importing standalone transparent addresses is not supported by this backend".into(),
        ))
    }

    #[cfg(feature = "transparent-key-import")]
    fn import_standalone_transparent_pubkey(
        &mut self,
        _account: AccountId,
        _pubkey: secp256k1::PublicKey,
    ) -> Result<(), Error> {
        Err(Error::Other(
            "importing standalone transparent keys is not supported by this backend".into(),
        ))
    }

    #[cfg(feature = "transparent-key-import")]
    fn import_standalone_transparent_script(
        &mut self,
        _account: AccountId,
        _script: zcash_script::script::Redeem,
    ) -> Result<(), Error> {
        Err(Error::Other(
            "importing standalone transparent scripts is not supported by this backend".into(),
        ))
    }

    fn get_next_available_address(
        &mut self,
        account: AccountId,
        request: UnifiedAddressRequest,
    ) -> Result<Option<(UnifiedAddress, DiversifierIndex)>, Error> {
        self.transactionally(|db| db.next_available_address(account, request))
    }

    fn get_address_for_index(
        &mut self,
        account: AccountId,
        diversifier_index: DiversifierIndex,
        request: UnifiedAddressRequest,
    ) -> Result<Option<UnifiedAddress>, Error> {
        let acct = self
            .accounts
            .get(account)
            .cloned()
            .ok_or(Error::AccountUnknown(account))?;
        match acct.uivk().address(diversifier_index, request) {
            Ok(address) => {
                let exposed = self.chain_tip_height().unwrap_or(acct.birthday().height());
                self.addresses.upsert_unified(
                    account,
                    diversifier_index,
                    &address,
                    Some(exposed),
                    true,
                )?;
                Ok(Some(address))
            }
            #[cfg(feature = "transparent-inputs")]
            Err(AddressGenerationError::InvalidTransparentChildIndex(_)) => Ok(None),
            Err(AddressGenerationError::InvalidSaplingDiversifierIndex(_)) => Ok(None),
            Err(e) => Err(Error::AddressGeneration(e)),
        }
    }

    fn update_chain_tip(&mut self, tip_height: BlockHeight) -> Result<(), Error> {
        self.transactionally(|db| db.update_chain_tip_internal(tip_height))
    }

    fn prune_scan_queue_below(
        &mut self,
        height: BlockHeight,
        retain_with_priority: Option<ScanPriority>,
    ) -> Result<u64, Error> {
        let mut queue = self.scan_queue.clone();
        let n = queue.prune_below(height, retain_with_priority)?;
        self.scan_queue = queue;
        Ok(n)
    }

    fn queue_rescan(&mut self, range: Range<BlockHeight>) -> Result<(), Error> {
        let mut queue = self.scan_queue.clone();
        queue.queue_rescan(range)?;
        self.scan_queue = queue;
        Ok(())
    }

    fn put_blocks(
        &mut self,
        from_state: &ChainState,
        blocks: Vec<ScannedBlock<AccountId>>,
    ) -> Result<(), Error> {
        let anchor_retention = self.anchor_retention();
        #[cfg(feature = "transparent-inputs")]
        let gap_limits = self.gap_limits;
        self.transactionally(|db| {
            ll_wallet::put_blocks::<_, Error, std::convert::Infallible>(
                db,
                #[cfg(feature = "transparent-inputs")]
                gap_limits,
                from_state,
                blocks,
                anchor_retention.as_ref(),
            )
            .map_err(|e| match e {
                ll_wallet::PutBlocksError::NonSequentialBlocks {
                    prev_height,
                    block_height,
                } => Error::Other(format!(
                    "blocks are non-sequential: {block_height} follows {prev_height}"
                )),
                ll_wallet::PutBlocksError::Storage(e) => e,
                ll_wallet::PutBlocksError::ShardTree(e) => Error::ShardTree(e),
                ll_wallet::PutBlocksError::ShardTreeForBlockRange {
                    pool,
                    block_range,
                    error,
                } => Error::Other(format!(
                    "{pool:?} note commitment tree update for blocks {block_range:?} failed: {error}"
                )),
                #[cfg(feature = "transparent-inputs")]
                ll_wallet::PutBlocksError::GapAddresses(e) => Error::from(e),
                // `PutBlocksError` is non-exhaustive.
                other => Error::Other(format!("put_blocks failed: {other:?}")),
            })
        })
    }

    fn put_received_transparent_utxo(
        &mut self,
        _output: &WalletTransparentOutput<AccountId>,
    ) -> Result<Self::UtxoRef, Error> {
        #[cfg(feature = "transparent-inputs")]
        return self.transactionally(|db| {
            let observed_height = db.mempool_height().ok_or(Error::ChainHeightUnknown)?;
            let (account_id, key_scope) =
                db.put_transparent_output(_output, observed_height.into(), true)?;
            if let Some(t_key_scope) = key_scope {
                let account = db
                    .accounts
                    .get(account_id)
                    .cloned()
                    .ok_or(Error::AccountUnknown(account_id))?;
                let gap_limits = db.gap_limits;
                generate_gap_addresses(
                    db,
                    &gap_limits,
                    account_id,
                    &account.uivk(),
                    Some(&account.ufvk),
                    t_key_scope,
                    UnifiedAddressRequest::unsafe_custom(Allow, Allow, Require),
                    true,
                )?;
            }
            Ok(_output.outpoint().clone())
        });

        #[cfg(not(feature = "transparent-inputs"))]
        Err(Error::Other(
            "transparent outputs require the transparent-inputs feature".into(),
        ))
    }

    fn store_decrypted_tx(
        &mut self,
        d_tx: DecryptedTransaction<zcash_primitives::transaction::Transaction, AccountId>,
    ) -> Result<(), Error> {
        let chain_tip = self.chain_tip_height().ok_or(Error::ChainHeightUnknown)?;
        let params = self.params.clone();
        #[cfg(feature = "transparent-inputs")]
        let gap_limits = self.gap_limits;
        self.transactionally(|db| {
            ll_wallet::store_decrypted_tx(
                db,
                &params,
                #[cfg(feature = "transparent-inputs")]
                gap_limits,
                chain_tip,
                d_tx,
            )
        })
    }

    fn set_tx_trust(&mut self, txid: TxId, trusted: bool) -> Result<(), Error> {
        // As zcash_client_sqlite's UPDATE: an unknown transaction is not an error.
        if self.tx_table.contains(&txid) {
            self.tx_table.set_trusted(&txid, trusted)?;
        }
        Ok(())
    }

    fn store_transactions_to_be_sent(
        &mut self,
        transactions: &[SentTransaction<AccountId>],
    ) -> Result<(), Error> {
        // As zcash_client_sqlite, the ZIP 318 classification of each stored transaction is
        // recorded from the same trial decryption the enhance path uses.
        #[cfg(feature = "orchard")]
        let ufvks = self.get_unified_full_viewing_keys()?;
        #[cfg(feature = "orchard")]
        let zip318 = self.pool_migration_params(&self.params);
        #[cfg(feature = "orchard")]
        let chain_tip = self.chain_tip_height();
        self.transactionally(|db| {
            for sent_tx in transactions {
                #[cfg_attr(not(feature = "orchard"), allow(unused_variables))]
                let tx_ref = db.store_transaction_to_be_sent(sent_tx)?;
                #[cfg(feature = "orchard")]
                {
                    let decrypted = zcash_client_backend::decrypt_transaction(
                        &db.params,
                        None,
                        chain_tip,
                        sent_tx.tx(),
                        &ufvks,
                    );
                    let classification = zcash_client_backend::data_api::zip318::classify_decrypted_tx(
                        sent_tx.tx(),
                        decrypted.orchard_outputs(),
                        decrypted.ironwood_outputs(),
                        &zip318,
                    );
                    db.put_zip318_classification(tx_ref, classification)?;
                }
            }
            Ok(())
        })
    }

    fn truncate_to_height(&mut self, max_height: BlockHeight) -> Result<BlockHeight, Error> {
        self.transactionally(|db| {
            let h = db.select_truncation_height(max_height)?;
            db.truncate_to_height_internal(h, h)
        })
    }

    fn truncate_to_chain_state(&mut self, chain_state: ChainState) -> Result<(), Error> {
        self.transactionally(|db| db.truncate_to_chain_state_internal(chain_state))
    }

    fn rewind_to_chain_state(
        &mut self,
        chain_state: ChainState,
        reset_account_birthdays: HashSet<AccountId>,
    ) -> Result<(), RewindError<AccountId, Error>> {
        let backup = self.snapshot();
        match self.rewind_to_chain_state_internal(&chain_state, reset_account_birthdays) {
            Ok(()) => Ok(()),
            Err(e) => {
                *self = backup;
                Err(e)
            }
        }
    }

    #[cfg(feature = "transparent-inputs")]
    fn reserve_next_n_ephemeral_addresses(
        &mut self,
        account_id: AccountId,
        n: usize,
    ) -> Result<Vec<(TransparentAddress, TransparentAddressMetadata)>, Error> {
        let gap_limit = self.gap_limits.ephemeral();
        self.transactionally(|db| db.reserve_next_n_addresses(account_id, KeyScope::Ephemeral, gap_limit, n))
    }

    #[cfg(feature = "transparent-inputs")]
    fn reserve_next_n_internal_addresses(
        &mut self,
        account_id: AccountId,
        n: usize,
    ) -> Result<Vec<(TransparentAddress, TransparentAddressMetadata)>, Error> {
        let gap_limit = self.gap_limits.internal();
        self.transactionally(|db| db.reserve_next_n_addresses(account_id, KeyScope::Internal, gap_limit, n))
    }

    fn set_transaction_status(
        &mut self,
        txid: TxId,
        status: TransactionStatus,
    ) -> Result<(), Error> {
        self.transactionally(|db| LowLevelWalletWrite::set_transaction_status(db, txid, status))
    }

    #[cfg(feature = "transparent-inputs")]
    fn schedule_next_check(
        &mut self,
        _address: &TransparentAddress,
        _offset_seconds: u32,
    ) -> Result<Option<std::time::SystemTime>, Error> {
        // Scheduling needs a randomness source and a clock this backend does not hold;
        // Celari does not use privacy-preserving UTXO checks.
        Err(Error::Other(
            "schedule_next_check is not supported by this backend".into(),
        ))
    }

    #[cfg(feature = "transparent-inputs")]
    fn mark_transparent_addresses_exposed(
        &mut self,
        exposures: &[(TransparentAddress, BlockHeight)],
    ) -> Result<(), Error> {
        self.transactionally(|db| {
            for (address, height) in exposures {
                let (id, _) = db
                    .addresses
                    .find_by_transparent_receiver(address)
                    .ok_or(Error::AddressNotRecognized(*address))?;
                db.addresses.mark_exposed(id, *height);
            }
            Ok(())
        })
    }

    #[cfg(feature = "transparent-inputs")]
    fn notify_address_checked(
        &mut self,
        request: TransactionsInvolvingAddress,
        as_of_height: BlockHeight,
    ) -> Result<(), Error> {
        if let Some(requested_end) = request.block_range_end() {
            if as_of_height != requested_end - 1 {
                return Err(Error::Other(format!(
                    "address check notification at {as_of_height} does not match the requested range end {requested_end}"
                )));
            }
        }
        self.update_observed_unspent_heights(request.address(), as_of_height)
    }
}
