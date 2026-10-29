//! An in-memory wallet backend for zcash_client_backend 0.25.
//!
//! Celari's port of ChainSafe's `zcash_client_memory` (see `UPSTREAM.md`). Writes go
//! through zcash_client_backend's low-level traits (`data_api::ll`), so block, note,
//! nullifier and transaction bookkeeping for all three shielded pools (Sapling, Orchard,
//! Ironwood) is upstream logic.

mod block_source;
mod db_ops;
mod error;
mod input_source;
mod ll;
mod output_lock_store;
mod queries;
mod serialization;
/// zcash_client_backend's backend test framework over this crate: [`testing::TestMemDbFactory`]
/// and the `WalletTest`/`TestCache` impls. Public with the `test-dependencies` feature, so
/// that webzjs-wallet's native tests drive the shipped glue over a test-framework wallet.
#[cfg(any(test, feature = "test-dependencies"))]
pub mod testing;
#[cfg(feature = "transparent-inputs")]
mod transparent_ops;
mod types;
mod wallet_commitment_trees;
mod wallet_read;
mod wallet_write;

pub use block_source::*;
pub use serialization::FORMAT_VERSION;
pub use error::Error;
pub use types::{
    Account, AccountId, MemoryWalletDb, ReceivedNote, ReceivedNoteTable, ReceivedTransparentOutput,
    SentNoteTable, SentOutput, SentOutputId, TransactionEntry, TransactionTable, TransparentOutputs,
};
pub(crate) use types::*;

/// The maximum number of blocks the wallet is allowed to rewind. This is consistent with
/// the bound in zcashd, and allows block data deeper than this delta from the chain tip
/// to be pruned.
pub(crate) const PRUNING_DEPTH: u32 = 100;

/// The number of blocks to verify ahead when the chain tip is updated.
pub(crate) const VERIFY_LOOKAHEAD: u32 = 10;
