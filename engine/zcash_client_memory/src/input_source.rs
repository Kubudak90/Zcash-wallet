//! `InputSource` for [`MemoryWalletDb`]: note and UTXO selection.
//!
//! Follows zcash_client_sqlite 0.23 `lib.rs` `impl InputSource for WalletDb` and
//! `wallet/common.rs` (`get_spendable_note`, `select_spendable_notes`,
//! `select_unspent_notes`, `select_spendable_notes_matching_value`,
//! `unspent_notes_meta`). The `NoteRef` is the [`NoteId`] (txid, pool, output index).
//!
//! Not modelled: zcash_client_sqlite's `witness_stabilized` shortcut. Without it a note is
//! selectable only when the shard containing it is fully scanned and no unscanned range
//! affects the anchor's shard, which is the conservative condition.

use std::num::NonZeroU64;

use incrementalmerkletree::Position;
use zcash_client_backend::{
    data_api::{
        AccountMeta, ChangeReceivers, InputSource, MaxSpendMode, NoteFilter, PoolMeta,
        ReceivedNotes, TargetValue,
        locking::LockFilter,
        scanning::ScanPriority,
        wallet::{ConfirmationsPolicy, TargetHeight},
    },
    wallet::{Note, NoteId, ReceivedNote},
};
use zcash_primitives::transaction::{TxId, fees::zip317};
use zcash_protocol::{
    PoolType, ShieldedPool,
    consensus::{self, BlockHeight},
    value::{BalanceError, Zatoshis},
};

#[cfg(feature = "transparent-inputs")]
use {
    ::transparent::{address::TransparentAddress, bundle::OutPoint},
    zcash_client_backend::{
        data_api::CoinbaseFilter, fees::StandardFeeRule, wallet::WalletTransparentOutput,
    },
};

use crate::{AccountId, MemoryWalletDb, ReceivedNote as StoredNote, error::Error};

/// `NoteRequest` (`wallet/common.rs`).
#[derive(Debug, Clone, Copy)]
enum NoteRequest {
    Spendable { anchor_height: BlockHeight },
    Unspent,
    UnspentOrError { anchor_height: BlockHeight },
}

impl NoteRequest {
    fn from_max_spend_mode(mode: MaxSpendMode, anchor_height: BlockHeight) -> Self {
        match mode {
            MaxSpendMode::MaxSpendable => NoteRequest::Spendable { anchor_height },
            MaxSpendMode::Everything => NoteRequest::UnspentOrError { anchor_height },
        }
    }

    fn anchor_height(&self) -> Option<BlockHeight> {
        match self {
            NoteRequest::Spendable { anchor_height }
            | NoteRequest::UnspentOrError { anchor_height } => Some(*anchor_height),
            NoteRequest::Unspent => None,
        }
    }
}

/// `ValueSelection` (`wallet/common.rs`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ValueSelection {
    Accumulate,
    SingleCovering,
}

impl<P: consensus::Parameters> MemoryWalletDb<P> {
    /// `to_received_note`: the selectable form of a stored note, with the mined height
    /// given. Requires the key scope and tree position.
    fn to_received_note(
        &self,
        rn: &StoredNote,
        mined_height: Option<BlockHeight>,
    ) -> Result<ReceivedNote<NoteId, Note>, Error> {
        let scope = rn.recipient_key_scope().ok_or_else(|| {
            Error::CorruptedData(format!("note {:?} has no recipient key scope", rn.note_id()))
        })?;
        let position = rn.commitment_tree_position().ok_or_else(|| {
            Error::CorruptedData(format!(
                "note {:?} has a nullifier but no commitment tree position",
                rn.note_id()
            ))
        })?;
        let (max_shielding_input_height, _) = self.shielding_inputs(rn.account_id(), &rn.txid());
        Ok(ReceivedNote::from_parts(
            rn.note_id(),
            rn.txid(),
            rn.output_index(),
            rn.note().clone(),
            scope,
            position,
            mined_height,
            max_shielding_input_height,
        ))
    }

