//! Nullifiers, and the spend maps used for out-of-order scanning.
//!
//! The spend maps correspond to the `tx_locator_map`, `nullifier_map` and
//! `transparent_spend_locator_map` tables of zcash_client_sqlite 0.23
//! (`wallet/db.rs`), and follow the same rules (`wallet.rs`: `ensure_tx_locator`,
//! `insert_nullifier_map`, `insert_transparent_spend_locator_map`,
//! `find_or_create_spending_tx_for_nullifier`, `prune_spend_maps`).

use std::collections::BTreeMap;

use zcash_primitives::transaction::TxId;
use zcash_protocol::{ShieldedPool, consensus::BlockHeight};

#[cfg(feature = "transparent-inputs")]
use ::transparent::bundle::OutPoint;

use crate::error::Error;

/// A nullifier, tagged with the shielded pool whose note it spends.
///
/// Ironwood (NU6.3) nullifiers have the Orchard nullifier type but belong to a separate
/// pool with its own note commitment tree and its own set of revealed nullifiers, so they
/// are never compared with Orchard nullifiers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Nullifier {
    Sapling(sapling::Nullifier),
    #[cfg(feature = "orchard")]
    Orchard(orchard::note::Nullifier),
    #[cfg(feature = "orchard")]
    Ironwood(orchard::note::Nullifier),
}

impl Nullifier {
    pub(crate) fn pool(&self) -> ShieldedPool {
        match self {
            Nullifier::Sapling(_) => ShieldedPool::Sapling,
            #[cfg(feature = "orchard")]
            Nullifier::Orchard(_) => ShieldedPool::Orchard,
            #[cfg(feature = "orchard")]
            Nullifier::Ironwood(_) => ShieldedPool::Ironwood,
        }
    }
}

/// A transaction locator: the height of the block containing the transaction and the
/// index of the transaction within that block.
pub(crate) type TxLocator = (BlockHeight, u16);

/// Spends observed while scanning, recorded by transaction locator, so that a note or
/// transparent output discovered later (in a block range below a gap in the scanned
/// blocks) is immediately known to be spent.
///
/// Entries of `nullifiers` and `transparent` refer to `tx_locators`; removing a locator
/// removes the entries that refer to it (`ON DELETE CASCADE` in zcash_client_sqlite).
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct SpendMaps {
    /// `tx_locator_map`: locator -> txid. Txids are unique across locators.
    tx_locators: BTreeMap<TxLocator, TxId>,
    /// Reverse index of `tx_locators`.
    locators_by_txid: BTreeMap<TxId, TxLocator>,
    /// `nullifier_map`: (pool-tagged) nullifier -> locator of the revealing transaction.
    nullifiers: BTreeMap<Nullifier, TxLocator>,
    /// `transparent_spend_locator_map`: spent outpoint -> locator of the spending transaction.
    #[cfg(feature = "transparent-inputs")]
    transparent: BTreeMap<OutPoint, TxLocator>,
}

impl SpendMaps {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Records that the transaction `txid` is at `locator`.
    ///
    /// A locator that already maps to a different transaction, or a transaction already
    /// recorded at a different locator, is a conflict: either the data is corrupt or a
    /// reorg happened and the wallet must be truncated first. As in zcash_client_sqlite,
    /// that is an error rather than a silent update.
    fn ensure_tx_locator(&mut self, locator: TxLocator, txid: TxId) -> Result<(), Error> {
        match (
            self.tx_locators.get(&locator),
            self.locators_by_txid.get(&txid),
        ) {
            (Some(existing_txid), Some(existing_locator))
                if *existing_txid == txid && *existing_locator == locator =>
            {
                Ok(())
            }
            (None, None) => {
                self.tx_locators.insert(locator, txid);
                self.locators_by_txid.insert(txid, locator);
                Ok(())
            }
            _ => Err(Error::ConflictingTxLocator),
        }
    }

    /// Inserts the unmatched nullifiers of one block (`track_block_*_nullifiers`).
    pub(crate) fn insert_nullifiers(
        &mut self,
        block_height: BlockHeight,
        entries: impl IntoIterator<Item = (u16, TxId, Vec<Nullifier>)>,
    ) -> Result<(), Error> {
        for (tx_index, txid, nfs) in entries {
            let locator = (block_height, tx_index);
            self.ensure_tx_locator(locator, txid)?;
            for nf in nfs {
                // Upsert: the locator was just confirmed to point at this transaction.
                self.nullifiers.insert(nf, locator);
            }
        }
        Ok(())
    }

    /// Inserts the transparent spends of one block (`track_block_transparent_spends`).
    #[cfg(feature = "transparent-inputs")]
    pub(crate) fn insert_transparent_spends(
        &mut self,
        block_height: BlockHeight,
        entries: &[(u16, TxId, Vec<OutPoint>)],
    ) -> Result<(), Error> {
        for (tx_index, txid, prevouts) in entries {
            if prevouts.is_empty() {
                continue;
            }
            let locator = (block_height, *tx_index);
            self.ensure_tx_locator(locator, *txid)?;
            for prevout in prevouts {
                self.transparent.insert(prevout.clone(), locator);
            }
        }
        Ok(())
    }

    fn resolve(&self, locator: &TxLocator) -> Option<(BlockHeight, u16, TxId)> {
        self.tx_locators
            .get(locator)
            .map(|txid| (locator.0, locator.1, *txid))
    }

