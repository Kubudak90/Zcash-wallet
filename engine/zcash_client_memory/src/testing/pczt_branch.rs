//! The PCZT a send builds once NU6.3 is active, and again once NU7 is, through the calls
//! and parameters webzjs-wallet's `Wallet::pczt_create` uses
//! (`webzjs/crates/webzjs-wallet/src/wallet.rs`): `propose_transfer` with
//! `SpendPolicy::default()`, no input locks and no forced transaction version (what
//! `TestState::propose_transfer` passes), webzjs's change strategy (ZIP 317,
//! `MultiOutputChangeStrategy`, change pool Ironwood from NU6.3, split into up to 4 notes of
//! at least 0.1 ZEC), then `create_pczt_from_proposal` with `BundlePadding::DEFAULT` (what
//! `TestState::create_pczt_from_proposal` passes; webzjs's browser clock and CSPRNG do not
//! affect the fields checked here). The note spent is a fake Orchard note (the test framework
//! generates no Ironwood notes); the recipient is an Orchard receiver, which upstream pays
//! through Ironwood after NU6.3, as a Celari user sending to a `u1…` address.
//!
//! The network is upstream's `nu7_activating_network` shape: every upgrade through NU6.3 at
//! Sapling activation, NU7 a few blocks later. Branch ids depend only on the upgrade in force
//! at the target height, so they are the mainnet ones: 0x37a5165b (NU6.3) and 0x77190ad9 (NU7).

use std::convert::Infallible;
use std::num::NonZeroUsize;

use zcash_client_backend::{
    data_api::{
        Account as _, WalletRead,
        testing::{
            TestBuilder,
            orchard::OrchardPoolTester,
            pool::{ShieldedPoolTester, dsl::TestDsl},
        },
        wallet::{ConfirmationsPolicy, input_selection::GreedyInputSelector},
    },
    fees::{DustOutputPolicy, SplitPolicy, StandardFeeRule, standard::MultiOutputChangeStrategy},
    wallet::OvkPolicy,
    zip321::{Payment, TransactionRequest},
};
use zcash_keys::address::Address;
use zcash_primitives::block::BlockHash;
use zcash_protocol::{
    PoolType, ShieldedPool,
    consensus::{BlockHeight, BranchId, NetworkUpgrade, Parameters},
    constants::{V6_TX_VERSION, V6_VERSION_GROUP_ID},
    local_consensus::LocalNetwork,
    value::Zatoshis,
};

use crate::{
    MemoryWalletDb,
    testing::{MemBlockCache, TestMemDbFactory},
};

const NU7_OFFSET: u32 = 20;

/// webzjs-wallet's `Wallet::change_strategy` for a transaction targeting `target`
/// (`runtime::fallback_change_pool`: Ironwood from NU6.3, else Orchard).
fn webzjs_change_strategy(
    params: &LocalNetwork,
    target: BlockHeight,
) -> MultiOutputChangeStrategy<MemoryWalletDb<LocalNetwork>> {
    let fallback = if params.is_nu_active(NetworkUpgrade::Nu6_3, target) {
        ShieldedPool::Ironwood
    } else {
        ShieldedPool::Orchard
    };
    MultiOutputChangeStrategy::new(
        StandardFeeRule::Zip317,
        None,
        fallback,
        DustOutputPolicy::default(),
        SplitPolicy::with_min_output_value(
            NonZeroUsize::new(4).unwrap(),
            Zatoshis::const_from_u64(10_000_000),
        ),
    )
}