    /// The conditions every selection query shares: the note belongs to `account` in
    /// `pool`, exceeds the marginal fee, has a key scope and a nullifier, is not excluded,
    /// is unspent as of `target_height`, and is eligible under `lock_filter`.
    fn selectable_base<'a>(
        &'a self,
        account: AccountId,
        pool: ShieldedPool,
        target_height: BlockHeight,
        exclude: &'a [NoteId],
        lock_filter: LockFilter<'a>,
        min_value: Zatoshis,
    ) -> impl Iterator<Item = &'a StoredNote> + 'a {
        self.received_notes.iter().filter(move |rn| {
            rn.account_id() == account
                && rn.pool() == pool
                && rn.note().value() > min_value
                && rn.recipient_key_scope().is_some()
                && rn.nullifier().is_some()
                && !exclude.contains(&rn.note_id())
                && !self.is_note_spent(&rn.note_id(), target_height)
                && self.lock_eligible(&Self::note_lock_key(&rn.note_id()), target_height, lock_filter)
        })
    }

    /// Whether the note has the confirmations `policy` requires for a transaction mined
    /// at `target_height`.
    fn note_has_confirmations(
        &self,
        rn: &StoredNote,
        mined_height: Option<BlockHeight>,
        target_height: TargetHeight,
        policy: &ConfirmationsPolicy,
    ) -> bool {
        let tx_trusted = self
            .tx_table
            .get(&rn.txid())
            .is_some_and(|t| t.is_trusted());
        let (max_sh, sh_trusted) = self.shielding_inputs(rn.account_id(), &rn.txid());
        policy.confirmations_until_spendable(
            target_height,
            PoolType::Shielded(rn.pool()),
            rn.recipient_key_scope(),
            mined_height,
            tx_trusted,
            max_sh,
            sh_trusted,
        ) == 0
    }

    /// `common::select_unspent_notes`.
    #[allow(clippy::too_many_arguments)]
    fn select_unspent_notes_inner(
        &self,
        account: AccountId,
        pool: ShieldedPool,
        target_height: TargetHeight,
        policy: ConfirmationsPolicy,
        exclude: &[NoteId],
        note_request: NoteRequest,
        lock_filter: LockFilter<'_>,
    ) -> Result<Vec<ReceivedNote<NoteId, Note>>, Error> {
        let target = BlockHeight::from(target_height);
        let mut out = vec![];
        let candidates: Vec<&StoredNote> = self
            .selectable_base(account, pool, target, exclude, lock_filter, zip317::MARGINAL_FEE)
            .filter(|rn| {
                self.tx_table
                    .get(&rn.txid())
                    .is_some_and(|t| t.is_mined_or_unexpired_for(&self.params, target))
            })
            .collect();
        for rn in candidates {
            let block = self.tx_table.get(&rn.txid()).and_then(|t| t.block());
            let note = self.to_received_note(rn, block)?;
            let shard_witness_available = self
                .shard_max_priority(pool, note.note_commitment_tree_position())
                .is_some_and(|p| p <= ScanPriority::Scanned);
            let mined_at_anchor = block
                .zip(note_request.anchor_height())
                .is_some_and(|(h, ah)| h <= ah);
            let has_confirmations = self.note_has_confirmations(rn, block, target_height, &policy);
            let eligible = shard_witness_available && mined_at_anchor && has_confirmations;
            match (note_request, eligible) {
                (NoteRequest::UnspentOrError { .. }, false) => {
                    return Err(Error::Other(
                        "the wallet holds notes that cannot be spent yet (ineligible notes)".into(),
                    ));
                }
                (NoteRequest::Spendable { .. }, false) => {}
                (NoteRequest::Unspent, false) | (_, true) => out.push(note),
            }
        }
        Ok(out)
    }

    /// `select_spendable_notes_matching_value`.
    #[allow(clippy::too_many_arguments)]
    fn select_matching_value(
        &self,
        account: AccountId,
        pool: ShieldedPool,
        target_value: Zatoshis,
        selection: ValueSelection,
        target_height: TargetHeight,
        anchor_height: BlockHeight,
        policy: ConfirmationsPolicy,
        exclude: &[NoteId],
        lock_filter: LockFilter<'_>,
    ) -> Result<Vec<ReceivedNote<NoteId, Note>>, Error> {
        let target = BlockHeight::from(target_height);
        // With an unscanned range in the anchor's shard, witnesses cannot be built.
        let tip_unscanned = self.unscanned_tip_exists(pool, anchor_height);

        // The `eligible` CTE.
        let mut eligible: Vec<(&StoredNote, BlockHeight, Option<bool>, Position)> = vec![];
        for rn in self.selectable_base(account, pool, target, exclude, lock_filter, zip317::MARGINAL_FEE)
        {
            // Mined (in a scanned block) at or below the anchor.
            let Some(block) = self.tx_table.get(&rn.txid()).and_then(|t| t.block()) else {
                continue;
            };
            if block > anchor_height {
                continue;
            }
            let Some(position) = rn.commitment_tree_position() else {
                continue;
            };
            let shard_scanned = self
                .shard_max_priority(pool, position)
                .is_some_and(|p| p <= ScanPriority::Scanned);
            if tip_unscanned || !shard_scanned {
                continue;
            }
            let tier = self.lock_tier_key(&Self::note_lock_key(&rn.note_id()), target, lock_filter);
            eligible.push((rn, block, tier, position));
        }
        // Age is the commitment tree position; the lock tier (if any) orders first.
        eligible.sort_by(|a, b| a.2.cmp(&b.2).then(a.3.cmp(&b.3)));

        let target_zats = u64::from(target_value);
        let selected: Vec<(&StoredNote, BlockHeight)> = match selection {
            ValueSelection::Accumulate => {
                // Every note whose running sum (inclusive) stays below the target, and the
                // first note whose running sum reaches it.
                let mut so_far = 0u64;
                let mut out = vec![];
                for (rn, block, _, _) in eligible {
                    so_far = so_far.saturating_add(u64::from(rn.note().value()));
                    out.push((rn, block));
                    if so_far >= target_zats {
                        break;
                    }
                }
                out
            }
            ValueSelection::SingleCovering => eligible
                .into_iter()
                .filter(|(rn, _, _, _)| rn.note().value() >= target_value)
                .map(|(rn, block, _, _)| (rn, block))
                .collect(),
        };

        selected
            .into_iter()
            .filter(|(rn, block)| self.note_has_confirmations(rn, Some(*block), target_height, &policy))
            .map(|(rn, block)| self.to_received_note(rn, Some(block)))
            .collect()
    }

    /// The minimum note value a [`NoteFilter`] asks for (`unspent_notes_meta`'s
    /// `min_note_value`).
    fn min_note_value(
        &self,
        account: AccountId,
        filter: &NoteFilter,
        target_height: TargetHeight,
    ) -> Result<Option<Zatoshis>, Error> {
        match filter {
            NoteFilter::ExceedsMinValue(v) => Ok(Some(*v)),
            NoteFilter::ExceedsPriorSendPercentile(n) => {
                // Values of the account's mined sends, excluding change and sends to the
                // account itself, split into 10 buckets (SQL NTILE(10)).
                let mut values: Vec<Zatoshis> = self
                    .sent_notes
                    .iter()
                    .filter(|(id, o)| {
                        o.from_account_id() == account
                            && o.to_account_id().is_none_or(|to| to != account)
                            && self
                                .tx_table
                                .get(id.txid())
                                .is_some_and(|t| t.mined_height().is_some())
                    })
                    .map(|(_, o)| o.value())
                    .collect();
                values.sort();
                let n_rows = values.len();
                let n_buckets = n_rows.min(10);
                let mut bucket_maxima = vec![];
                if n_buckets > 0 {
                    let base = n_rows / 10;
                    let extra = n_rows % 10;
                    let mut idx = 0;
                    for b in 0..n_buckets {
                        let size = if n_rows < 10 { 1 } else { base + usize::from(b < extra) };
                        idx += size;
                        bucket_maxima.push(values[idx - 1]);
                    }
                }
                let i = (bucket_maxima.len() * usize::from(*n) / 100).saturating_sub(1);
                Ok(bucket_maxima.get(i).copied())
            }
            NoteFilter::ExceedsBalancePercentage(p) => {
                // The account's mined, unspent shielded value.
                let target = BlockHeight::from(target_height);
                let mut balance: Option<Zatoshis> = None;
                for rn in self.received_notes.iter().filter(|rn| rn.account_id() == account) {
                    let mined = self
                        .tx_table
                        .get(&rn.txid())
                        .is_some_and(|t| t.mined_height().is_some());
                    if mined && !self.is_note_spent(&rn.note_id(), target) {
                        balance = Some(
                            (balance.unwrap_or(Zatoshis::ZERO) + rn.note().value())
                                .ok_or(BalanceError::Overflow)?,
                        );
                    }
                }
                Ok(match balance {
                    None => None,
                    Some(b) => {
                        let numerator = (b * u64::from(p.value())).ok_or(BalanceError::Overflow)?;
                        Some(numerator / NonZeroU64::new(100).expect("Constant is nonzero."))
                    }
                })
            }
            NoteFilter::Combine(a, b) => {
                let a = self.min_note_value(account, a, target_height)?;
                let b = self.min_note_value(account, b, target_height)?;
                Ok(a.zip(b).map(|(a, b)| std::cmp::max(a, b)).or(a).or(b))
            }
            NoteFilter::Attempt {
                condition,
                fallback,
            } => {
                let cond = self.min_note_value(account, condition, target_height)?;
                if cond.is_none() {
                    self.min_note_value(account, fallback, target_height)
                } else {
                    Ok(cond)
                }
            }
        }
    }

    /// `unspent_notes_meta`.
    fn unspent_notes_meta(
        &self,
        pool: ShieldedPool,
        target_height: TargetHeight,
        account: AccountId,
        filter: &NoteFilter,
        exclude: &[NoteId],
        lock_filter: LockFilter<'_>,
    ) -> Result<Option<PoolMeta>, Error> {
        let Some(min_value) = self.min_note_value(account, filter, target_height)? else {
            return Ok(None);
        };
        let target = BlockHeight::from(target_height);
        let mut count = 0usize;
        let mut total = Zatoshis::ZERO;
        for rn in self.received_notes.iter() {
            let mined = self
                .tx_table
                .get(&rn.txid())
                .is_some_and(|t| t.mined_height().is_some());
            if rn.account_id() == account
                && rn.pool() == pool
                && rn.note().value() > min_value
                && mined
                && !exclude.contains(&rn.note_id())
                && !self.is_note_spent(&rn.note_id(), target)
                && self.lock_eligible(&Self::note_lock_key(&rn.note_id()), target, lock_filter)
            {
                count += 1;
                total = (total + rn.note().value()).ok_or(BalanceError::Overflow)?;
            }
        }
        Ok(Some(PoolMeta::new(count, total)))
    }

    fn split_notes(
        notes: Vec<ReceivedNote<NoteId, Note>>,
    ) -> Result<ReceivedNotes<NoteId>, Error> {
        let mut sapling = vec![];
        #[cfg(feature = "orchard")]
        let mut orchard = vec![];
        #[cfg(feature = "orchard")]
        let mut ironwood = vec![];
        for n in notes {
            let pool = n.internal_note_id().protocol();
            match (pool, n.note()) {
                (ShieldedPool::Sapling, Note::Sapling(_)) => sapling.push(n.map_note(|note| match note {
                    Note::Sapling(note) => note,
                    #[cfg(feature = "orchard")]
                    Note::Orchard { .. } => unreachable!("matched as Sapling above"),
                })),
                #[cfg(feature = "orchard")]
                (ShieldedPool::Orchard, Note::Orchard { .. }) => orchard.push(n.map_note(orchard_note)),
                #[cfg(feature = "orchard")]
                (ShieldedPool::Ironwood, Note::Orchard { .. }) => ironwood.push(n.map_note(orchard_note)),
                _ => {
                    return Err(Error::CorruptedData(
                        "a note's pool does not match its note type".into(),
                    ));
                }
            }
        }
        Ok(ReceivedNotes::new(
            sapling,
            #[cfg(feature = "orchard")]
            orchard,
            #[cfg(feature = "orchard")]
            ironwood,
        ))
    }
}

