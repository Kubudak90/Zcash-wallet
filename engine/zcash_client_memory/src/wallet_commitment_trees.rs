//! `WalletCommitmentTrees`: the Sapling, Orchard and Ironwood note commitment trees.
//!
//! The Ironwood tree is Orchard-shaped but separate. zcash_client_backend's default
//! `with_ironwood_tree_mut` reports "no Ironwood tree", which would silently drop Ironwood
//! commitments during `put_blocks` and make Ironwood notes unspendable, so it is
//! overridden here, as are the Ironwood subtree root methods.

use std::convert::Infallible;

use incrementalmerkletree::Address;
use shardtree::{
    ShardTree,
    error::ShardTreeError,
    store::{ShardStore, memory::MemoryShardStore},
};
use zcash_client_backend::data_api::{
    SAPLING_SHARD_HEIGHT, WalletCommitmentTrees, chain::CommitmentTreeRoot,
};
use zcash_protocol::consensus::{self, BlockHeight};

#[cfg(feature = "orchard")]
use zcash_client_backend::data_api::ORCHARD_SHARD_HEIGHT;

use crate::{MemoryWalletDb, types::memory_wallet::{PoolTree, SubtreeInfo}};

/// Whether the shard of `tree` at `shard_addr` is stored with `root` as its root value.
///
/// The cap only caches values above the shard level (it keeps no node at a shard's address
/// once a value above it is known, such as a frontier ommer), and the tree reads a shard's
/// root from the stored shard where the cap holds none, so a stored shard with this root is
/// what `ShardTree::insert(shard_addr, root)` would leave behind.
fn holds_shard_root<H, const DEPTH: u8, const SHARD_HEIGHT: u8>(
    tree: &ShardTree<MemoryShardStore<H, BlockHeight>, DEPTH, SHARD_HEIGHT>,
    shard_addr: Address,
    root: &H,
) -> Result<bool, ShardTreeError<Infallible>>
where
    H: incrementalmerkletree::Hashable + Clone + PartialEq,
{
    Ok(tree
        .store()
        .get_shard(shard_addr)
        .map_err(ShardTreeError::Storage)?
        .is_some_and(|shard| shard.root().node_value() == Some(root)))
}

/// Inserts server-provided subtree roots into a tree and records them (with the height
/// of the block that completed each subtree) for `get_*_subtree_root` and scan range
/// extension (`put_shard_roots` in zcash_client_sqlite).
///
/// `zcash_client_backend::sync::run` sends every subtree root again on every pass.
/// `ShardTree::insert` (shardtree 0.8) checks each inserted root against every value the
/// cap holds above it (such as the birthday frontier's ommers), recomputing those from the
/// sibling subtrees whenever they are complete: once all roots are present, each insert
/// hashes on the order of the number of shards, so a pass over 1,129 Sapling and 770 Orchard
/// roots cost ~4 minutes in the browser. A root whose shard is already stored with that
/// root value is skipped: inserting it again would change nothing (the mainnet test
/// `subtree_roots_put_again_change_nothing` checks that the saved wallet is byte-identical
/// to one where every root went through `insert`). Every other root (new, different, or
/// whose shard is missing or has no root value) still goes through the checked `insert`,
/// so a conflicting root is still an error. (zcash_client_sqlite instead batch-inserts the
/// roots into the cap without these checks.)
///
/// Callers run it inside `transactionally`, so a call that fails part-way (a refused root
/// after some were inserted) leaves the wallet as it was, as sqlite's SQL transaction does.
fn put_roots<H, const DEPTH: u8, const SHARD_HEIGHT: u8>(
    pool_tree: &mut PoolTree<ShardTree<MemoryShardStore<H, BlockHeight>, DEPTH, SHARD_HEIGHT>, H>,
    start_index: u64,
    roots: &[CommitmentTreeRoot<H>],
) -> Result<(), ShardTreeError<Infallible>>
where
    H: incrementalmerkletree::Hashable + Clone + PartialEq,
{
    for (root, i) in roots.iter().zip(0u64..) {
        let index = start_index + i;
        let root_addr = Address::from_parts(SHARD_HEIGHT.into(), index);
        if !holds_shard_root(&pool_tree.tree, root_addr, root.root_hash())? {
            pool_tree.tree.insert(root_addr, root.root_hash().clone())?;
        }
        pool_tree.subtrees.insert(
            index,
            SubtreeInfo {
                root: root.root_hash().clone(),
                end_height: root.subtree_end_height(),
            },
        );
    }
    Ok(())
}

