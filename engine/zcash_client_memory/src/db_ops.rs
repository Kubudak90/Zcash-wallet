//! Queries and updates over several tables of [`MemoryWalletDb`] that the trait impls
//! share. Each cites the zcash_client_sqlite 0.23 query it reproduces.

use std::collections::{BTreeMap, BTreeSet};

use zcash_client_backend::{
    data_api::{Account as _, scanning::ScanPriority},
    wallet::Note,
};
use zcash_keys::keys::UnifiedAddressRequest;
use zcash_primitives::transaction::TxId;
use zcash_protocol::{
    PoolType,
    consensus::{self, BlockHeight},
    value::Zatoshis,
};
use zip32::Scope;

use crate::{
    AccountId, MemoryWalletDb,
    error::Error,
    types::address::{AddressId, KeyScope},
};

impl<P: consensus::Parameters> MemoryWalletDb<P> {
    /// The wallet birthday: the earliest account birthday (`wallet_birthday`).
    pub(crate) fn wallet_birthday(&self) -> Option<BlockHeight> {
        self.accounts.wallet_birthday()
    }

    /// The last height of the first `Scanned` range of the scan queue, if that range
    /// starts at or below the wallet birthday (`fully_scanned_height`).
    pub(crate) fn fully_scanned_height(&self) -> Option<BlockHeight> {
        let birthday = self.wallet_birthday()?;
        self.scan_queue
            .iter()
            .filter(|(_, _, p)| *p == ScanPriority::Scanned)
            .min_by_key(|(start, _, _)| *start)
            .and_then(|(start, end, _)| (*start <= birthday).then(|| *end - 1))
    }

    /// Makes sure the transaction `txid`, observed in the spend maps at a locator, has a
    /// transaction row (`find_or_create_spending_tx_for_nullifier`: the row is created
    /// lazily, when the spend turns out to involve the wallet).
    pub(crate) fn ensure_tx_from_locator(&mut self, txid: TxId) -> Result<(), Error> {
        if self.tx_table.contains(&txid) {
            return Ok(());
        }
        let (height, tx_index) = self.spend_maps.locator_of(&txid).ok_or_else(|| {
            Error::CorruptedData(format!(
                "spending transaction {txid} is neither stored nor in the spend maps"
            ))
        })?;
        let block_known = self.block_known(height);
        self.tx_table.put_tx_meta(txid, tx_index, height, block_known);
        Ok(())
    }

    /// `ensure_address` for a received shielded note: for a note not received under the
    /// internal scope, the address row (external scope) at the note's diversifier index,
    /// created if needed with the Unified Address at that index.
    pub(crate) fn ensure_note_address(
        &mut self,
        account_id: AccountId,
        note: &Note,
        recipient_key_scope: Option<Scope>,
        exposure_height: Option<BlockHeight>,
    ) -> Result<Option<AddressId>, Error> {
        if recipient_key_scope == Some(Scope::Internal) {
            return Ok(None);
        }
        let account = self
            .accounts
            .get(account_id)
            .ok_or(Error::AccountUnknown(account_id))?;
        let uivk = account.uivk();
        let diversifier_index = match note {
            Note::Sapling(n) => uivk
                .sapling()
                .as_ref()
                .ok_or_else(|| {
                    Error::CorruptedData("Sapling note for an account without a Sapling key".into())
                })?
                .decrypt_diversifier(&n.recipient()),
            #[cfg(feature = "orchard")]
            Note::Orchard { note, .. } => uivk
                .orchard()
                .as_ref()
                .ok_or_else(|| {
                    Error::CorruptedData("Orchard note for an account without an Orchard key".into())
                })?
                .diversifier_index(&note.recipient()),
        }
        .ok_or_else(|| {
            Error::CorruptedData("received note's address does not belong to the account".into())
        })?;
        let ua = uivk.address(diversifier_index, UnifiedAddressRequest::ALLOW_ALL)?;
        self.addresses
            .upsert_unified(account_id, diversifier_index, &ua, exposure_height, false)
            .map(Some)
    }

    /// The height at which an address was first used: the least mined height of a
    /// transaction in which an output was received at it (`v_address_first_use`).
    pub(crate) fn address_first_use_heights(&self) -> BTreeMap<AddressId, BlockHeight> {
        let mut first_use: BTreeMap<AddressId, BlockHeight> = BTreeMap::new();
        let mut record = |id: AddressId, txid: &TxId| {
            if let Some(h) = self.tx_table.get(txid).and_then(|t| t.mined_height()) {
                first_use
                    .entry(id)
                    .and_modify(|e| *e = (*e).min(h))
                    .or_insert(h);
            }
        };
        for rn in self.received_notes.iter() {
            if let Some(id) = rn.address_id() {
                record(id, &rn.txid());
            }
        }
        for o in self.transparent.iter() {
            record(o.address_id, o.outpoint.txid());
        }
        first_use
    }