/// The Orchard-protocol note of a [`Note`] already known to be one.
#[cfg(feature = "orchard")]
fn orchard_note(note: Note) -> orchard::note::Note {
    match note {
        Note::Orchard { note, .. } => note,
        Note::Sapling(_) => unreachable!("only called on Orchard-protocol notes"),
    }
}

impl<P: consensus::Parameters> InputSource for MemoryWalletDb<P> {
    type Error = Error;
    type AccountId = AccountId;
    type NoteRef = NoteId;

    fn get_spendable_note(
        &self,
        txid: &TxId,
        protocol: ShieldedPool,
        index: u32,
        target_height: TargetHeight,
        lock_filter: LockFilter<'_>,
    ) -> Result<Option<ReceivedNote<Self::NoteRef, Note>>, Self::Error> {
        let Ok(index) = u16::try_from(index) else {
            return Ok(None);
        };
        let note_id = NoteId::new(*txid, protocol, index);
        let target = BlockHeight::from(target_height);
        let Some(rn) = self.received_notes.get(&note_id) else {
            return Ok(None);
        };
        let Some(tx) = self.tx_table.get(txid) else {
            return Ok(None);
        };
        // `get_spendable_note`: mined in a scanned block, with key scope, nullifier and
        // position, unspent, and eligible under the lock filter.
        if tx.block().is_none()
            || rn.recipient_key_scope().is_none()
            || rn.nullifier().is_none()
            || rn.commitment_tree_position().is_none()
            || self.is_note_spent(&note_id, target)
            || !self.lock_eligible(&Self::note_lock_key(&note_id), target, lock_filter)
        {
            return Ok(None);
        }
        self.to_received_note(rn, tx.mined_height()).map(Some)
    }

