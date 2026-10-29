//! Shielded notes received by the wallet, for all three pools.
//!
//! Mirrors the `{sapling,orchard,ironwood}_received_notes` and
//! `{..}_received_note_spends` tables of zcash_client_sqlite 0.23 (`wallet/db.rs`) and the
//! rules of `put_received_note` and `mark_*_note_spent` (`wallet/sapling.rs`,
//! `wallet/orchard.rs`). One table holds the notes of every pool: a [`NoteId`] carries the
//! pool, so an Orchard action and an Ironwood action with the same index in the same
//! transaction are different notes.

use std::collections::{BTreeMap, BTreeSet, btree_map::Entry};

use incrementalmerkletree::Position;
use zcash_client_backend::wallet::{Note, NoteId};
use zcash_primitives::transaction::TxId;
use zcash_protocol::{ShieldedPool, memo::MemoBytes};
use zip32::Scope;

use crate::{
    AccountId, Nullifier,
    error::Error,
    types::{address::AddressId, transaction::TransactionTable},
};

/// A shielded note received by one of the wallet's accounts.
#[derive(Debug, Clone, PartialEq)]
pub struct ReceivedNote {
    /// Transaction, pool and output (Sapling) or action (Orchard, Ironwood) index.
    pub(crate) note_id: NoteId,
    /// The account whose viewing key decrypted the note.
    pub(crate) account_id: AccountId,
    /// The note. For Orchard-protocol notes this records the value pool (Orchard or
    /// Ironwood), which always equals `note_id.protocol()`.
    pub(crate) note: Note,
    /// The nullifier revealed when the note is spent, if the decrypting key could derive it.
    pub(crate) nf: Option<Nullifier>,
    /// Whether the note is change (received in a transaction the account also funded).
    pub(crate) is_change: bool,
    /// The memo, if known (compact block scanning does not see memos).
    pub(crate) memo: Option<MemoBytes>,
    /// The note's position in its pool's note commitment tree, once known.
    pub(crate) commitment_tree_position: Option<Position>,
    /// The ZIP 32 scope of the key that decrypted the note, if known.
    pub(crate) recipient_key_scope: Option<Scope>,
    /// The address row the note was received at; `None` for internal-scope receipt
    /// (internal addresses are not recorded).
    pub(crate) address_id: Option<AddressId>,
}

impl ReceivedNote {
    pub fn note_id(&self) -> NoteId {
        self.note_id
    }
    pub fn txid(&self) -> TxId {
        *self.note_id.txid()
    }
    pub fn pool(&self) -> ShieldedPool {
        self.note_id.protocol()
    }
    pub fn output_index(&self) -> u16 {
        self.note_id.output_index()
    }
    pub fn account_id(&self) -> AccountId {
        self.account_id
    }
    pub fn note(&self) -> &Note {
        &self.note
    }
    pub fn is_change(&self) -> bool {
        self.is_change
    }
    pub fn memo(&self) -> Option<&MemoBytes> {
        self.memo.as_ref()
    }
    pub fn commitment_tree_position(&self) -> Option<Position> {
        self.commitment_tree_position
    }
    pub fn recipient_key_scope(&self) -> Option<Scope> {
        self.recipient_key_scope
    }
    pub(crate) fn nullifier(&self) -> Option<&Nullifier> {
        self.nf.as_ref()
    }
    pub(crate) fn address_id(&self) -> Option<AddressId> {
        self.address_id
    }
}

/// The pool a [`Note`] belongs to.
pub(crate) fn note_pool(note: &Note) -> ShieldedPool {
    match note {
        Note::Sapling(_) => ShieldedPool::Sapling,
        #[cfg(feature = "orchard")]
        Note::Orchard {
            pool: orchard::ValuePool::Orchard,
            ..
        } => ShieldedPool::Orchard,
        #[cfg(feature = "orchard")]
        Note::Orchard {
            pool: orchard::ValuePool::Ironwood,
            ..
        } => ShieldedPool::Ironwood,
    }
}

/// The fields of a received output as the ll write methods hand them over.
pub(crate) struct NewReceivedNote {
    pub(crate) note_id: NoteId,
    pub(crate) account_id: AccountId,
    pub(crate) note: Note,
    pub(crate) nf: Option<Nullifier>,
    pub(crate) is_change: bool,
    pub(crate) memo: Option<MemoBytes>,
    pub(crate) commitment_tree_position: Option<Position>,
    pub(crate) recipient_key_scope: Option<Scope>,
    pub(crate) address_id: Option<AddressId>,
}