    /// The (account, key scope) of each address at which an output was received in one of
    /// `txids` (`involved_accounts`, over `v_address_uses`).
    pub(crate) fn address_uses_in(
        &self,
        txids: &BTreeSet<TxId>,
    ) -> BTreeSet<(AccountId, KeyScope)> {
        let mut out = BTreeSet::new();
        let mut add = |id: AddressId| {
            if let Some(a) = self.addresses.get(id) {
                out.insert((a.account_id, a.key_scope));
            }
        };
        for rn in self.received_notes.iter() {
            if let Some(id) = rn.address_id() {
                if txids.contains(&rn.txid()) {
                    add(id);
                }
            }
        }
        for o in self.transparent.iter() {
            if txids.contains(o.outpoint.txid()) {
                add(o.address_id);
            }
        }
        out
    }

    /// The accounts whose notes or transparent outputs `txid` spends, with the value each
    /// contributed, largest contribution first (then the oldest funds, then account id):
    /// `list_funding_accounts`.
    pub(crate) fn funding_accounts_of(&self, txid: &TxId) -> Result<Vec<(AccountId, Zatoshis)>, Error> {
        let mut contribs: BTreeMap<AccountId, (Zatoshis, u32)> = BTreeMap::new();
        let mut add = |account: AccountId, value: Zatoshis, mined: Option<BlockHeight>| -> Result<(), Error> {
            let mined = mined.map_or(0x7FFF_FFFF, u32::from);
            let e = contribs.entry(account).or_insert((Zatoshis::ZERO, mined));
            e.0 = (e.0 + value).ok_or(Error::Balance(zcash_protocol::value::BalanceError::Overflow))?;
            e.1 = e.1.min(mined);
            Ok(())
        };
        for rn in self.received_notes.iter() {
            if self.received_notes.spends_of(&rn.note_id()).any(|t| t == txid) {
                let mined = self.tx_table.get(&rn.txid()).and_then(|t| t.mined_height());
                add(rn.account_id(), rn.note().value(), mined)?;
            }
        }
        for o in self.transparent.iter() {
            if self.transparent.spends_of(&o.outpoint).any(|t| t == txid) {
                let mined = self.tx_table.get(o.outpoint.txid()).and_then(|t| t.mined_height());
                add(o.account_id, o.txout.value(), mined)?;
            }
        }
        let mut v: Vec<(AccountId, Zatoshis, u32)> =
            contribs.into_iter().map(|(a, (v, m))| (a, v, m)).collect();
        v.sort_by(|a, b| b.1.cmp(&a.1).then(a.2.cmp(&b.2)).then(a.0.cmp(&b.0)));
        Ok(v.into_iter().map(|(a, v, _)| (a, v)).collect())
    }

    /// `flag_previously_received_change`: notes received under the internal scope in
    /// `txid` by an account that also funded one of its sent outputs are change.
    pub(crate) fn flag_previously_received_change(&mut self, txid: &TxId) {
        let funding: BTreeSet<AccountId> = self
            .sent_notes
            .of_tx(txid)
            .map(|(_, o)| o.from_account_id)
            .collect();
        if funding.is_empty() {
            return;
        }
        self.received_notes.flag_change_in(txid, |rn| {
            funding.contains(&rn.account_id()) && rn.recipient_key_scope() == Some(Scope::Internal)
        });
    }

    /// Whether the note is spent as of `target_height`: some transaction recorded as
    /// spending it counts as mined or still minable (`spent_notes_clause`).
    pub(crate) fn is_note_spent(
        &self,
        note_id: &zcash_client_backend::wallet::NoteId,
        target_height: BlockHeight,
    ) -> bool {
        self.received_notes.spends_of(note_id).any(|txid| {
            self.tx_table
                .get(txid)
                .is_some_and(|tx| tx.is_mined_or_unexpired_for(&self.params, target_height))
        })
    }

    /// Whether the transparent output is spent as of `target_height` (`spent_utxos_clause`).
    pub(crate) fn is_utxo_spent(
        &self,
        outpoint: &::transparent::bundle::OutPoint,
        target_height: BlockHeight,
    ) -> bool {
        self.transparent.spends_of(outpoint).any(|txid| {
            self.tx_table
                .get(txid)
                .is_some_and(|tx| tx.is_mined_or_unexpired_for(&self.params, target_height))
        })
    }

    /// The lock-table key of a received note.
    pub(crate) fn note_lock_key(
        note_id: &zcash_client_backend::wallet::NoteId,
    ) -> crate::types::locks::LockKey {
        (
            *note_id.txid(),
            PoolType::Shielded(note_id.protocol()),
            u32::from(note_id.output_index()),
        )
    }
}