    fn anchor_computable(
        &self,
        protocol: ShieldedPool,
        height: BlockHeight,
    ) -> Result<bool, Self::Error> {
        Ok(self.pool_has_checkpoint(protocol, height))
    }

    fn select_spendable_notes(
        &self,
        account: Self::AccountId,
        target_value: TargetValue,
        sources: &[ShieldedPool],
        target_height: TargetHeight,
        confirmations_policy: ConfirmationsPolicy,
        exclude: &[Self::NoteRef],
        lock_filter: LockFilter<'_>,
    ) -> Result<ReceivedNotes<Self::NoteRef>, Self::Error> {
        let Some(anchor_height) = self.anchor_height(target_height, confirmations_policy.trusted())
        else {
            return Ok(ReceivedNotes::empty());
        };
        let mut notes = vec![];
        for pool in Self::shielded_pools() {
            if !sources.contains(pool) {
                continue;
            }
            notes.extend(match target_value {
                TargetValue::AllFunds(mode) => self.select_unspent_notes_inner(
                    account,
                    *pool,
                    target_height,
                    confirmations_policy,
                    exclude,
                    NoteRequest::from_max_spend_mode(mode, anchor_height),
                    lock_filter,
                )?,
                TargetValue::AtLeast(zats) => self.select_matching_value(
                    account,
                    *pool,
                    zats,
                    ValueSelection::Accumulate,
                    target_height,
                    anchor_height,
                    confirmations_policy,
                    exclude,
                    lock_filter,
                )?,
            });
        }
        Self::split_notes(notes)
    }