#[test]
fn send_pczt_has_nu6_3_then_nu7_branch_and_v6() {
    let base = TestBuilder::<(), ()>::DEFAULT_NETWORK;
    let start = base.sapling.unwrap();
    let network = LocalNetwork {
        nu6: Some(start),
        nu6_1: Some(start),
        nu6_2: Some(start),
        nu6_3: Some(start),
        nu7: Some(start + NU7_OFFSET),
        ..base
    };
    let nu7 = network.activation_height(NetworkUpgrade::Nu7).unwrap();
    let mut st = TestDsl::from(
        TestBuilder::new()
            .with_network(network)
            .with_data_store_factory(TestMemDbFactory::new())
            .with_block_cache(MemBlockCache::new())
            .with_account_from_sapling_activation(BlockHash([0; 32])),
    )
    .build::<OrchardPoolTester>();
    st.add_a_single_note_checking_balance(Zatoshis::const_from_u64(200_000));
    let account = st.get_account().id();
    let to: Address = OrchardPoolTester::sk_default_address(&OrchardPoolTester::sk(&[0xf5; 32]));

    // A send while NU6.3 is in force, then the same send from NU7's activation height on.
    let first = st.wallet().chain_height().unwrap().unwrap() + 1;
    assert!(first < nu7, "the first PCZT targets a height before NU7");
    let mut built = vec![build(&mut st, account, &to, first)];
    st.add_empty_blocks(usize::try_from(u32::from(nu7) - u32::from(first)).unwrap());
    let second = st.wallet().chain_height().unwrap().unwrap() + 1;
    assert_eq!(second, nu7, "the second PCZT targets the NU7 activation height");
    built.push(build(&mut st, account, &to, second));

    for (target, b) in &built {
        eprintln!(
            "target {target}: tx_version {} version_group_id {:#010x} consensus_branch_id {:#010x} \
             expiry {} | orchard actions {} ironwood actions {} sapling spends/outputs {}/{} | {} bytes",
            b.tx_version, b.version_group_id, b.branch, b.expiry, b.orchard, b.ironwood,
            b.sapling.0, b.sapling.1, b.bytes,
        );
    }
    assert_eq!(built.len(), 2);
    assert_eq!(built[0].1.branch, 0x37a5_165b, "NU6.3 (Ironwood) branch before NU7");
    assert_eq!(built[1].1.branch, 0x7719_0ad9, "NU7 branch from NU7 activation");
    assert_eq!(u32::from(built[1].0), u32::from(nu7));
}

struct Built {
    tx_version: u32,
    version_group_id: u32,
    branch: u32,
    expiry: u32,
    orchard: usize,
    ironwood: usize,
    sapling: (usize, usize),
    bytes: usize,
}

type St = TestDsl<
    zcash_client_backend::data_api::testing::pool::dsl::TestScenario<
        OrchardPoolTester,
        MemBlockCache,
        TestMemDbFactory,
    >,
>;

fn build(st: &mut St, account: crate::AccountId, to: &Address, target: BlockHeight) -> (BlockHeight, Built) {
    let request = TransactionRequest::new(vec![Payment::without_memo(
        to.to_zcash_address(st.network()),
        Zatoshis::const_from_u64(50_000),
    )])
    .unwrap();
    let change = webzjs_change_strategy(st.network(), target);
    let proposal = st
        .propose_transfer(account, &GreedyInputSelector::new(), &change, request, ConfirmationsPolicy::MIN)
        .unwrap();
    assert_eq!(BlockHeight::from(proposal.min_target_height()), target);
    // The Orchard-receiver payment goes through Ironwood.
    assert_eq!(proposal.steps().head.payment_pools().get(&0), Some(&PoolType::IRONWOOD));

    let pczt = st
        .create_pczt_from_proposal::<Infallible, _, Infallible>(account, OvkPolicy::Sender, &proposal, None)
        .unwrap();
    // The encoding webzjs hands between its wallet and keys modules.
    let bytes = pczt.clone().serialize().unwrap();
    let g = pczt.global();
    let b = Built {
        tx_version: *g.tx_version(),
        version_group_id: *g.version_group_id(),
        branch: *g.consensus_branch_id(),
        expiry: *g.expiry_height(),
        orchard: pczt.orchard().actions().len(),
        ironwood: pczt.ironwood().actions().len(),
        sapling: (pczt.sapling().spends().len(), pczt.sapling().outputs().len()),
        bytes: bytes.len(),
    };
    assert_eq!(b.branch, u32::from(BranchId::for_height(st.network(), target)));
    assert_eq!(b.tx_version, V6_TX_VERSION, "Ironwood is involved: a v6 transaction");
    assert_eq!(b.version_group_id, V6_VERSION_GROUP_ID);
    assert!(b.ironwood > 0, "the payment (and change) is an Ironwood output");
    assert!(b.orchard > 0, "the fake Orchard note is spent in the Orchard bundle");
    (target, b)
}
