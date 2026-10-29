//! Scanned block metadata (the `blocks` table of zcash_client_sqlite 0.23).

use zcash_primitives::block::BlockHash;
use zcash_protocol::{ShieldedPool, consensus::BlockHeight};

/// A block the wallet has scanned.
///
/// Tree sizes are the sizes of each pool's note commitment tree as of the end of the
/// block; output counts are the number of note commitments the block added to each tree.
/// Before NU6.3 the Ironwood tree is empty, so its size and count are 0.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MemoryWalletBlock {
    pub(crate) height: BlockHeight,
    pub(crate) hash: BlockHash,
    pub(crate) block_time: u32,
    pub(crate) sapling_commitment_tree_size: u32,
    pub(crate) sapling_output_count: u32,
    #[cfg(feature = "orchard")]
    pub(crate) orchard_commitment_tree_size: u32,
    #[cfg(feature = "orchard")]
    pub(crate) orchard_action_count: u32,
    #[cfg(feature = "orchard")]
    pub(crate) ironwood_commitment_tree_size: u32,
    #[cfg(feature = "orchard")]
    pub(crate) ironwood_action_count: u32,
}

impl MemoryWalletBlock {
    /// The size of `pool`'s note commitment tree as of the end of this block.
    ///
    /// Returns `None` for a pool this build does not support.
    pub(crate) fn tree_size(&self, pool: ShieldedPool) -> Option<u32> {
        match pool {
            ShieldedPool::Sapling => Some(self.sapling_commitment_tree_size),
            #[cfg(feature = "orchard")]
            ShieldedPool::Orchard => Some(self.orchard_commitment_tree_size),
            #[cfg(feature = "orchard")]
            ShieldedPool::Ironwood => Some(self.ironwood_commitment_tree_size),
            #[cfg(not(feature = "orchard"))]
            _ => None,
        }
    }

    /// The number of note commitments this block added to `pool`'s tree.
    pub(crate) fn output_count(&self, pool: ShieldedPool) -> Option<u32> {
        match pool {
            ShieldedPool::Sapling => Some(self.sapling_output_count),
            #[cfg(feature = "orchard")]
            ShieldedPool::Orchard => Some(self.orchard_action_count),
            #[cfg(feature = "orchard")]
            ShieldedPool::Ironwood => Some(self.ironwood_action_count),
            #[cfg(not(feature = "orchard"))]
            _ => None,
        }
    }
}
