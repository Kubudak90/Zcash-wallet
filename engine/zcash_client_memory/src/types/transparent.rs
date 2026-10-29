//! Transparent outputs received by the wallet, and their spends.
//!
//! Mirrors the `transparent_received_outputs`, `transparent_received_output_spends` and
//! `transparent_spend_map` tables of zcash_client_sqlite 0.23 (`wallet/db.rs`). The spend
//! locator map for out-of-order scanning lives in [`crate::types::nullifier::SpendMaps`].

use std::collections::{BTreeMap, BTreeSet};

use ::transparent::{
    address::TransparentAddress,
    bundle::{OutPoint, TxOut},
    keys::TransparentKeyScope,
};
use zcash_primitives::transaction::TxId;
use zcash_protocol::consensus::BlockHeight;

use crate::{AccountId, types::address::AddressId};

/// A transparent output paying one of the wallet's addresses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceivedTransparentOutput {
    pub(crate) outpoint: OutPoint,
    /// The account that controls spend authority for this output.
    pub(crate) account_id: AccountId,
    /// The address the output pays.
    pub(crate) address: TransparentAddress,
    /// The address row of `address`.
    pub(crate) address_id: AddressId,
    /// The key scope the address was derived at; `None` for an imported standalone address.
    pub(crate) key_scope: Option<TransparentKeyScope>,
    pub(crate) txout: TxOut,
    /// The greatest height at which the output was observed to be in the UTXO set as of
    /// the end of the block.
    pub(crate) max_observed_unspent_height: Option<BlockHeight>,
}

impl ReceivedTransparentOutput {
    pub fn outpoint(&self) -> &OutPoint {
        &self.outpoint
    }
    pub fn account_id(&self) -> AccountId {
        self.account_id
    }
    pub fn address(&self) -> &TransparentAddress {
        &self.address
    }
    pub fn key_scope(&self) -> Option<TransparentKeyScope> {
        self.key_scope
    }
    pub fn txout(&self) -> &TxOut {
        &self.txout
    }
    pub fn max_observed_unspent_height(&self) -> Option<BlockHeight> {
        self.max_observed_unspent_height
    }
}

/// The wallet's transparent outputs and the transactions spending them.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TransparentOutputs {
    /// `transparent_received_outputs`, keyed by outpoint.
    pub(crate) outputs: BTreeMap<OutPoint, ReceivedTransparentOutput>,
    /// `transparent_received_output_spends`: every transaction known to spend the output
    /// (only one of them can be mined).
    pub(crate) spends: BTreeMap<OutPoint, BTreeSet<TxId>>,
    /// `transparent_spend_map`: the prevouts spent by transactions the wallet stores, so a
    /// spend seen before its output can be linked once the output is found.
    pub(crate) spend_map: BTreeSet<(TxId, OutPoint)>,
}

impl TransparentOutputs {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, outpoint: &OutPoint) -> Option<&ReceivedTransparentOutput> {
        self.outputs.get(outpoint)
    }

    pub fn iter(&self) -> impl Iterator<Item = &ReceivedTransparentOutput> {
        self.outputs.values()
    }

    pub fn spends_of(&self, outpoint: &OutPoint) -> impl Iterator<Item = &TxId> {
        self.spends.get(outpoint).into_iter().flatten()
    }

    /// The transactions recorded in `transparent_spend_map` as spending `outpoint`.
    pub(crate) fn spend_map_spenders<'a>(
        &'a self,
        outpoint: &'a OutPoint,
    ) -> impl Iterator<Item = TxId> + 'a {
        self.spend_map
            .iter()
            .filter(move |(_, op)| op == outpoint)
            .map(|(txid, _)| *txid)
    }

    /// Records that `spending_tx` spends `outpoint`. Returns whether the record is new.
    pub(crate) fn record_spend(&mut self, outpoint: &OutPoint, spending_tx: TxId) -> bool {
        self.spends
            .entry(outpoint.clone())
            .or_default()
            .insert(spending_tx)
    }

    pub(crate) fn remove_tx(&mut self, txid: &TxId) {
        self.outputs.retain(|op, _| op.txid() != txid);
        self.spends.retain(|op, _| op.txid() != txid);
        for txs in self.spends.values_mut() {
            txs.remove(txid);
        }
        self.spends.retain(|_, txs| !txs.is_empty());
        self.spend_map.retain(|(spender, _)| spender != txid);
    }

    pub(crate) fn remove_account(&mut self, account: AccountId) {
        let ops: Vec<OutPoint> = self
            .outputs
            .values()
            .filter(|o| o.account_id == account)
            .map(|o| o.outpoint.clone())
            .collect();
        for op in ops {
            self.outputs.remove(&op);
            self.spends.remove(&op);
        }
    }
}
