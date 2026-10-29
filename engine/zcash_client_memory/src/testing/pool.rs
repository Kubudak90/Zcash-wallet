//! zcash_client_backend's shielded-pool and chain tests (`data_api::testing::pool`), run for
//! the Sapling and Orchard testers, plus the cross-pool and Ironwood tests. The list follows
//! zcash_client_sqlite 0.23 (`wallet/sapling.rs`, `wallet/orchard.rs`, `chain.rs`,
//! `testing/pool.rs`); tests sqlite runs only behind its `expensive-tests` feature are left
//! out. The ZIP 318 canonical-crossing tests run (they test ordinary sends after NU6.3);
//! only tests of sqlite's pool-migration store would be left out, and upstream has none in
//! `data_api::testing::pool`.

use crate::testing::{MemBlockCache, TestMemDbFactory};

fn dsf() -> TestMemDbFactory {
    TestMemDbFactory::new()
}

fn cache() -> MemBlockCache {
    MemBlockCache::new()
}

/// A `#[test]` that runs the upstream test of the same name with the given generic arguments
/// and arguments.
macro_rules! upstream {
    ($(#[$m:meta])* $name:ident :: < $($g:ty),* > ( $($arg:expr),* $(,)? )) => {
        $(#[$m])*
        #[test]
        fn $name() {
            zcash_client_backend::data_api::testing::pool::$name::<$($g),*>($($arg),*)
        }
    };
    ($(#[$m:meta])* $name:ident ( $($arg:expr),* $(,)? )) => {
        $(#[$m])*
        #[test]
        fn $name() {
            zcash_client_backend::data_api::testing::pool::$name($($arg),*)
        }
    };
}

/// The tests sqlite runs once per shielded pool tester.
macro_rules! single_pool_tests {
    ($T:ty) => {
        use super::*;
        use zcash_client_backend::data_api::{
            anchor_retention::AnchorRetentionInterval, testing::pool::InputTrust,
        };

        upstream!(send_single_step_proposed_transfer::<$T>(dsf(), cache()));
        upstream!(create_to_address_respects_recipient_expiry::<$T>(dsf(), cache()));
        upstream!(create_proposed_transactions_uses_nu7_default_expiry::<$T>(dsf(), cache()));
        upstream!(scan_full_block_detects_outputs::<$T>(dsf(), cache()));
        upstream!(spend_max_spendable_single_step_proposed_transfer::<$T>(dsf(), cache()));
        upstream!(spend_everything_single_step_proposed_transfer::<$T>(dsf(), cache()));
        upstream!(#[cfg(feature = "transparent-inputs")] send_max_spendable_to_transparent::<$T>(dsf(), cache()));
        upstream!(#[cfg(not(feature = "transparent-inputs"))] send_max_to_tex_fails_without_transparent_inputs::<$T>(dsf(), cache()));
        upstream!(#[cfg(feature = "transparent-inputs")] send_max_fee_overflow_is_an_error::<$T>(dsf(), cache()));
        upstream!(send_max_fails_when_balance_is_consumed_by_fees::<$T>(dsf(), cache()));
        upstream!(#[cfg(feature = "transparent-inputs")] fails_to_send_max_spendable_to_transparent_with_memo::<$T>(dsf(), cache()));
        upstream!(spend_everything_proposal_fails_when_unconfirmed_funds_present::<$T>(dsf(), cache()));
        upstream!(#[ignore = "not run by zcash_client_sqlite 0.23; its history count leaves out the second funding transaction"] send_max_spendable_proposal_succeeds_when_unconfirmed_funds_present::<$T>(dsf(), cache()));
        upstream!(#[cfg(feature = "transparent-inputs")] insufficient_funds_counts_transparent_inputs::<$T>(dsf(), cache()));
        upstream!(#[cfg(feature = "transparent-inputs")] spend_everything_multi_step_single_note_proposed_transfer::<$T, _>(dsf(), cache()));
        upstream!(#[cfg(feature = "transparent-inputs")] spend_everything_multi_step_many_notes_proposed_transfer::<$T, _>(dsf(), cache()));
        upstream!(#[cfg(feature = "transparent-inputs")] spend_everything_multi_step_with_marginal_notes_proposed_transfer::<$T, _>(dsf(), cache()));
        upstream!(send_with_multiple_change_outputs::<$T>(dsf(), cache()));
        upstream!(spend_all_funds_single_step_proposed_transfer::<$T>(dsf(), cache()));
        upstream!(#[cfg(feature = "transparent-inputs")] spend_all_funds_multi_step_proposed_transfer::<$T, _>(dsf(), cache()));
        upstream!(#[cfg(feature = "transparent-inputs")] proposal_fails_if_not_all_ephemeral_outputs_consumed::<$T, _>(dsf(), cache()));
        upstream!(create_to_address_fails_on_incorrect_usk::<$T, _>(dsf()));
        upstream!(proposal_fails_with_no_blocks::<$T, _>(dsf()));
        upstream!(spend_fails_on_unverified_notes::<$T>(dsf(), cache()));
        upstream!(ovk_policy_prevents_recovery_from_chain::<$T, _>(dsf(), cache()));
        upstream!(spend_succeeds_to_t_addr_zero_change::<$T>(dsf(), cache()));
        upstream!(change_note_spends_succeed::<$T>(dsf(), cache()));
        upstream!(account_deletion::<$T, _>(dsf(), cache()));
        upstream!(account_deletion_with_internal_transfer::<$T, _>(dsf(), cache()));
        upstream!(account_rename::<$T, _>(dsf(), cache()));
        upstream!(external_address_change_spends_detected_in_restore_from_seed::<$T, _>(dsf(), cache()));
        upstream!(#[ignore = "upstream FIXME #1316: requires support for dust outputs"] zip317_spend::<$T, _>(dsf(), cache()));
        upstream!(#[cfg(feature = "transparent-inputs")] shield_transparent::<$T, _>(dsf(), cache()));
        upstream!(birthday_in_anchor_shard::<$T>(dsf(), cache()));
        upstream!(checkpoint_gaps::<$T, _>(dsf(), cache()));
        upstream!(scan_cached_blocks_detects_spends_out_of_order::<$T, _>(dsf(), cache()));
        upstream!(oldest_note_is_selected_first::<$T, _>(dsf(), cache()));
        upstream!(metadata_queries_exclude_unwanted_notes::<$T, _, _>(dsf(), cache()));
        upstream!(receive_two_notes_with_same_value::<$T>(dsf(), cache()));
        upstream!(#[cfg(all(feature = "pczt-tests", feature = "transparent-inputs"))] immature_coinbase_outputs_are_excluded_from_note_selection::<$T>(dsf(), cache()));
        upstream!(#[cfg(all(feature = "pczt-tests", feature = "transparent-inputs"))] coinbase_only_filtering::<$T, _>(dsf(), cache()));
        upstream!(#[cfg(all(feature = "pczt-tests", feature = "transparent-inputs"))] propose_shielding_coinbase_succeeds::<$T, _>(dsf(), cache()));
        upstream!(#[cfg(all(feature = "pczt-tests", feature = "transparent-inputs"))] propose_shielding_coinbase_transparent_recipient_rejected::<$T, _>(dsf(), cache()));
        upstream!(#[cfg(all(feature = "pczt-tests", feature = "transparent-inputs"))] propose_shielding_coinbase_with_memo_succeeds::<$T, _>(dsf(), cache()));
        upstream!(#[cfg(all(feature = "pczt-tests", feature = "transparent-inputs"))] propose_shielding_coinbase_with_limit_truncates_inputs::<$T, _>(dsf(), cache()));
        upstream!(#[cfg(all(feature = "pczt-tests", feature = "transparent-inputs"))] propose_shielding_coinbase_with_zero_limit_insufficient_funds::<$T, _>(dsf(), cache()));
        upstream!(#[cfg(all(feature = "pczt-tests", feature = "transparent-inputs"))] propose_and_build_shielding_coinbase_succeeds::<$T, _>(dsf(), cache()));

        // Chain tests (sqlite `chain.rs`).
        upstream!(valid_chain_states::<$T>(dsf(), cache()));
        upstream!(#[ignore = "upstream FIXME: requires fixes to the test framework"] invalid_chain_cache_disconnected::<$T>(dsf(), cache()));
        upstream!(data_db_truncation::<$T, _>(dsf(), cache()));
        upstream!(truncate_to_chain_state::<$T, _>(dsf(), cache()));
        upstream!(truncate_to_chain_state_below_birthday::<$T, _>(dsf(), cache()));
        upstream!(truncate_to_chain_state_above_scanned::<$T, _>(dsf(), cache()));
        upstream!(rewind_to_chain_state_deep::<$T, _>(dsf(), cache()));
        upstream!(rewind_to_chain_state_shallow::<$T, _>(dsf(), cache()));
        upstream!(rewind_after_non_contiguous_scan::<$T, _>(dsf(), cache()));
        upstream!(reorg_to_checkpoint::<$T, _, _>(dsf(), cache()));
        upstream!(scan_cached_blocks_allows_blocks_out_of_order::<$T>(dsf(), cache()));
        upstream!(scan_cached_blocks_finds_received_notes::<$T, _>(dsf(), cache()));
        upstream!(scan_cached_blocks_finds_change_notes::<$T, _>(dsf(), cache()));

        #[cfg(feature = "transparent-inputs")]
        #[test]
        fn send_multi_step_proposed_transfer() {
            zcash_client_backend::data_api::testing::pool::send_multi_step_proposed_transfer::<
                $T,
                _,
            >(dsf(), cache(), |e, account_id, expected_bad_index| {
                matches!(
                    e,
                    crate::Error::ReachedGapLimit(acct, bad_index)
                    if acct == &account_id && bad_index == &expected_bad_index
                )
            })
        }

        /// Runs the deep-scan retention check at the ZIP 318 interval and at a short one.
        #[test]
        fn anchor_checkpoints_retained_across_deep_scan() {
            for interval in [
                AnchorRetentionInterval::ZIP_318,
                AnchorRetentionInterval::custom(std::num::NonZeroU32::new(12).expect("nonzero")),
            ] {
                zcash_client_backend::data_api::testing::pool::anchor_checkpoints_retained_across_deep_scan::<$T, _>(
                    dsf(),
                    cache(),
                    interval,
                )
            }
        }

        #[cfg(feature = "orchard")]
        #[test]
        fn empty_boundary_blocks_are_checkpointed_and_retained() {
            zcash_client_backend::data_api::testing::pool::empty_boundary_blocks_are_checkpointed_and_retained::<$T, _>(
                dsf(),
                cache(),
                AnchorRetentionInterval::custom(std::num::NonZeroU32::new(7).expect("nonzero")),
            )
        }

        #[test]
        fn zip315_can_spend_inputs_by_confirmations_policy() {
            for trust in [
                InputTrust::Internal,
                InputTrust::ExternalUntrusted,
                InputTrust::ExternalTrusted,
            ] {
                zcash_client_backend::data_api::testing::pool::zip_315_confirmations_test_steps::<$T>(
                    dsf(),
                    cache(),
                    trust,
                );
            }
        }

        /// sqlite clears the stored fee with SQL; here the transaction row's fee is cleared.
        #[cfg(feature = "transparent-inputs")]
        #[test]
        fn wallet_recovery_compute_fees() {
            zcash_client_backend::data_api::testing::pool::wallet_recovery_computes_fees::<$T, _>(
                dsf(),
                cache(),
                |db, txid| {
                    if let Some(tx) = db.tx_table.get_mut(&txid) {
                        tx.fee = None;
                    }
                    Ok(())
                },
            )
        }
    };
}

mod sapling {
    single_pool_tests!(zcash_client_backend::data_api::testing::sapling::SaplingPoolTester);
}

#[cfg(feature = "orchard")]
mod orchard {
    single_pool_tests!(zcash_client_backend::data_api::testing::orchard::OrchardPoolTester);

    // Orchard only, as in sqlite (`wallet/orchard.rs`). The NU7 expiry PCZT test cannot run
    // for Sapling: the test network's heights lie in the ZIP 212 grace period, in which no
    // PCZT with Sapling outputs can be built (upstream's doc comment).
    upstream!(#[cfg(feature = "pczt-tests")] create_pczt_uses_nu7_default_expiry::<zcash_client_backend::data_api::testing::orchard::OrchardPoolTester, _>(dsf(), cache()));
    upstream!(#[cfg(all(feature = "pczt-tests", feature = "transparent-inputs"))] proposal_without_confirmations_policy_builds::<zcash_client_backend::data_api::testing::orchard::OrchardPoolTester, _>(dsf(), cache()));
}

/// Tests over two pools, and the Ironwood tests, which sqlite runs from `wallet/orchard.rs`
/// and `wallet/sapling.rs`.
#[cfg(feature = "orchard")]
mod cross_pool {
    use super::*;
    use zcash_client_backend::data_api::testing::{
        orchard::OrchardPoolTester as O, sapling::SaplingPoolTester as S,
    };

    macro_rules! both_ways {
        ($(#[$m:meta])* $name:ident) => {
            mod $name {
                use super::*;
                $(#[$m])*
                #[test]
                fn sapling_to_orchard() {
                    zcash_client_backend::data_api::testing::pool::$name::<S, O>(dsf(), cache())
                }
                $(#[$m])*
                #[test]
                fn orchard_to_sapling() {
                    zcash_client_backend::data_api::testing::pool::$name::<O, S>(dsf(), cache())
                }
            }
        };
    }

    both_ways!(send_max_spends_inputs_across_pools);
    both_ways!(transfer_grows_across_pools_at_a_dust_shortfall);
    both_ways!(transfer_fails_across_pools_at_a_dust_shortfall);
    both_ways!(pool_crossing_required);
    both_ways!(fully_funded_fully_private);
    both_ways!(#[cfg(feature = "transparent-inputs")] fully_funded_send_to_t);
    both_ways!(multi_pool_checkpoint);
    both_ways!(multi_pool_checkpoints_with_pruning);

    // ZIP 318 canonical crossings: ordinary payments from Orchard funds after NU6.3 whose
    // value is a canonical denomination are proposed against a bucketed (retained) anchor
    // and built with one unpadded Ironwood action. This is upstream proposal/build logic
    // over the backend's retained checkpoints, not the pool-migration store (which this
    // backend does not have), so it applies to Celari's sends. sqlite: `wallet/orchard.rs`.
    upstream!(canonical_crossing_is_bucketed_and_unpadded(dsf(), cache()));
    upstream!(canonical_crossing_builds_at_empty_boundary_block(dsf(), cache()));
    upstream!(multi_note_crossing_is_not_bucketed(dsf(), cache()));
    upstream!(canonical_crossing_prefers_single_note(dsf(), cache()));
    upstream!(self_migration_keeps_spending_orchard(dsf(), cache()));

    /// sqlite deletes every checkpoint record at the height (the checkpoint and retained
    /// checkpoint tables of all three trees); here the same records leave the shard stores.
    #[test]
    fn canonical_crossing_abandoned_without_anchor_checkpoint() {
        use shardtree::store::ShardStore;
        zcash_client_backend::data_api::testing::pool::canonical_crossing_abandoned_without_anchor_checkpoint(
            dsf(),
            cache(),
            |st, height| {
                let db = st.wallet_mut();
                db.sapling.tree.store_mut().remove_checkpoint(&height).unwrap();
                db.sapling.tree.store_mut().remove_retained_checkpoint(&height).unwrap();
                db.orchard.tree.store_mut().remove_checkpoint(&height).unwrap();
                db.orchard.tree.store_mut().remove_retained_checkpoint(&height).unwrap();
                db.ironwood.tree.store_mut().remove_checkpoint(&height).unwrap();
                db.ironwood.tree.store_mut().remove_retained_checkpoint(&height).unwrap();
            },
        )
    }

    upstream!(orchard_to_ironwood_payment_reports_net_value_delta(dsf(), cache()));
    upstream!(orchard_to_ironwood_self_migration_reports_fee_only_delta(dsf(), cache()));
    upstream!(propose_v5_payment_to_orchard_receiver_is_rejected(dsf(), cache()));
    upstream!(proposal_records_and_serializes_proposed_version(dsf(), cache()));
    upstream!(#[cfg(feature = "pczt-tests")] create_pczt_supports_ironwood_output(dsf(), cache()));
    upstream!(#[cfg(all(feature = "pczt-tests", feature = "transparent-inputs"))] shielding_coinbase_to_orchard_receiver_delivers_via_ironwood(dsf(), cache()));

    #[cfg(feature = "pczt-tests")]
    mod pczt_single_step {
        use super::*;

        #[test]
        fn sapling_only() {
            zcash_client_backend::data_api::testing::pool::pczt_single_step::<S, S, _>(
                dsf(),
                cache(),
                None,
            )
        }

        #[test]
        fn sapling_to_orchard() {
            zcash_client_backend::data_api::testing::pool::pczt_single_step::<S, O, _>(
                dsf(),
                cache(),
                None,
            )
        }

        #[test]
        fn orchard_only() {
            zcash_client_backend::data_api::testing::pool::pczt_single_step::<O, O, _>(
                dsf(),
                cache(),
                None,
            )
        }

        #[test]
        fn orchard_to_sapling() {
            zcash_client_backend::data_api::testing::pool::pczt_single_step::<O, S, _>(
                dsf(),
                cache(),
                None,
            )
        }

        #[test]
        fn orchard_pinned_expiry() {
            zcash_client_backend::data_api::testing::pool::pczt_single_step::<O, O, _>(
                dsf(),
                cache(),
                Some(100),
            )
        }
    }
}
