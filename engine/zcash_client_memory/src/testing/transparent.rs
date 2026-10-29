//! zcash_client_backend's transparent tests (`data_api::testing::transparent`), as
//! zcash_client_sqlite 0.23 runs them (`wallet/transparent.rs`). The standalone-key import
//! tests are left out: this backend refuses those imports with an explicit error (see
//! docs/engine-port.md, "Deferred").

use zcash_keys::keys::transparent::gap_limits::GapLimits;

use crate::testing::{MemBlockCache, TestMemDbFactory};

fn dsf() -> TestMemDbFactory {
    TestMemDbFactory::new()
}

fn cache() -> MemBlockCache {
    MemBlockCache::new()
}

macro_rules! upstream {
    ($(#[$m:meta])* $name:ident ( $($arg:expr),* $(,)? )) => {
        $(#[$m])*
        #[test]
        fn $name() {
            zcash_client_backend::data_api::testing::transparent::$name($($arg),*)
        }
    };
}

upstream!(put_received_transparent_utxo(dsf()));
upstream!(put_received_unmined_utxo_uses_mempool_height_expiry_delta(dsf()));
upstream!(scan_full_block_persists_transparent_outputs(dsf()));
upstream!(put_blocks_rolls_back_transparent_outputs(dsf()));
upstream!(scan_full_block_detects_transparent_spend(dsf()));
upstream!(scan_full_block_detects_out_of_order_transparent_spend(dsf()));
upstream!(scan_detects_transparent_spend(dsf(), cache()));
upstream!(scan_detects_out_of_order_transparent_spend(dsf(), cache()));
upstream!(transparent_balance_across_shielding(dsf(), cache()));
upstream!(shielding_many_transparent_utxos(dsf(), cache()));
upstream!(get_spendable_transparent_outputs_for_addresses(dsf()));
upstream!(shielding_transparent_input_cap(dsf(), cache()));
upstream!(propose_t2t_shielded_only_is_insufficient(dsf(), cache()));
upstream!(propose_t2t_any_account_taddr(dsf(), cache()));
upstream!(propose_t2t_from_addresses(dsf(), cache()));
upstream!(propose_t2t_with_transparent_change(dsf(), cache()));
upstream!(propose_t2t_transparent_change_exact_match(dsf(), cache()));
upstream!(propose_t2shielded_requires_transparent_regather(dsf(), cache()));
upstream!(propose_transfer_transparent_input_cap(dsf(), cache()));
upstream!(value_bounded_transparent_gather(dsf(), cache()));
upstream!(transparent_balance_spendability(dsf(), cache()));
upstream!(transparent_coinbase_balance_split(dsf(), cache()));
upstream!(transparent_coinbase_balance_dust(dsf(), cache()));
upstream!(gap_limits(dsf(), cache(), GapLimits::default()));
upstream!(mark_transparent_addresses_exposed(dsf()));
upstream!(mark_transparent_addresses_exposed_bulk(dsf()));
upstream!(mark_transparent_addresses_exposed_unknown_address(dsf()));

#[test]
fn reserve_next_n_internal_addresses_gap_limit() {
    zcash_client_backend::data_api::testing::transparent::reserve_next_n_internal_addresses_gap_limit(
        dsf(),
        cache(),
        |e, account_id, expected_bad_index| {
            matches!(
                e,
                crate::Error::ReachedGapLimit(acct, bad_index)
                if acct == &account_id && bad_index == &expected_bad_index
            )
        },
    );
}