    /// The locator recorded for `txid`, if any.
    pub(crate) fn locator_of(&self, txid: &TxId) -> Option<TxLocator> {
        self.locators_by_txid.get(txid).copied()
    }

    /// The transaction that revealed `nf`, if one was observed while scanning.
    pub(crate) fn find_nullifier(&self, nf: &Nullifier) -> Option<(BlockHeight, u16, TxId)> {
        self.nullifiers.get(nf).and_then(|loc| self.resolve(loc))
    }

    /// The transaction that spent `outpoint`, if one was observed while scanning.
    #[cfg(feature = "transparent-inputs")]
    pub(crate) fn find_outpoint(&self, outpoint: &OutPoint) -> Option<(BlockHeight, u16, TxId)> {
        self.transparent.get(outpoint).and_then(|loc| self.resolve(loc))
    }

    /// The number of transaction locators and of nullifiers recorded.
    #[cfg(test)]
    pub(crate) fn len(&self) -> (usize, usize) {
        (self.tx_locators.len(), self.nullifiers.len())
    }

    /// The lowest block height an entry is recorded at.
    #[cfg(test)]
    pub(crate) fn lowest_height(&self) -> Option<BlockHeight> {
        self.tx_locators.keys().next().map(|loc| loc.0)
    }

    /// Removes the entries recorded at block heights below `height` (`prune_spend_maps`).
    pub(crate) fn prune_below(&mut self, height: BlockHeight) {
        self.retain_locators(|loc| loc.0 >= height);
    }

    /// Removes the entries recorded at block heights above `height` (chain truncation).
    pub(crate) fn truncate_above(&mut self, height: BlockHeight) {
        self.retain_locators(|loc| loc.0 <= height);
    }

    fn retain_locators(&mut self, keep: impl Fn(&TxLocator) -> bool) {
        self.tx_locators.retain(|loc, _| keep(loc));
        self.locators_by_txid.retain(|_, loc| keep(loc));
        self.nullifiers.retain(|_, loc| keep(loc));
        #[cfg(feature = "transparent-inputs")]
        self.transparent.retain(|_, loc| keep(loc));
    }

    /// Rebuilds the maps from stored entries (deserialization).
    pub(crate) fn from_parts(
        tx_locators: Vec<(TxLocator, TxId)>,
        nullifiers: Vec<(Nullifier, TxLocator)>,
        #[cfg(feature = "transparent-inputs")] transparent: Vec<(OutPoint, TxLocator)>,
    ) -> Result<Self, Error> {
        let mut maps = Self::new();
        for (locator, txid) in tx_locators {
            maps.ensure_tx_locator(locator, txid)?;
        }
        for (nf, locator) in nullifiers {
            if !maps.tx_locators.contains_key(&locator) {
                return Err(Error::CorruptedData(
                    "a stored nullifier refers to an unknown transaction locator".into(),
                ));
            }
            maps.nullifiers.insert(nf, locator);
        }
        #[cfg(feature = "transparent-inputs")]
        for (op, locator) in transparent {
            if !maps.tx_locators.contains_key(&locator) {
                return Err(Error::CorruptedData(
                    "a stored transparent spend refers to an unknown transaction locator".into(),
                ));
            }
            maps.transparent.insert(op, locator);
        }
        Ok(maps)
    }

    pub(crate) fn tx_locators(&self) -> impl Iterator<Item = (&TxLocator, &TxId)> {
        self.tx_locators.iter()
    }

    pub(crate) fn nullifiers(&self) -> impl Iterator<Item = (&Nullifier, &TxLocator)> {
        self.nullifiers.iter()
    }

    #[cfg(feature = "transparent-inputs")]
    pub(crate) fn transparent_spends(&self) -> impl Iterator<Item = (&OutPoint, &TxLocator)> {
        self.transparent.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn txid(b: u8) -> TxId {
        TxId::from_bytes([b; 32])
    }

    #[test]
    fn locator_conflicts_are_errors() {
        let mut m = SpendMaps::new();
        let h = BlockHeight::from_u32(10);
        let nf = Nullifier::Sapling(sapling::Nullifier([7; 32]));
        m.insert_nullifiers(h, [(0, txid(1), vec![nf])]).unwrap();
        // same locator, same tx: fine
        m.insert_nullifiers(h, [(0, txid(1), vec![nf])]).unwrap();
        // same locator, different tx
        assert!(m.insert_nullifiers(h, [(0, txid(2), vec![])]).is_err());
        // same tx, different locator
        assert!(m.insert_nullifiers(h, [(1, txid(1), vec![])]).is_err());
        assert_eq!(m.find_nullifier(&nf), Some((h, 0, txid(1))));
    }

    #[test]
    fn pruning_cascades_to_nullifiers() {
        let mut m = SpendMaps::new();
        let nf_a = Nullifier::Sapling(sapling::Nullifier([1; 32]));
        let nf_b = Nullifier::Sapling(sapling::Nullifier([2; 32]));
        m.insert_nullifiers(BlockHeight::from_u32(10), [(0, txid(1), vec![nf_a])])
            .unwrap();
        m.insert_nullifiers(BlockHeight::from_u32(20), [(0, txid(2), vec![nf_b])])
            .unwrap();
        m.prune_below(BlockHeight::from_u32(15));
        assert_eq!(m.find_nullifier(&nf_a), None);
        assert!(m.find_nullifier(&nf_b).is_some());
        m.truncate_above(BlockHeight::from_u32(19));
        assert_eq!(m.find_nullifier(&nf_b), None);
        assert_eq!(m.tx_locators().count(), 0);
    }
}