impl<P: consensus::Parameters> WalletCommitmentTrees for MemoryWalletDb<P> {
    type Error = Infallible;
    type SaplingShardStore<'a> = MemoryShardStore<sapling::Node, BlockHeight>;

    fn with_sapling_tree_mut<F, A, E>(&mut self, mut callback: F) -> Result<A, E>
    where
        for<'a> F: FnMut(
            &'a mut ShardTree<
                Self::SaplingShardStore<'a>,
                { sapling::NOTE_COMMITMENT_TREE_DEPTH },
                SAPLING_SHARD_HEIGHT,
            >,
        ) -> Result<A, E>,
        E: From<ShardTreeError<Infallible>>,
    {
        callback(&mut self.sapling.tree)
    }

    fn put_sapling_subtree_roots(
        &mut self,
        start_index: u64,
        roots: &[CommitmentTreeRoot<sapling::Node>],
    ) -> Result<(), ShardTreeError<Self::Error>> {
        self.transactionally(|db| put_roots(&mut db.sapling, start_index, roots))
    }

    fn get_sapling_subtree_root(
        &mut self,
        index: u64,
    ) -> Result<Option<sapling::Node>, ShardTreeError<Self::Error>> {
        Ok(self.sapling.subtrees.get(&index).map(|s| s.root))
    }

    #[cfg(feature = "orchard")]
    type OrchardShardStore<'a> = MemoryShardStore<orchard::tree::MerkleHashOrchard, BlockHeight>;

    #[cfg(feature = "orchard")]
    fn with_orchard_tree_mut<F, A, E>(&mut self, mut callback: F) -> Result<A, E>
    where
        for<'a> F: FnMut(
            &'a mut ShardTree<
                Self::OrchardShardStore<'a>,
                { ORCHARD_SHARD_HEIGHT * 2 },
                ORCHARD_SHARD_HEIGHT,
            >,
        ) -> Result<A, E>,
        E: From<ShardTreeError<Self::Error>>,
    {
        callback(&mut self.orchard.tree)
    }

    #[cfg(feature = "orchard")]
    fn put_orchard_subtree_roots(
        &mut self,
        start_index: u64,
        roots: &[CommitmentTreeRoot<orchard::tree::MerkleHashOrchard>],
    ) -> Result<(), ShardTreeError<Self::Error>> {
        self.transactionally(|db| put_roots(&mut db.orchard, start_index, roots))
    }

    #[cfg(feature = "orchard")]
    fn get_orchard_subtree_root(
        &mut self,
        index: u64,
    ) -> Result<Option<orchard::tree::MerkleHashOrchard>, ShardTreeError<Self::Error>> {
        Ok(self.orchard.subtrees.get(&index).map(|s| s.root))
    }

    #[cfg(feature = "orchard")]
    fn with_ironwood_tree_mut<F, A, E>(&mut self, mut callback: F) -> Result<Option<A>, E>
    where
        for<'a> F: FnMut(
            &'a mut ShardTree<
                Self::OrchardShardStore<'a>,
                { ORCHARD_SHARD_HEIGHT * 2 },
                ORCHARD_SHARD_HEIGHT,
            >,
        ) -> Result<A, E>,
        E: From<ShardTreeError<Self::Error>>,
    {
        callback(&mut self.ironwood.tree).map(Some)
    }

    #[cfg(feature = "orchard")]
    fn put_ironwood_subtree_roots(
        &mut self,
        start_index: u64,
        roots: &[CommitmentTreeRoot<orchard::tree::MerkleHashOrchard>],
    ) -> Result<(), ShardTreeError<Self::Error>> {
        self.transactionally(|db| put_roots(&mut db.ironwood, start_index, roots))
    }

    #[cfg(feature = "orchard")]
    fn get_ironwood_subtree_root(
        &mut self,
        index: u64,
    ) -> Result<Option<orchard::tree::MerkleHashOrchard>, ShardTreeError<Self::Error>> {
        Ok(self.ironwood.subtrees.get(&index).map(|s| s.root))
    }
}
