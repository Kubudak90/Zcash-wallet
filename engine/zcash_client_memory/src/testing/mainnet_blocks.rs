//! Scans 109 real mainnet compact blocks past NU6.3 (382 Ironwood actions) into a
//! [`MemoryWalletDb`] through `scan_cached_blocks` (so through upstream's
//! `ll::wallet::put_blocks`), and checks the resulting note commitment trees of all three
//! pools against the lightwalletd frontiers. See `testdata/mainnet-3533400/README.md`.

use std::time::{Duration, Instant};

use incrementalmerkletree::Address;
use orchard::tree::MerkleHashOrchard;
use prost::Message;
use secrecy::SecretVec;
use shardtree::{ShardTree, store::memory::MemoryShardStore};
use zcash_primitives::merkle_tree::HashSer;
use zcash_client_backend::{
    data_api::{
        AccountBirthday, WalletCommitmentTrees, WalletRead, WalletWrite,
        chain::{ChainState, CommitmentTreeRoot, scan_cached_blocks},
        scanning::ScanPriority, wallet::ConfirmationsPolicy,
    },
    proto::{
        compact_formats::CompactBlock,
        service::{SubtreeRoot, TreeState},
    },
};
use zcash_protocol::{
    ShieldedPool,
    consensus::{BlockHeight, Network},
};

use crate::{MemBlockCache, MemoryWalletDb, PRUNING_DEPTH};

const BLOCKS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/testdata/mainnet-3533400/blocks-3533400-3533508.grpcweb"
));
const TREESTATE_3533399: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/testdata/mainnet-3533400/treestate-3533399.grpcweb"
));
const TREESTATE_3533450: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/testdata/mainnet-3533400/treestate-3533450.grpcweb"
));
const TREESTATE_3533508: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/testdata/mainnet-3533400/treestate-3533508.grpcweb"
));

const SUBTREES_SAPLING: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/testdata/mainnet-3533400/subtree-roots-sapling.grpcweb"
));
const SUBTREES_ORCHARD: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/testdata/mainnet-3533400/subtree-roots-orchard.grpcweb"
));
const SUBTREES_IRONWOOD: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/testdata/mainnet-3533400/subtree-roots-ironwood.grpcweb"
));

const FIRST: u32 = 3_533_400;
const MIDDLE: u32 = 3_533_450;
const LAST: u32 = 3_533_508;

/// The data frames (flag 0) of a gRPC-web response body; the trailer must report success.
fn grpcweb_messages(body: &[u8]) -> Vec<&[u8]> {
    let mut out = vec![];
    let mut trailer_ok = false;
    let mut i = 0;
    while i < body.len() {
        assert!(i + 5 <= body.len(), "truncated gRPC-web frame header");
        let flag = body[i];
        let len = u32::from_be_bytes(body[i + 1..i + 5].try_into().unwrap()) as usize;
        let payload = &body[i + 5..i + 5 + len];
        match flag {
            0 => out.push(payload),
            0x80 => trailer_ok = payload.starts_with(b"grpc-status: 0"),
            other => panic!("unexpected gRPC-web frame flag {other:#x}"),
        }
        i += 5 + len;
    }
    assert!(trailer_ok, "the response does not end with grpc-status 0");
    out
}

fn chain_state(body: &[u8]) -> ChainState {
    let messages = grpcweb_messages(body);
    assert_eq!(messages.len(), 1);
    TreeState::decode(messages[0])
        .expect("a TreeState message")
        .to_chain_state()
        .expect("a valid tree state")
}

fn block_cache() -> MemBlockCache {
    let cache = MemBlockCache::new();
    {
        let mut blocks = cache.0.write().unwrap();
        for message in grpcweb_messages(BLOCKS) {
            let block = CompactBlock::decode(message).expect("a CompactBlock message");
            blocks.insert(block.height(), block);
        }
    }
    cache
}