    fn select_single_spendable_note(
        &self,
        account: Self::AccountId,
        value: Zatoshis,
        sources: &[ShieldedPool],
        target_height: TargetHeight,
        confirmations_policy: ConfirmationsPolicy,
        exclude: &[Self::NoteRef],
        lock_filter: LockFilter<'_>,
    ) -> Result<ReceivedNotes<Self::NoteRef>, Self::Error> {
        let Some(anchor_height) = self.anchor_height(target_height, confirmations_policy.trusted())
        else {
            return Ok(ReceivedNotes::empty());
        };
        // Pools in the caller's preference order; the first holding a covering note wins.
        for pool in sources {
            if !Self::shielded_pools().contains(pool) {
                continue;
            }
            if let Some(note) = self
                .select_matching_value(
                    account,
                    *pool,
                    value,
                    ValueSelection::SingleCovering,
                    target_height,
                    anchor_height,
                    confirmations_policy,
                    exclude,
                    lock_filter,
                )?
                .into_iter()
                .next()
            {
                return Self::split_notes(vec![note]);
            }
        }
        Ok(ReceivedNotes::empty())
    }

    fn select_unspent_notes(
        &self,
        account: Self::AccountId,
        sources: &[ShieldedPool],
        target_height: TargetHeight,
        exclude: &[Self::NoteRef],
        lock_filter: LockFilter<'_>,
    ) -> Result<ReceivedNotes<Self::NoteRef>, Self::Error> {
        let mut notes = vec![];
        for pool in Self::shielded_pools() {
            if sources.contains(pool) {
                notes.extend(self.select_unspent_notes_inner(
                    account,
                    *pool,
                    target_height,
                    ConfirmationsPolicy::MIN,
                    exclude,
                    NoteRequest::Unspent,
                    lock_filter,
                )?);
            }
        }
        Self::split_notes(notes)
    }

