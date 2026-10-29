//! Verifier finding M3: the nullifier and transaction locator maps a restore fills while it
//! scans the chain-tip range out of order are pruned in the same batch that completes the scan,
//! not only when the next block is scanned.

use zcash_client_backend::data_api::{
    WalletRead,
    testing::{
        AddressType, TestBuilder,
        orchard::OrchardPoolTester,
        pool::ShieldedPoolTester,
    },
    ll::LowLevelWalletRead,
};
use zcash_primitives::block::BlockHash;
use zcash_protocol::value::Zatoshis;

use crate::{MemBlockCache, PRUNING_DEPTH, testing::TestMemDbFactory};

/// 400 blocks, each with an Orchard action paid to someone else (one nullifier each), scanned
/// as a restore does: the upper 300 first (out of order, so every one of their nullifiers is
/// kept in case a note found below is spent there), then the lower 100, which completes the
/// scan. From then on only the last `PRUNING_DEPTH` blocks' entries are needed; before the fix
/// all 300 blocks' entries stayed in the wallet (and in every save) until another block was
/// scanned.
#[test]
fn spend_maps_are_pruned_by_the_batch_that_completes_the_scan() {
    let mut st = TestBuilder::new()
        .with_data_store_factory(TestMemDbFactory::new())
        .with_block_cache(MemBlockCache::new())
        .with_account_from_sapling_activation(BlockHash([0; 32]))
        .build();
    let other = OrchardPoolTester::sk_to_fvk(&OrchardPoolTester::sk(&[0xf5; 32]));
    let mut heights = vec![];
    for _ in 0..400 {
        let (h, _, _) = st.generate_next_block(&other, AddressType::DefaultExternal, Zatoshis::const_from_u64(10_000));
        heights.push(h);
    }
    let (first, last) = (heights[0], heights[399]);

    st.scan_cached_blocks(heights[100], 300);
    let out_of_order = st.wallet().spend_maps.len();
    // Nothing below the upper range is scanned yet (the birthday block's predecessor is not a
    // stored block, so no fully scanned block is reported).
    assert_eq!(st.wallet().block_fully_scanned_height().unwrap(), None);
    st.scan_cached_blocks(first, 100);
    assert_eq!(st.wallet().block_fully_scanned_height().unwrap(), Some(last));
    let completed = st.wallet().spend_maps.len();
    let lowest = st.wallet().spend_maps.lowest_height();
    eprintln!(
        "spend maps (locators, nullifiers): {out_of_order:?} after the upper 300 blocks, \
         {completed:?} once the scan completed (lowest height {lowest:?}, fully scanned {last})"
    );
    assert!(out_of_order.1 >= 300, "{out_of_order:?}");
    // Entries below the fully scanned height minus the pruning depth are gone.
    assert!(lowest.is_some_and(|h| h >= last - PRUNING_DEPTH), "lowest entry at {lowest:?}");
    assert!(completed.1 <= PRUNING_DEPTH as usize + 1, "{completed:?}");
}