/// The roots of the wallet's Sapling, Orchard and Ironwood trees as of the end of block
/// `height`.
///
/// Scanning checkpoints a block only at its last note commitment (and `put_blocks` gives every
/// tree the union of the checkpoint heights), so a block without shielded outputs in any pool
/// has no checkpoint of its own; the trees as of its end are the trees at the greatest
/// checkpoint below it. The three trees must hold the same checkpoint heights.
fn roots_at(
    db: &MemoryWalletDb<Network>,
    height: u32,
) -> (sapling::Node, orchard::tree::MerkleHashOrchard, orchard::tree::MerkleHashOrchard) {
    let ids = db.pool_checkpoint_ids(ShieldedPool::Sapling);
    assert_eq!(ids, db.pool_checkpoint_ids(ShieldedPool::Orchard));
    assert_eq!(ids, db.pool_checkpoint_ids(ShieldedPool::Ironwood));
    let h = ids
        .into_iter()
        .filter(|c| u32::from(*c) <= height)
        .max()
        .expect("a checkpoint at or below the height");
    (
        db.sapling.tree.root_at_checkpoint_id(&h).unwrap().expect("a Sapling checkpoint"),
        db.orchard.tree.root_at_checkpoint_id(&h).unwrap().expect("an Orchard checkpoint"),
        db.ironwood.tree.root_at_checkpoint_id(&h).unwrap().expect("an Ironwood checkpoint"),
    )
}

fn frontier_roots(
    state: &ChainState,
) -> (sapling::Node, orchard::tree::MerkleHashOrchard, orchard::tree::MerkleHashOrchard) {
    (
        state.final_sapling_tree().root(),
        state.final_orchard_tree().root(),
        state.final_ironwood_tree().root(),
    )
}

#[test]
fn scans_real_ironwood_blocks_and_matches_server_frontiers() {
    let network = Network::MainNetwork;
    let s_first = chain_state(TREESTATE_3533399);
    let s_middle = chain_state(TREESTATE_3533450);
    let s_last = chain_state(TREESTATE_3533508);
    assert_eq!(u32::from(s_first.block_height()), FIRST - 1);
    assert_eq!(u32::from(s_middle.block_height()), MIDDLE);
    assert_eq!(u32::from(s_last.block_height()), LAST);

    let cache = block_cache();
    {
        // The fixture is consistent: the blocks chain onto each other and onto the tree
        // states, and their tree sizes are the frontiers' sizes.
        let blocks = cache.0.read().unwrap();
        assert_eq!(blocks.len(), (LAST - FIRST + 1) as usize);
        let mut prev_hash = s_first.block_hash();
        for (h, block) in blocks.iter() {
            assert_eq!(block.prev_hash(), prev_hash, "block {h} does not chain");
            prev_hash = block.hash();
            for state in [&s_middle, &s_last] {
                if *h == state.block_height() {
                    assert_eq!(block.hash(), state.block_hash());
                    let meta = block.chain_metadata.as_ref().unwrap();
                    assert_eq!(
                        u64::from(meta.sapling_commitment_tree_size),
                        state.final_sapling_tree().tree_size()
                    );
                    assert_eq!(
                        u64::from(meta.orchard_commitment_tree_size),
                        state.final_orchard_tree().tree_size()
                    );
                    assert_eq!(
                        u64::from(meta.ironwood_commitment_tree_size),
                        state.final_ironwood_tree().tree_size()
                    );
                }
            }
        }
        let ironwood_actions: usize = blocks
            .values()
            .flat_map(|b| b.vtx.iter())
            .map(|tx| tx.ironwood_actions.len())
            .sum();
        assert_eq!(ironwood_actions, 382);
    }

    let mut db = MemoryWalletDb::new(network, PRUNING_DEPTH as usize);
    let seed = SecretVec::new(vec![7u8; 32]);
    let birthday = AccountBirthday::from_parts(s_first.clone(), None);
    let (account_id, _usk) = db.create_account("test", &seed, &birthday, None).unwrap();
    db.update_chain_tip(BlockHeight::from_u32(LAST)).unwrap();

    // The chain tip range first, then the rest, as a wallet syncs.
    scan_cached_blocks(
        &network,
        &cache,
        &mut db,
        BlockHeight::from_u32(MIDDLE + 1),
        &s_middle,
        (LAST - MIDDLE) as usize,
    )
    .unwrap();
    assert_eq!(roots_at(&db, LAST), frontier_roots(&s_last));
    scan_cached_blocks(
        &network,
        &cache,
        &mut db,
        BlockHeight::from_u32(FIRST),
        &s_first,
        (MIDDLE - FIRST + 1) as usize,
    )
    .unwrap();

    assert_eq!(roots_at(&db, MIDDLE), frontier_roots(&s_middle));
    assert_eq!(roots_at(&db, LAST), frontier_roots(&s_last));
    assert_eq!(
        db.block_max_scanned().unwrap().map(|m| u32::from(m.block_height())),
        Some(LAST)
    );
    assert_eq!(
        db.block_fully_scanned().unwrap().map(|m| u32::from(m.block_height())),
        Some(LAST)
    );
    let tip_meta = db.block_metadata(BlockHeight::from_u32(LAST)).unwrap().unwrap();
    assert_eq!(
        tip_meta.ironwood_tree_size().map(u64::from),
        Some(s_last.final_ironwood_tree().tree_size())
    );
    assert!(
        db.suggest_scan_ranges()
            .unwrap()
            .iter()
            .all(|r| r.priority() <= ScanPriority::Scanned),
        "everything from the birthday to the tip is scanned"
    );

    let summary = db
        .get_wallet_summary(ConfirmationsPolicy::default())
        .unwrap()
        .expect("a summary once the chain tip is known");
    assert_eq!(u32::from(summary.chain_tip_height()), LAST);
    assert_eq!(u32::from(summary.fully_scanned_height()), LAST);
    let balance = summary.account_balances().get(&account_id).unwrap();
    assert!(balance.total().is_zero(), "a fresh key owns nothing in these blocks");
    let progress = summary.progress().scan();
    assert_eq!(progress.numerator(), progress.denominator());

    // A save and load keeps every tree and table.
    let mut bytes = vec![];
    db.encode(&mut bytes).unwrap();
    let decoded = MemoryWalletDb::decode_new(&bytes, network, PRUNING_DEPTH as usize).unwrap();
    let mut again = vec![];
    decoded.encode(&mut again).unwrap();
    assert!(bytes == again);
    assert_eq!(roots_at(&decoded, LAST), frontier_roots(&s_last));

    // Rewinding to a retained checkpoint and rescanning gives the same trees.
    let truncated = db.truncate_to_height(BlockHeight::from_u32(MIDDLE)).unwrap();
    assert_eq!(u32::from(truncated), MIDDLE);
    assert_eq!(
        db.block_max_scanned().unwrap().map(|m| u32::from(m.block_height())),
        Some(MIDDLE)
    );
    // As in zcash_client_sqlite, truncation trims the scan queue to the truncation height
    // (the wallet's view of the chain tip goes back with it); the next chain tip update
    // queues the truncated blocks again.
    assert!(
        db.suggest_scan_ranges()
            .unwrap()
            .iter()
            .all(|r| u32::from(r.block_range().end) <= MIDDLE + 1),
        "nothing above the truncation height is queued"
    );
    db.update_chain_tip(BlockHeight::from_u32(LAST)).unwrap();
    assert!(
        db.suggest_scan_ranges()
            .unwrap()
            .iter()
            .any(|r| r.priority() > ScanPriority::Scanned
                && r.block_range().contains(&BlockHeight::from_u32(MIDDLE + 1))
                && r.block_range().contains(&BlockHeight::from_u32(LAST))),
        "the truncated blocks are queued for rescanning after the chain tip update"
    );
    scan_cached_blocks(
        &network,
        &cache,
        &mut db,
        BlockHeight::from_u32(MIDDLE + 1),
        &s_middle,
        (LAST - MIDDLE) as usize,
    )
    .unwrap();
    assert_eq!(roots_at(&db, LAST), frontier_roots(&s_last));
}