    fn get_change_receivers(
        &self,
        account: Self::AccountId,
    ) -> Result<ChangeReceivers, Self::Error> {
        use zcash_client_backend::data_api::Account as _;
        let account = self
            .accounts
            .get(account)
            .ok_or(Error::AccountUnknown(account))?;
        Ok(ChangeReceivers::from_uivk(&account.uivk()))
    }

    fn get_account_metadata(
        &self,
        account: Self::AccountId,
        selector: &NoteFilter,
        target_height: TargetHeight,
        exclude: &[Self::NoteRef],
        lock_filter: LockFilter<'_>,
    ) -> Result<AccountMeta, Self::Error> {
        let sapling = self.unspent_notes_meta(
            ShieldedPool::Sapling,
            target_height,
            account,
            selector,
            exclude,
            lock_filter,
        )?;
        #[cfg(feature = "orchard")]
        let orchard = self.unspent_notes_meta(
            ShieldedPool::Orchard,
            target_height,
            account,
            selector,
            exclude,
            lock_filter,
        )?;
        #[cfg(not(feature = "orchard"))]
        let orchard = None;
        #[cfg(feature = "orchard")]
        let ironwood = self.unspent_notes_meta(
            ShieldedPool::Ironwood,
            target_height,
            account,
            selector,
            exclude,
            lock_filter,
        )?;
        #[cfg(not(feature = "orchard"))]
        let ironwood = None;
        Ok(AccountMeta::new(
            sapling,
            orchard,
            ironwood,
            self.get_change_receivers(account)?,
        ))
    }

    #[cfg(feature = "transparent-inputs")]
    fn get_unspent_transparent_output(
        &self,
        outpoint: &OutPoint,
        target_height: TargetHeight,
    ) -> Result<Option<WalletTransparentOutput<Self::AccountId>>, Self::Error> {
        use zcash_client_backend::data_api::ll::LowLevelWalletRead as _;
        self.get_wallet_transparent_output(outpoint, Some(target_height))
    }

    #[cfg(feature = "transparent-inputs")]
    fn get_spendable_transparent_outputs(
        &self,
        address: &TransparentAddress,
        target_height: TargetHeight,
        confirmations_policy: ConfirmationsPolicy,
        output_filter: CoinbaseFilter,
        lock_filter: LockFilter<'_>,
    ) -> Result<Vec<WalletTransparentOutput<Self::AccountId>>, Self::Error> {
        self.spendable_transparent_outputs_for(
            core::slice::from_ref(address),
            target_height,
            confirmations_policy,
            output_filter,
            lock_filter,
        )
    }

    #[cfg(feature = "transparent-inputs")]
    fn get_spendable_transparent_outputs_for_addresses(
        &self,
        addresses: &[TransparentAddress],
        target_height: TargetHeight,
        confirmations_policy: ConfirmationsPolicy,
        output_filter: CoinbaseFilter,
        lock_filter: LockFilter<'_>,
    ) -> Result<Vec<WalletTransparentOutput<Self::AccountId>>, Self::Error> {
        self.spendable_transparent_outputs_for(
            addresses,
            target_height,
            confirmations_policy,
            output_filter,
            lock_filter,
        )
    }

    #[cfg(feature = "transparent-inputs")]
    fn select_spendable_transparent_outputs(
        &self,
        account: Self::AccountId,
        target_height: TargetHeight,
        confirmations_policy: ConfirmationsPolicy,
        output_filter: CoinbaseFilter,
        address_allow_list: Option<&[TransparentAddress]>,
        target_value: TargetValue,
        max_inputs: usize,
        fee_rule: &StandardFeeRule,
        lock_filter: LockFilter<'_>,
    ) -> Result<Vec<WalletTransparentOutput<Self::AccountId>>, Self::Error> {
        self.select_spendable_transparent(
            account,
            target_height,
            confirmations_policy,
            output_filter,
            address_allow_list,
            target_value,
            max_inputs,
            fee_rule,
            lock_filter,
        )
    }
}