/// The received notes of all pools, with their spends.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ReceivedNoteTable {
    notes: BTreeMap<NoteId, ReceivedNote>,
    /// Unique index: a nullifier belongs to at most one note.
    by_nf: BTreeMap<Nullifier, NoteId>,
    /// `*_received_note_spends`: every transaction known to reveal the note's nullifier.
    /// Several may exist (e.g. a wallet-created transaction that expired, and its
    /// replacement); at most one of them can be mined.
    spends: BTreeMap<NoteId, BTreeSet<TxId>>,
}

impl ReceivedNoteTable {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, note_id: &NoteId) -> Option<&ReceivedNote> {
        self.notes.get(note_id)
    }

    pub fn iter(&self) -> impl Iterator<Item = &ReceivedNote> {
        self.notes.values()
    }

    pub(crate) fn by_nullifier(&self, nf: &Nullifier) -> Option<&ReceivedNote> {
        self.by_nf.get(nf).and_then(|id| self.notes.get(id))
    }

    /// The transactions recorded as revealing the note's nullifier.
    pub fn spends_of(&self, note_id: &NoteId) -> impl Iterator<Item = &TxId> {
        self.spends.get(note_id).into_iter().flatten()
    }

    /// Notes recorded as spent by `txid`.
    pub(crate) fn spent_by<'a>(&'a self, txid: &'a TxId) -> impl Iterator<Item = &'a NoteId> + 'a {
        self.spends
            .iter()
            .filter(move |(_, txs)| txs.contains(txid))
            .map(|(id, _)| id)
    }

    /// `put_received_note`: inserts the note, or updates the stored record of it.
    ///
    /// On update, as in zcash_client_sqlite's upsert: the account, note and key scope are
    /// replaced; the nullifier, memo and tree position are replaced only by known values;
    /// `is_change` only ever goes from false to true. Then, if `spent_in` is given, the
    /// spend is recorded.
    pub(crate) fn put(&mut self, new: NewReceivedNote, spent_in: Option<TxId>) -> Result<(), Error> {
        let NewReceivedNote {
            note_id,
            account_id,
            note,
            nf,
            is_change,
            memo,
            commitment_tree_position,
            recipient_key_scope,
            address_id,
        } = new;

        if note_pool(&note) != note_id.protocol() {
            return Err(Error::CorruptedData(format!(
                "note {note_id:?} is recorded in the {:?} pool but its note belongs to {:?}",
                note_id.protocol(),
                note_pool(&note),
            )));
        }
        if let Some(nf) = &nf {
            if nf.pool() != note_id.protocol() {
                return Err(Error::CorruptedData(format!(
                    "note {note_id:?} has a nullifier of the {:?} pool",
                    nf.pool()
                )));
            }
            // UNIQUE (nf): the nullifier must not belong to a different note.
            if let Some(other) = self.by_nf.get(nf) {
                if *other != note_id {
                    return Err(Error::CorruptedData(format!(
                        "nullifier of note {note_id:?} already belongs to note {other:?}"
                    )));
                }
            }
        }

        match self.notes.entry(note_id) {
            Entry::Vacant(e) => {
                e.insert(ReceivedNote {
                    note_id,
                    account_id,
                    note,
                    nf,
                    is_change,
                    memo,
                    commitment_tree_position,
                    recipient_key_scope,
                    address_id,
                });
            }
            Entry::Occupied(mut e) => {
                let rn = e.get_mut();
                if let (Some(old), Some(new)) = (&rn.nf, &nf) {
                    if old != new {
                        // The same output cannot have two nullifiers.
                        return Err(Error::CorruptedData(format!(
                            "note {note_id:?} was stored with a different nullifier"
                        )));
                    }
                }
                rn.account_id = account_id;
                rn.note = note;
                rn.nf = nf.or(rn.nf);
                rn.memo = memo.or(rn.memo.take());
                rn.is_change |= is_change;
                rn.commitment_tree_position = commitment_tree_position.or(rn.commitment_tree_position);
                rn.recipient_key_scope = recipient_key_scope;
                rn.address_id = address_id;
            }
        }
        if let Some(nf) = nf {
            self.by_nf.insert(nf, note_id);
        }
        if let Some(spent_in) = spent_in {
            self.spends.entry(note_id).or_default().insert(spent_in);
        }
        Ok(())
    }

    /// `mark_*_note_spent`: records that `spent_in` reveals `nf`.
    ///
    /// Returns `Ok(true)` if a new spend record was added, `Ok(false)` if the nullifier is
    /// not one of the wallet's or the spend was already recorded. A mined `spent_in` that
    /// would make a second mined transaction revealing the same nullifier is an error, as
    /// consensus allows only one.
    pub(crate) fn mark_spent(
        &mut self,
        nf: &Nullifier,
        spent_in: TxId,
        txs: &TransactionTable,
    ) -> Result<bool, Error> {
        let Some(note_id) = self.by_nf.get(nf).copied() else {
            return Ok(false);
        };
        let spent_in_is_mined = txs
            .get(&spent_in)
            .is_some_and(|tx| tx.mined_height().is_some());
        if spent_in_is_mined {
            let collision = self.spends_of(&note_id).any(|other| {
                *other != spent_in && txs.get(other).is_some_and(|tx| tx.mined_height().is_some())
            });
            if collision {
                return Err(Error::CorruptedData(format!(
                    "a different mined transaction revealing {:?} nullifier {} already exists",
                    nf.pool(),
                    nullifier_hex(nf),
                )));
            }
        }
        Ok(self.spends.entry(note_id).or_default().insert(spent_in))
    }

    /// Sets `is_change` on the notes received in `txid` that satisfy `pred`.
    pub(crate) fn flag_change_in(&mut self, txid: &TxId, pred: impl Fn(&ReceivedNote) -> bool) {
        for rn in self.notes.values_mut() {
            if rn.note_id.txid() == txid && pred(rn) {
                rn.is_change = true;
            }
        }
    }

    /// Removes spend records made by `txid` (used when a transaction is removed).
    pub(crate) fn remove_spends_by(&mut self, txid: &TxId) {
        for txs in self.spends.values_mut() {
            txs.remove(txid);
        }
        self.spends.retain(|_, txs| !txs.is_empty());
    }

    /// Removes the notes received in `txid`, with their spend records.
    pub(crate) fn remove_notes_of(&mut self, txid: &TxId) {
        let ids: Vec<NoteId> = self
            .notes
            .keys()
            .filter(|id| id.txid() == txid)
            .copied()
            .collect();
        for id in ids {
            if let Some(rn) = self.notes.remove(&id) {
                if let Some(nf) = rn.nf {
                    self.by_nf.remove(&nf);
                }
            }
            self.spends.remove(&id);
        }
    }

    /// Removes the notes of `account`, with their spend records.
    pub(crate) fn remove_account(&mut self, account: AccountId) {
        let ids: Vec<NoteId> = self
            .notes
            .values()
            .filter(|rn| rn.account_id == account)
            .map(|rn| rn.note_id)
            .collect();
        for id in ids {
            if let Some(rn) = self.notes.remove(&id) {
                if let Some(nf) = rn.nf {
                    self.by_nf.remove(&nf);
                }
            }
            self.spends.remove(&id);
        }
    }

    /// Every recorded spend: note, and the transactions revealing its nullifier.
    pub(crate) fn all_spends(&self) -> impl Iterator<Item = (&NoteId, &BTreeSet<TxId>)> {
        self.spends.iter()
    }

    /// Rebuilds the table from stored rows (deserialization), checking the nullifier
    /// uniqueness and pool consistency rules that `put` enforces.
    pub(crate) fn from_parts(
        notes: Vec<ReceivedNote>,
        spends: Vec<(NoteId, BTreeSet<TxId>)>,
    ) -> Result<Self, Error> {
        let mut table = Self::new();
        for rn in notes {
            if note_pool(&rn.note) != rn.note_id.protocol()
                || rn.nf.is_some_and(|nf| nf.pool() != rn.note_id.protocol())
            {
                return Err(Error::CorruptedData(format!(
                    "stored note {:?} has an inconsistent pool",
                    rn.note_id
                )));
            }
            if let Some(nf) = rn.nf {
                if table.by_nf.insert(nf, rn.note_id).is_some() {
                    return Err(Error::CorruptedData(
                        "two stored notes share a nullifier".into(),
                    ));
                }
            }
            if table.notes.insert(rn.note_id, rn).is_some() {
                return Err(Error::CorruptedData("duplicate stored note".into()));
            }
        }
        for (id, txs) in spends {
            if !table.notes.contains_key(&id) {
                return Err(Error::CorruptedData(format!(
                    "a stored spend refers to unknown note {id:?}"
                )));
            }
            if !txs.is_empty() {
                table.spends.insert(id, txs);
            }
        }
        Ok(table)
    }
}

fn nullifier_hex(nf: &Nullifier) -> String {
    match nf {
        Nullifier::Sapling(nf) => hex::encode(nf.0),
        #[cfg(feature = "orchard")]
        Nullifier::Orchard(nf) | Nullifier::Ironwood(nf) => hex::encode(nf.to_bytes()),
    }
}