/// The subtree roots of a `GetSubtreeRoots` response.
fn subtree_roots<H: HashSer>(body: &[u8]) -> Vec<CommitmentTreeRoot<H>> {
    grpcweb_messages(body)
        .into_iter()
        .map(|message| {
            let root = SubtreeRoot::decode(message).expect("a SubtreeRoot message");
            CommitmentTreeRoot::from_parts(
                BlockHeight::from_u32(u32::try_from(root.completing_block_height).unwrap()),
                H::read(&root.root_hash[..]).expect("a valid root hash"),
            )
        })
        .collect()
}

/// What `put_*_subtree_roots` did before it skipped the roots a tree already holds:
/// `ShardTree::insert` for every root.
fn insert_every_root<H, const DEPTH: u8, const SHARD_HEIGHT: u8>(
    tree: &mut ShardTree<MemoryShardStore<H, BlockHeight>, DEPTH, SHARD_HEIGHT>,
    roots: &[CommitmentTreeRoot<H>],
) where
    H: incrementalmerkletree::Hashable + Clone + PartialEq,
{
    for (root, index) in roots.iter().zip(0u64..) {
        tree.insert(Address::from_parts(SHARD_HEIGHT.into(), index), root.root_hash().clone())
            .unwrap();
    }
}

fn encoded(db: &MemoryWalletDb<Network>) -> Vec<u8> {
    let mut bytes = vec![];
    db.encode(&mut bytes).unwrap();
    bytes
}

/// `sync::run` sends every subtree root again on every pass. Putting them again must change
/// nothing, live and after a save and load (unlocking the wallet), must give the same
/// wallet as inserting each through `ShardTree::insert`, must stay cheap (that insert
/// recomputes every value the cap holds above a root once its siblings are complete, which
/// cost minutes per pass in the browser), and a root that differs from the tree's must still
/// be refused.
#[test]
fn subtree_roots_put_again_change_nothing() {
    let network = Network::MainNetwork;
    let s_first = chain_state(TREESTATE_3533399);
    let s_middle = chain_state(TREESTATE_3533450);
    let s_last = chain_state(TREESTATE_3533508);
    let sapling_roots = subtree_roots::<sapling::Node>(SUBTREES_SAPLING);
    let orchard_roots = subtree_roots::<MerkleHashOrchard>(SUBTREES_ORCHARD);
    let ironwood_roots = subtree_roots::<MerkleHashOrchard>(SUBTREES_IRONWOOD);
    assert_eq!((sapling_roots.len(), orchard_roots.len(), ironwood_roots.len()), (1129, 770, 14));
    let put_all = |db: &mut MemoryWalletDb<Network>| {
        let t = Instant::now();
        db.put_sapling_subtree_roots(0, &sapling_roots).unwrap();
        db.put_orchard_subtree_roots(0, &orchard_roots).unwrap();
        db.put_ironwood_subtree_roots(0, &ironwood_roots).unwrap();
        t.elapsed()
    };

    // As a wallet syncs: account with the birthday frontier, subtree roots, chain tip, blocks.
    let cache = block_cache();
    let mut db = MemoryWalletDb::new(network, PRUNING_DEPTH as usize);
    let seed = SecretVec::new(vec![7u8; 32]);
    let birthday = AccountBirthday::from_parts(s_first.clone(), None);
    db.create_account("test", &seed, &birthday, None).unwrap();
    let first_put = put_all(&mut db);
    db.update_chain_tip(BlockHeight::from_u32(LAST)).unwrap();
    for (from, state, count) in [(MIDDLE + 1, &s_middle, LAST - MIDDLE), (FIRST, &s_first, MIDDLE - FIRST + 1)] {
        scan_cached_blocks(&network, &cache, &mut db, BlockHeight::from_u32(from), state, count as usize)
            .unwrap();
    }
    assert_eq!(roots_at(&db, MIDDLE), frontier_roots(&s_middle));
    assert_eq!(roots_at(&db, LAST), frontier_roots(&s_last));
    let before = encoded(&db);

    // The next pass in the same session.
    let second_put = put_all(&mut db);
    assert!(encoded(&db) == before, "putting the same roots again changed the wallet");

    // The first pass after a save and load.
    let mut loaded = MemoryWalletDb::decode_new(&before, network, PRUNING_DEPTH as usize).unwrap();
    let put_after_load = put_all(&mut loaded);
    assert!(encoded(&loaded) == before, "putting the same roots after a load changed the wallet");
    assert_eq!(roots_at(&loaded, LAST), frontier_roots(&s_last));

    // The same wallet as inserting every root through ShardTree::insert, only slower.
    let mut reinserted = MemoryWalletDb::decode_new(&before, network, PRUNING_DEPTH as usize).unwrap();
    let t = Instant::now();
    insert_every_root(&mut reinserted.sapling.tree, &sapling_roots);
    insert_every_root(&mut reinserted.orchard.tree, &orchard_roots);
    insert_every_root(&mut reinserted.ironwood.tree, &ironwood_roots);
    let via_insert = t.elapsed();
    assert!(encoded(&reinserted) == before, "ShardTree::insert of the same roots changed the wallet");

    eprintln!(
        "subtree roots: first put {first_put:?}, again {second_put:?}, after load {put_after_load:?}; \
         every root through ShardTree::insert {via_insert:?}"
    );
    assert!(
        second_put + put_after_load < Duration::from_secs(5),
        "putting known roots again took {second_put:?} and {put_after_load:?}"
    );

    // A root that differs from the one the tree holds is checked, and refused.
    let wrong = [CommitmentTreeRoot::from_parts(
        sapling_roots[0].subtree_end_height(),
        sapling_roots[1].root_hash().clone(),
    )];
    assert!(loaded.put_sapling_subtree_roots(0, &wrong).is_err());
    let wrong = [CommitmentTreeRoot::from_parts(
        ironwood_roots[3].subtree_end_height(),
        ironwood_roots[4].root_hash().clone(),
    )];
    assert!(loaded.put_ironwood_subtree_roots(3, &wrong).is_err());
}

/// A `put_*_subtree_roots` call that fails part-way leaves the wallet as it was (review
/// finding R6; zcash_client_sqlite runs these inserts in one SQL transaction). The wallet is
/// the synced one of `subtree_roots_put_again_change_nothing` (all real roots, all blocks).
/// The call's first root has the tree's root value but a later completing height (which the
/// wallet records, as it would after a reorg at the end of a subtree); its second root is
/// wrong and refused. Nothing of the call may stay behind.
#[test]
fn subtree_roots_put_that_fails_changes_nothing() {
    let network = Network::MainNetwork;
    let s_first = chain_state(TREESTATE_3533399);
    let s_middle = chain_state(TREESTATE_3533450);
    let sapling_roots = subtree_roots::<sapling::Node>(SUBTREES_SAPLING);
    let orchard_roots = subtree_roots::<MerkleHashOrchard>(SUBTREES_ORCHARD);
    let ironwood_roots = subtree_roots::<MerkleHashOrchard>(SUBTREES_IRONWOOD);

    let cache = block_cache();
    let mut db = MemoryWalletDb::new(network, PRUNING_DEPTH as usize);
    let seed = SecretVec::new(vec![7u8; 32]);
    db.create_account("test", &seed, &AccountBirthday::from_parts(s_first.clone(), None), None)
        .unwrap();
    db.put_sapling_subtree_roots(0, &sapling_roots).unwrap();
    db.put_orchard_subtree_roots(0, &orchard_roots).unwrap();
    db.put_ironwood_subtree_roots(0, &ironwood_roots).unwrap();
    db.update_chain_tip(BlockHeight::from_u32(LAST)).unwrap();
    for (from, state, count) in [(MIDDLE + 1, &s_middle, LAST - MIDDLE), (FIRST, &s_first, MIDDLE - FIRST + 1)] {
        scan_cached_blocks(&network, &cache, &mut db, BlockHeight::from_u32(from), state, count as usize)
            .unwrap();
    }
    let before = encoded(&db);
    let ironwood_end_2 = db.ironwood.subtrees.get(&2).unwrap().end_height;

    let roots = [
        CommitmentTreeRoot::from_parts(
            ironwood_roots[2].subtree_end_height() + 1,
            ironwood_roots[2].root_hash().clone(),
        ),
        CommitmentTreeRoot::from_parts(
            ironwood_roots[3].subtree_end_height(),
            ironwood_roots[4].root_hash().clone(),
        ),
    ];
    assert!(db.put_ironwood_subtree_roots(2, &roots).is_err(), "the wrong root 3 is refused");
    assert_eq!(
        db.ironwood.subtrees.get(&2).unwrap().end_height,
        ironwood_end_2,
        "root 2 of the failed call is not recorded"
    );
    assert!(encoded(&db) == before, "a failed put of Ironwood roots changed the wallet");

    let sapling_end_0 = db.sapling.subtrees.get(&0).unwrap().end_height;
    let roots = [
        CommitmentTreeRoot::from_parts(sapling_roots[0].subtree_end_height() + 1, *sapling_roots[0].root_hash()),
        CommitmentTreeRoot::from_parts(sapling_roots[1].subtree_end_height(), *sapling_roots[2].root_hash()),
    ];
    assert!(db.put_sapling_subtree_roots(0, &roots).is_err(), "the wrong root 1 is refused");
    assert_eq!(db.sapling.subtrees.get(&0).unwrap().end_height, sapling_end_0);
    assert!(encoded(&db) == before, "a failed put of Sapling roots changed the wallet");

    // A call without a wrong root still records the new completing height.
    db.put_ironwood_subtree_roots(2, &roots_from(&ironwood_roots[2..3], 1)).unwrap();
    assert_eq!(db.ironwood.subtrees.get(&2).unwrap().end_height, ironwood_end_2 + 1);
}

/// `roots` with every completing height moved up by `delta`.
fn roots_from(roots: &[CommitmentTreeRoot<MerkleHashOrchard>], delta: u32) -> Vec<CommitmentTreeRoot<MerkleHashOrchard>> {
    roots
        .iter()
        .map(|r| CommitmentTreeRoot::from_parts(r.subtree_end_height() + delta, r.root_hash().clone()))
        .collect()
}
