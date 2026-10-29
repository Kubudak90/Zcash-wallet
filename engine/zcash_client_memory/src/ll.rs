//! zcash_client_backend 0.25's low-level wallet traits (`data_api::ll`), and
//! `AddressStore` for transparent gap-limit address generation.
//!
//! `WalletWrite::put_blocks` and `store_decrypted_tx` delegate to
//! `data_api::ll::wallet::{put_blocks, store_decrypted_tx}`, which drive everything
//! through these methods. Each method follows the zcash_client_sqlite 0.23 function named
//! in its comment; the row-level rules live in `types/*` and `db_ops.rs`.

use std::collections::{BTreeSet, HashSet};
use std::ops::Range;

use incrementalmerkletree::{Address, Position};
use zcash_address::ZcashAddress;
use zcash_client_backend::{
    data_api::{
        ORCHARD_SHARD_HEIGHT, SAPLING_SHARD_HEIGHT, TransactionStatus,
        ll::{
            LowLevelWalletRead, LowLevelWalletWrite, ReceivedSaplingOutput,
            ReceivedShieldedOutput,
        },
        scanning::{ScanPriority, ScanRange},
        wallet::TargetHeight,
    },
    wallet::{NoteId, Recipient, WalletTx},
};
use zcash_keys::address::Receiver;
use zcash_primitives::{
    block::BlockHash,
    transaction::{Transaction, builder::default_tx_expiry_delta},
};
use zcash_protocol::{
    PoolType, ShieldedPool, TxId,
    consensus::{self, BlockHeight, BranchId, NetworkUpgrade, TxIndex},
    memo::MemoBytes,
    value::Zatoshis,
    zip318::Zip318Classification,
};

#[cfg(feature = "orchard")]
use zcash_client_backend::data_api::ll::ReceivedOrchardOutput;

#[cfg(feature = "transparent-inputs")]
use {
    ::transparent::{
        address::TransparentAddress,
        bundle::OutPoint,
        keys::{NonHardenedChildIndex, TransparentKeyScope},
    },
    zcash_client_backend::{
        data_api::{DecryptedTransaction, ll::wallet::generate_transparent_gap_addresses},
        wallet::WalletTransparentOutput,
    },
    zcash_keys::{
        encoding::AddressCodec as _,
        keys::{
            ReceiverRequirement::{Allow, Require},
            UnifiedAddressRequest,
            transparent::gap_limits::{AddressStore, GapLimits},
        },
    },
};

use crate::{
    Account, AccountId, MemoryWalletBlock, MemoryWalletDb, Nullifier, PRUNING_DEPTH,
    error::Error,
    types::{
        data_requests::TxQueryType,
        notes::{NewReceivedNote, SentOutput, SentOutputId},
    },
};

#[cfg(feature = "transparent-inputs")]
use crate::types::{address::KeyScope, transparent::ReceivedTransparentOutput};

impl<P: consensus::Parameters> MemoryWalletDb<P> {
    fn require_account(&self, account: AccountId) -> Result<(), Error> {
        self.accounts
            .get(account)
            .map(|_| ())
            .ok_or(Error::AccountUnknown(account))
    }

    /// `{sapling,orchard}::put_received_note`, for any pool.
    fn put_received_shielded<T: ReceivedShieldedOutput<AccountId = AccountId>>(
        &mut self,
        pool: ShieldedPool,
        output: &T,
        nf: Option<Nullifier>,
        tx_ref: TxId,
        target_or_mined_height: Option<BlockHeight>,
        spent_in: Option<TxId>,
    ) -> Result<(), Error> {
        let account_id = output.account_id();
        self.require_account(account_id)?;
        if !self.tx_table.contains(&tx_ref) {
            return Err(Error::TransactionNotFound(tx_ref));
        }
        if let Some(spending_tx) = spent_in {
            self.ensure_tx_from_locator(spending_tx)?;
        }
        let note = output.to_wallet_note();
        let output_index = u16::try_from(output.index())?;
        let address_id = self.ensure_note_address(
            account_id,
            &note,
            output.recipient_key_scope(),
            target_or_mined_height,
        )?;
        self.received_notes.put(
            NewReceivedNote {
                note_id: NoteId::new(tx_ref, pool, output_index),
                account_id,
                note,
                nf,
                is_change: output.is_change(),
                memo: output.memo().cloned(),
                commitment_tree_position: output.note_commitment_tree_position(),
                recipient_key_scope: output.recipient_key_scope(),
                address_id,
            },
            spent_in,
        )
    }

    /// `mark_*_note_spent`.
    fn mark_shielded_spent(&mut self, nf: Nullifier, tx_ref: TxId) -> Result<bool, Error> {
        self.received_notes.mark_spent(&nf, tx_ref, &self.tx_table)
    }

    /// The account owning a note with each of the given nullifiers.
    fn detect_accounts_by_nf(&self, nfs: impl Iterator<Item = Nullifier>) -> HashSet<AccountId> {
        nfs.filter_map(|nf| self.received_notes.by_nullifier(&nf))
            .map(|rn| rn.account_id())
            .collect()
    }

    /// The transaction that revealed `nf`, if observed while scanning. The transaction
    /// row is created when the spend is recorded (see `put_received_shielded`).
    fn detect_spend(&self, nf: &Nullifier) -> Option<TxId> {
        self.spend_maps.find_nullifier(nf).map(|(_, _, txid)| txid)
    }

    /// `scanning::extend_range`.
    fn extend_range(
        &self,
        pool: ShieldedPool,
        range: &Range<BlockHeight>,
        required_subtree_indices: &BTreeSet<u64>,
        fallback_start_height: Option<BlockHeight>,
        birthday_height: Option<BlockHeight>,
    ) -> Option<Range<BlockHeight>> {
        let (min_idx, max_idx) = required_subtree_indices
            .first()
            .zip(required_subtree_indices.last())?;
        let shard_end = |index: u64| -> Option<BlockHeight> {
            match pool {
                ShieldedPool::Sapling => self.sapling.subtree_end_height(index),
                #[cfg(feature = "orchard")]
                ShieldedPool::Orchard => self.orchard.subtree_end_height(index),
                #[cfg(feature = "orchard")]
                ShieldedPool::Ironwood => self.ironwood.subtree_end_height(index),
                #[cfg(not(feature = "orchard"))]
                _ => None,
            }
        };
        let range_min = if *min_idx > 0 {
            shard_end(*min_idx - 1)
        } else {
            fallback_start_height
        };
        let range_min = range_min.map(|h| birthday_height.map_or(h, |b| std::cmp::max(b, h)));
        let range_max = shard_end(*max_idx).map(|end| end + 1);
        Some(Range {
            start: range.start.min(range_min.unwrap_or(range.start)),
            end: range.end.max(range_max.unwrap_or(range.end)),
        })
    }

    /// `scanning::scan_complete`.
    fn scan_complete(
        &mut self,
        range: Range<BlockHeight>,
        wallet_note_positions: &[(ShieldedPool, Position)],
    ) -> Result<(), Error> {
        let wallet_birthday = self.wallet_birthday();

        let mut required: [BTreeSet<u64>; 3] = Default::default();
        for (pool, position) in wallet_note_positions {
            let (i, shard_height) = match pool {
                ShieldedPool::Sapling => (0, SAPLING_SHARD_HEIGHT),
                ShieldedPool::Orchard => (1, ORCHARD_SHARD_HEIGHT),
                ShieldedPool::Ironwood => (2, ORCHARD_SHARD_HEIGHT),
            };
            #[cfg(not(feature = "orchard"))]
            if i > 0 {
                return Err(Error::OrchardNotEnabled);
            }
            required[i].insert(Address::above_position(shard_height.into(), *position).index());
        }

        let extended_range = self.extend_range(
            ShieldedPool::Sapling,
            &range,
            &required[0],
            self.params.activation_height(NetworkUpgrade::Sapling),
            wallet_birthday,
        );
        #[cfg(feature = "orchard")]
        let extended_range = self
            .extend_range(
                ShieldedPool::Orchard,
                extended_range.as_ref().unwrap_or(&range),
                &required[1],
                self.params.activation_height(NetworkUpgrade::Nu5),
                wallet_birthday,
            )
            .or(extended_range);
        // The Ironwood tree starts at NU6.3.
        #[cfg(feature = "orchard")]
        let extended_range = self
            .extend_range(
                ShieldedPool::Ironwood,
                extended_range.as_ref().unwrap_or(&range),
                &required[2],
                self.params.activation_height(NetworkUpgrade::Nu6_3),
                wallet_birthday,
            )
            .or(extended_range);

        let query_range = extended_range.clone().unwrap_or_else(|| range.clone());
        let scanned = ScanRange::from_parts(range.clone(), ScanPriority::Scanned);
        // Empty ranges would stop SpanningTree from merging the scanned ranges around them.
        let extended_before = extended_range
            .as_ref()
            .map(|e| ScanRange::from_parts(e.start..range.start, ScanPriority::FoundNote))
            .filter(|r| !r.is_empty());
        let extended_after = extended_range
            .map(|e| ScanRange::from_parts(range.end..e.end, ScanPriority::FoundNote))
            .filter(|r| !r.is_empty());
        let replacement = Some(scanned)
            .into_iter()
            .chain(extended_before)
            .chain(extended_after);
        self.scan_queue
            .replace_queue_entries(&query_range, replacement, false)
    }

    /// Whether a queued `GetStatus` request for an unmined transaction is still useful:
    /// the condition of zcash_client_sqlite's `transaction_data_requests` and of the
    /// status-entry cleanup in `set_transaction_status`.
    pub(crate) fn status_request_active(&self, txid: &TxId) -> bool {
        let Some(t) = self.tx_table.get(txid) else {
            // LEFT JOIN with no row: t.mined_height IS NULL and
            // t.confirmed_unmined_at_height IS NULL, so the request is active.
            return true;
        };
        if t.mined_height().is_some() {
            return false;
        }
        match (t.confirmed_unmined_at_height(), t.expiry_height()) {
            (None, _) => true,
            (Some(_), Some(e)) if u32::from(e) == 0 => true,
            (Some(c), Some(e)) => c < e,
            (Some(c), None) => {
                let delta = default_tx_expiry_delta(BranchId::for_height(
                    &self.params,
                    t.min_observed_height(),
                ));
                c < t.min_observed_height() + PRUNING_DEPTH + delta
            }
        }
    }

    /// `transparent::update_gap_limits`.
    #[cfg(feature = "transparent-inputs")]
    fn update_gap_limits_for(
        &mut self,
        gap_limits: &GapLimits,
        txid: TxId,
        observation_height: BlockHeight,
    ) -> Result<(), Error> {
        // Addresses that received an output of `txid`, or whose output `txid` spends.
        let mut ids = BTreeSet::new();
        for o in self.transparent.iter() {
            if *o.outpoint.txid() == txid || self.transparent.spends_of(&o.outpoint).any(|t| *t == txid)
            {
                ids.insert(o.address_id);
            }
        }
        for id in ids {
            self.addresses.mark_exposed(id, observation_height);
            let (account, scope) = match self.addresses.get(id) {
                Some(a) => (a.account_id, a.key_scope),
                None => continue,
            };
            if let Some(t_scope) = scope.as_transparent() {
                generate_transparent_gap_addresses(
                    self,
                    *gap_limits,
                    account,
                    t_scope,
                    UnifiedAddressRequest::unsafe_custom(Allow, Allow, Require),
                )?;
            }
        }
        Ok(())
    }

    /// `transparent::mark_transparent_utxo_spent`.
    #[cfg(feature = "transparent-inputs")]
    fn mark_utxo_spent(&mut self, outpoint: &OutPoint, spent_in: TxId) -> bool {
        let known = self.transparent.get(outpoint).is_some();
        if known {
            self.transparent.record_spend(outpoint, spent_in);
        }
        // The output is known to be spent, so its spend need not be searched for.
        self.transparent_spend_search_queue
            .remove(outpoint.txid(), outpoint.n());
        if !known {
            // Remember the spend, so it can be linked when the output is discovered.
            self.transparent
                .spend_map
                .insert((spent_in, outpoint.clone()));
        }
        known
    }
}

impl<P: consensus::Parameters> LowLevelWalletRead for MemoryWalletDb<P> {
    type Error = Error;
    type AccountId = AccountId;
    type AccountRef = AccountId;
    type Account = Account;
    type TxRef = TxId;

    fn block_fully_scanned_height(&self) -> Result<Option<BlockHeight>, Self::Error> {
        // `block_fully_scanned` returns the metadata of that block, so only a height whose
        // block is stored counts.
        Ok(self
            .fully_scanned_height()
            .filter(|h| self.block_known(*h)))
    }

    fn select_receiving_address(
        &self,
        account: Self::AccountId,
        receiver: &Receiver,
    ) -> Result<Option<ZcashAddress>, Self::Error> {
        match receiver {
            #[cfg(feature = "transparent-inputs")]
            Receiver::Transparent(taddr) => Ok(self
                .addresses
                .find_by_transparent_receiver(taddr)
                .map(|(_, a)| a.address.to_zcash_address(&self.params))),
            receiver => Ok(self
                .addresses
                .for_account(account)
                .filter(|(_, a)| a.key_scope == crate::types::address::KeyScope::External)
                .map(|(_, a)| a.address.to_zcash_address(&self.params))
                .find(|addr| receiver.corresponds(addr))),
        }
    }

    #[cfg(feature = "transparent-inputs")]
    fn find_account_for_transparent_address(
        &self,
        address: &TransparentAddress,
    ) -> Result<Option<(Self::AccountId, Option<TransparentKeyScope>)>, Self::Error> {
        // `find_account_uuid_for_transparent_address`: the addresses table first, then
        // each account's legacy address (BIP 44 index 0), which may have no row.
        if let Some((_, a)) = self.addresses.find_by_transparent_receiver(address) {
            return Ok(Some((a.account_id, a.key_scope.as_transparent())));
        }
        for account in self.accounts.iter() {
            use ::transparent::keys::IncomingViewingKey as _;
            use zcash_client_backend::data_api::Account as _;
            if let Some(ivk) = account.uivk().p2pkh() {
                let (legacy, _) = ivk.default_address();
                if &legacy == address {
                    return Ok(Some((account.id, Some(TransparentKeyScope::EXTERNAL))));
                }
            }
        }
        Ok(None)
    }

    #[cfg(feature = "transparent-inputs")]
    fn find_involved_accounts(
        &self,
        tx_refs: impl IntoIterator<Item = Self::TxRef>,
    ) -> Result<HashSet<(Self::AccountId, Option<TransparentKeyScope>)>, Self::Error> {
        let txids: BTreeSet<TxId> = tx_refs.into_iter().collect();
        Ok(self
            .address_uses_in(&txids)
            .into_iter()
            .map(|(account, scope)| (account, scope.as_transparent()))
            .collect())
    }

    #[cfg(feature = "transparent-inputs")]
    fn detect_accounts_transparent<'a>(
        &self,
        spends: impl Iterator<Item = &'a OutPoint>,
    ) -> Result<HashSet<Self::AccountId>, Self::Error> {
        Ok(spends
            .filter_map(|op| self.transparent.get(op))
            .map(|o| o.account_id)
            .collect())
    }

    fn detect_accounts_sapling<'a>(
        &self,
        spends: impl Iterator<Item = &'a sapling::Nullifier>,
    ) -> Result<HashSet<Self::AccountId>, Self::Error> {
        Ok(self.detect_accounts_by_nf(spends.map(|nf| Nullifier::Sapling(*nf))))
    }

    #[cfg(feature = "orchard")]
    fn detect_accounts_orchard<'a>(
        &self,
        spends: impl Iterator<Item = &'a orchard::note::Nullifier>,
    ) -> Result<HashSet<Self::AccountId>, Self::Error> {
        Ok(self.detect_accounts_by_nf(spends.map(|nf| Nullifier::Orchard(*nf))))
    }

    #[cfg(feature = "orchard")]
    fn detect_accounts_ironwood<'a>(
        &self,
        spends: impl Iterator<Item = &'a orchard::note::Nullifier>,
    ) -> Result<HashSet<Self::AccountId>, Self::Error> {
        Ok(self.detect_accounts_by_nf(spends.map(|nf| Nullifier::Ironwood(*nf))))
    }

    #[cfg(feature = "transparent-inputs")]
    fn get_wallet_transparent_output(
        &self,
        outpoint: &OutPoint,
        target_height: Option<TargetHeight>,
    ) -> Result<Option<WalletTransparentOutput<Self::AccountId>>, Self::Error> {
        let Some(o) = self.transparent.get(outpoint) else {
            return Ok(None);
        };
        let creating_tx = self.tx_table.get(outpoint.txid());
        if let Some(target_height) = target_height {
            let target_height = BlockHeight::from(target_height);
            // `get_wallet_transparent_output` with `:allow_unspendable` false: the creating
            // transaction is mined or unexpired, the output is unspent, and it is not a
            // likely-spent wallet-internal ephemeral output.
            let creating_ok = creating_tx
                .is_some_and(|t| t.is_mined_or_unexpired_for(&self.params, target_height));
            if !creating_ok || self.is_utxo_spent(outpoint, target_height) {
                return Ok(None);
            }
            if !self.ephemeral_output_eligible(o)? {
                return Ok(None);
            }
        }
        let funding_account = self
            .funding_accounts_of(outpoint.txid())?
            .into_iter()
            .next()
            .map(|(a, _)| a);
        let key_scope = self
            .addresses
            .get(o.address_id)
            .and_then(|a| a.key_scope.as_transparent());
        WalletTransparentOutput::from_parts(
            outpoint.clone(),
            o.txout.clone(),
            creating_tx.and_then(|t| t.mined_height()),
            Some(o.account_id),
            key_scope,
            funding_account,
        )
        .map(Some)
        .ok_or_else(|| {
            Error::CorruptedData(
                "txout script_pubkey is not a P2PKH or P2SH script".to_owned(),
            )
        })
    }

    fn get_unknown_fee_spenders_of(
        &self,
        tx_ref: Self::TxRef,
    ) -> Result<Vec<(Self::TxRef, Transaction)>, Self::Error> {
        // Transactions that spend a transparent output created by `tx_ref`, whose fee is
        // unknown and whose data the wallet has.
        let mut spenders = BTreeSet::new();
        for o in self.transparent.iter() {
            if *o.outpoint.txid() == tx_ref {
                spenders.extend(self.transparent.spends_of(&o.outpoint).copied());
            }
        }
        let mut out = vec![];
        for txid in spenders {
            if let Some(t) = self.tx_table.get(&txid) {
                if t.fee().is_none() {
                    if let Some(tx) = t.parse()? {
                        out.push((txid, tx));
                    }
                }
            }
        }
        Ok(out)
    }

    fn detect_sapling_spend(
        &self,
        nf: &::sapling::Nullifier,
    ) -> Result<Option<Self::TxRef>, Self::Error> {
        Ok(self.detect_spend(&Nullifier::Sapling(*nf)))
    }

    #[cfg(feature = "orchard")]
    fn detect_orchard_spend(
        &self,
        nf: &::orchard::note::Nullifier,
    ) -> Result<Option<Self::TxRef>, Self::Error> {
        Ok(self.detect_spend(&Nullifier::Orchard(*nf)))
    }

    #[cfg(feature = "orchard")]
    fn detect_ironwood_spend(
        &self,
        nf: &::orchard::note::Nullifier,
    ) -> Result<Option<Self::TxRef>, Self::Error> {
        Ok(self.detect_spend(&Nullifier::Ironwood(*nf)))
    }

    #[cfg(feature = "transparent-inputs")]
    fn get_account_ref(
        &self,
        account_uuid: Self::AccountId,
    ) -> Result<Self::AccountRef, Self::Error> {
        self.require_account(account_uuid)?;
        Ok(account_uuid)
    }

    #[cfg(feature = "transparent-inputs")]
    fn get_account_internal(
        &self,
        account_id: Self::AccountRef,
    ) -> Result<Option<Self::Account>, Self::Error> {
        Ok(self.accounts.get(account_id).cloned())
    }
}

impl<P: consensus::Parameters> LowLevelWalletWrite for MemoryWalletDb<P> {
    fn put_block_meta(
        &mut self,
        block_height: BlockHeight,
        block_hash: BlockHash,
        block_time: u32,
        sapling_commitment_tree_size: u32,
        sapling_output_count: u32,
        #[cfg(feature = "orchard")] orchard_commitment_tree_size: u32,
        #[cfg(feature = "orchard")] orchard_action_count: u32,
        #[cfg(feature = "orchard")] ironwood_commitment_tree_size: u32,
        #[cfg(feature = "orchard")] ironwood_action_count: u32,
    ) -> Result<(), Self::Error> {
        // `put_block`: an upsert keyed by height.
        self.blocks.insert(
            block_height,
            MemoryWalletBlock {
                height: block_height,
                hash: block_hash,
                block_time,
                sapling_commitment_tree_size,
                sapling_output_count,
                #[cfg(feature = "orchard")]
                orchard_commitment_tree_size,
                #[cfg(feature = "orchard")]
                orchard_action_count,
                #[cfg(feature = "orchard")]
                ironwood_commitment_tree_size,
                #[cfg(feature = "orchard")]
                ironwood_action_count,
            },
        );
        // As in sqlite's `put_block`, transaction rows are not touched here: scanning
        // sets `block` through `put_tx_meta` for every wallet transaction in the block.
        Ok(())
    }

    fn put_tx_meta(
        &mut self,
        tx: &WalletTx<Self::AccountId>,
        height: BlockHeight,
    ) -> Result<Self::TxRef, Self::Error> {
        let block_known = self.block_known(height);
        Ok(self
            .tx_table
            .put_tx_meta(tx.txid(), u16::from(tx.block_index()), height, block_known))
    }

    fn put_tx_data(
        &mut self,
        tx: &Transaction,
        fee: Option<Zatoshis>,
        created_at: Option<time::OffsetDateTime>,
        target_height: Option<TargetHeight>,
        observed_height: BlockHeight,
    ) -> Result<Self::TxRef, Self::Error> {
        self.tx_table
            .put_tx_data(tx, fee, created_at, target_height, observed_height)
    }

    fn set_transaction_status(
        &mut self,
        txid: TxId,
        status: TransactionStatus,
    ) -> Result<(), Self::Error> {
        // `wallet::set_transaction_status`.
        let chain_tip = self.chain_tip_height().ok_or(Error::ChainHeightUnknown)?;
        match status {
            TransactionStatus::TxidNotRecognized | TransactionStatus::NotInMainChain => {
                self.tx_table.set_unmined_at(&txid, chain_tip);
                // Enhancement is over once the server says it cannot provide the
                // transaction; a status request stays while the transaction may still be
                // mined.
                self.tx_retrieval_queue
                    .remove(&txid, TxQueryType::Enhancement);
                // sqlite deletes the status request unless a row for the transaction
                // exists that may still be mined (no row at all: deleted).
                let keep = self.tx_table.contains(&txid) && self.status_request_active(&txid);
                if !keep {
                    self.tx_retrieval_queue.remove(&txid, TxQueryType::Status);
                }
            }
            TransactionStatus::Mined(height) => {
                let block_known = self.block_known(height);
                self.tx_table.set_mined(&txid, height, block_known);
                #[cfg(feature = "transparent-inputs")]
                {
                    let gap_limits = self.gap_limits;
                    self.update_gap_limits_for(&gap_limits, txid, height)?;
                }
                // The status request (if any) stays, dormant while the tx is mined, so it
                // becomes active again if a rewind un-mines the transaction.
                self.tx_retrieval_queue
                    .remove(&txid, TxQueryType::Enhancement);
            }
        }
        Ok(())
    }

    fn put_zip318_classification(
        &mut self,
        tx_ref: Self::TxRef,
        classification: Zip318Classification,
    ) -> Result<(), Self::Error> {
        self.tx_table
            .put_zip318_classification(&tx_ref, classification)
    }

    fn put_received_sapling_note<T: ReceivedSaplingOutput<AccountId = Self::AccountId>>(
        &mut self,
        output: &T,
        tx_ref: Self::TxRef,
        target_or_mined_height: Option<BlockHeight>,
        spent_in: Option<Self::TxRef>,
    ) -> Result<(), Self::Error> {
        let nf = output.nullifier().map(|nf| Nullifier::Sapling(*nf));
        self.put_received_shielded(
            ShieldedPool::Sapling,
            output,
            nf,
            tx_ref,
            target_or_mined_height,
            spent_in,
        )
    }

    fn mark_sapling_note_spent(
        &mut self,
        nf: &::sapling::Nullifier,
        spent_in_tx: Self::TxRef,
    ) -> Result<bool, Self::Error> {
        self.mark_shielded_spent(Nullifier::Sapling(*nf), spent_in_tx)
    }

    fn track_block_sapling_nullifiers(
        &mut self,
        block_height: BlockHeight,
        nfs: &[(TxIndex, TxId, Vec<::sapling::Nullifier>)],
    ) -> Result<(), Self::Error> {
        self.spend_maps.insert_nullifiers(
            block_height,
            nfs.iter().map(|(idx, txid, nfs)| {
                (
                    u16::from(*idx),
                    *txid,
                    nfs.iter().map(|nf| Nullifier::Sapling(*nf)).collect(),
                )
            }),
        )
    }

    #[cfg(feature = "orchard")]
    fn put_received_orchard_note<T: ReceivedOrchardOutput<AccountId = Self::AccountId>>(
        &mut self,
        output: &T,
        tx_ref: Self::TxRef,
        target_or_mined_height: Option<BlockHeight>,
        spent_in: Option<Self::TxRef>,
    ) -> Result<(), Self::Error> {
        let nf = output.nullifier().map(|nf| Nullifier::Orchard(*nf));
        self.put_received_shielded(
            ShieldedPool::Orchard,
            output,
            nf,
            tx_ref,
            target_or_mined_height,
            spent_in,
        )
    }

    #[cfg(feature = "orchard")]
    fn put_received_ironwood_note<T: ReceivedOrchardOutput<AccountId = Self::AccountId>>(
        &mut self,
        output: &T,
        tx_ref: Self::TxRef,
        target_or_mined_height: Option<BlockHeight>,
        spent_in: Option<Self::TxRef>,
    ) -> Result<(), Self::Error> {
        let nf = output.nullifier().map(|nf| Nullifier::Ironwood(*nf));
        self.put_received_shielded(
            ShieldedPool::Ironwood,
            output,
            nf,
            tx_ref,
            target_or_mined_height,
            spent_in,
        )
    }

    #[cfg(feature = "orchard")]
    fn mark_orchard_note_spent(
        &mut self,
        nf: &::orchard::note::Nullifier,
        tx_ref: Self::TxRef,
    ) -> Result<bool, Self::Error> {
        self.mark_shielded_spent(Nullifier::Orchard(*nf), tx_ref)
    }

    #[cfg(feature = "orchard")]
    fn mark_ironwood_note_spent(
        &mut self,
        nf: &::orchard::note::Nullifier,
        tx_ref: Self::TxRef,
    ) -> Result<bool, Self::Error> {
        self.mark_shielded_spent(Nullifier::Ironwood(*nf), tx_ref)
    }

    #[cfg(feature = "orchard")]
    fn track_block_orchard_nullifiers(
        &mut self,
        block_height: BlockHeight,
        nfs: &[(TxIndex, TxId, Vec<::orchard::note::Nullifier>)],
    ) -> Result<(), Self::Error> {
        self.spend_maps.insert_nullifiers(
            block_height,
            nfs.iter().map(|(idx, txid, nfs)| {
                (
                    u16::from(*idx),
                    *txid,
                    nfs.iter().map(|nf| Nullifier::Orchard(*nf)).collect(),
                )
            }),
        )
    }

    #[cfg(feature = "orchard")]
    fn track_block_ironwood_nullifiers(
        &mut self,
        block_height: BlockHeight,
        nfs: &[(TxIndex, TxId, Vec<::orchard::note::Nullifier>)],
    ) -> Result<(), Self::Error> {
        self.spend_maps.insert_nullifiers(
            block_height,
            nfs.iter().map(|(idx, txid, nfs)| {
                (
                    u16::from(*idx),
                    *txid,
                    nfs.iter().map(|nf| Nullifier::Ironwood(*nf)).collect(),
                )
            }),
        )
    }

    #[cfg(feature = "transparent-inputs")]
    fn track_block_transparent_spends(
        &mut self,
        block_height: BlockHeight,
        spends: &[(TxIndex, TxId, Vec<OutPoint>)],
    ) -> Result<(), Self::Error> {
        let entries: Vec<(u16, TxId, Vec<OutPoint>)> = spends
            .iter()
            .map(|(idx, txid, ops)| (u16::from(*idx), *txid, ops.clone()))
            .collect();
        self.spend_maps
            .insert_transparent_spends(block_height, &entries)
    }

    fn prune_tracked_spends(&mut self, pruning_depth: u32) -> Result<(), Self::Error> {
        // `prune_tracked_spends`: below the fully scanned height (as reported by
        // `block_fully_scanned`) minus the pruning depth.
        if let Some(h) = self.block_fully_scanned_height()? {
            self.spend_maps.prune_below(h.saturating_sub(pruning_depth));
        }
        Ok(())
    }

    fn put_sent_output(
        &mut self,
        from_account_uuid: Self::AccountId,
        tx_ref: Self::TxRef,
        output_index: usize,
        recipient: &Recipient<Self::AccountId>,
        value: Zatoshis,
        memo: Option<&MemoBytes>,
    ) -> Result<(), Self::Error> {
        // `put_sent_output` / `recipient_params`.
        self.require_account(from_account_uuid)?;
        let (to_address, to_account_id, pool) = match recipient {
            Recipient::External {
                recipient_address,
                output_pool,
            } => (Some(recipient_address.encode()), None, *output_pool),
            #[cfg(feature = "transparent-inputs")]
            Recipient::EphemeralTransparent {
                receiving_account,
                ephemeral_address,
                ..
            } => {
                self.require_account(*receiving_account)?;
                (
                    Some(ephemeral_address.encode(&self.params)),
                    Some(*receiving_account),
                    PoolType::TRANSPARENT,
                )
            }
            #[cfg(feature = "transparent-inputs")]
            Recipient::InternalTransparent {
                receiving_account,
                recipient_address,
            } => {
                self.require_account(*receiving_account)?;
                (
                    Some(recipient_address.encode(&self.params)),
                    Some(*receiving_account),
                    PoolType::TRANSPARENT,
                )
            }
            Recipient::InternalShielded {
                receiving_account,
                external_address,
                note,
            } => {
                self.require_account(*receiving_account)?;
                (
                    external_address.as_ref().map(|a| a.encode()),
                    Some(*receiving_account),
                    PoolType::Shielded(note.pool()),
                )
            }
        };
        self.sent_notes.put(
            SentOutputId {
                txid: tx_ref,
                pool,
                output_index: u32::try_from(output_index)?,
            },
            SentOutput {
                from_account_id: from_account_uuid,
                to_address,
                to_account_id,
                value,
                memo: memo.cloned(),
            },
        );
        self.flag_previously_received_change(&tx_ref);
        Ok(())
    }

    fn update_tx_fee(&mut self, tx_ref: Self::TxRef, fee: Zatoshis) -> Result<(), Self::Error> {
        self.tx_table.update_fee(&tx_ref, fee)
    }

    #[cfg(feature = "transparent-inputs")]
    fn put_transparent_output(
        &mut self,
        output: &WalletTransparentOutput<Self::AccountId>,
        observation_height: BlockHeight,
        known_unspent: bool,
    ) -> Result<(Self::AccountId, Option<TransparentKeyScope>), Self::Error> {
        // `transparent::put_transparent_output`. Outputs can only be received at addresses
        // that have a row.
        let (address_id, account_id, key_scope) = self
            .addresses
            .find_by_transparent_receiver(output.recipient_address())
            .map(|(id, a)| (id, a.account_id, a.key_scope))
            .ok_or(Error::AddressNotRecognized(*output.recipient_address()))?;

        let txid = *output.outpoint().txid();
        let output_height = output.mined_height();
        let min_observed = output_height.map_or(observation_height, |h| h.min(observation_height));
        self.tx_table.upsert_for_transparent_output(
            txid,
            output_height,
            output_height.is_some_and(|h| self.block_known(h)),
            min_observed,
        );

        // The greatest height at which the output is known to be unspent: just below the
        // mined height of a spending transaction, or the chain tip if the caller observed
        // the output in the UTXO set.
        let spent_height = self
            .transparent
            .spends_of(output.outpoint())
            .filter_map(|t| self.tx_table.get(t).and_then(|t| t.mined_height()))
            .min();
        let max_observed_unspent = match spent_height {
            Some(h) => Some(h - 1),
            None if known_unspent => self.chain_tip_height(),
            None => None,
        };

        let outpoint = output.outpoint().clone();
        match self.transparent.outputs.get_mut(&outpoint) {
            Some(existing) => {
                existing.account_id = account_id;
                existing.address = *output.recipient_address();
                existing.address_id = address_id;
                existing.key_scope = key_scope.as_transparent();
                existing.txout = output.txout().clone();
                existing.max_observed_unspent_height =
                    max_observed_unspent.or(existing.max_observed_unspent_height);
            }
            None => {
                self.transparent.outputs.insert(
                    outpoint.clone(),
                    ReceivedTransparentOutput {
                        outpoint: outpoint.clone(),
                        account_id,
                        address: *output.recipient_address(),
                        address_id,
                        key_scope: key_scope.as_transparent(),
                        txout: output.txout().clone(),
                        max_observed_unspent_height: max_observed_unspent,
                    },
                );
            }
        }

        // A spend recorded before the output was known: against a stored transaction
        // (`transparent_spend_map`, mined spenders first) or, for a spend seen while
        // scanning, by locator.
        let stored_spender = {
            let mut spenders: Vec<TxId> = self.transparent.spend_map_spenders(&outpoint).collect();
            spenders.sort_by_key(|t| {
                self.tx_table
                    .get(t)
                    .and_then(|e| e.mined_height())
                    .map_or(u32::MAX, u32::from)
            });
            spenders.into_iter().find(|t| self.tx_table.contains(t))
        };
        let spender = match stored_spender {
            Some(t) => Some(t),
            None => match self.spend_maps.find_outpoint(&outpoint) {
                Some((_, _, t)) => {
                    self.ensure_tx_from_locator(t)?;
                    Some(t)
                }
                None => None,
            },
        };
        if let Some(spender) = spender {
            self.mark_utxo_spent(&outpoint, spender);
        }

        let gap_limits = self.gap_limits;
        self.update_gap_limits_for(
            &gap_limits,
            txid,
            output_height.unwrap_or(observation_height),
        )?;

        Ok((account_id, key_scope.as_transparent()))
    }

    #[cfg(feature = "transparent-inputs")]
    fn mark_transparent_utxo_spent(
        &mut self,
        outpoint: &OutPoint,
        spent_in_tx: Self::TxRef,
    ) -> Result<bool, Self::Error> {
        Ok(self.mark_utxo_spent(outpoint, spent_in_tx))
    }

    #[cfg(feature = "transparent-inputs")]
    fn generate_transparent_gap_addresses(
        &mut self,
        account_id: Self::AccountId,
        key_scope: TransparentKeyScope,
        request: UnifiedAddressRequest,
    ) -> Result<(), Self::Error> {
        let gap_limits = self.gap_limits;
        generate_transparent_gap_addresses(self, gap_limits, account_id, key_scope, request)?;
        Ok(())
    }

    fn queue_tx_retrieval(
        &mut self,
        txids: impl Iterator<Item = TxId>,
        dependent_tx_ref: Option<Self::TxRef>,
    ) -> Result<(), Self::Error> {
        for txid in txids {
            let have_raw = self.tx_table.get(&txid).is_some_and(|t| t.raw().is_some());
            self.tx_retrieval_queue
                .queue_enhancement(txid, dependent_tx_ref, have_raw);
        }
        Ok(())
    }

    fn queue_tx_status(&mut self, txid: TxId) -> Result<(), Self::Error> {
        self.tx_retrieval_queue.queue_status(txid);
        Ok(())
    }

    #[cfg(feature = "transparent-inputs")]
    fn queue_transparent_spend_detection(
        &mut self,
        receiving_address: TransparentAddress,
        tx_ref: Self::TxRef,
        output_index: u32,
    ) -> Result<(), Self::Error> {
        // ON CONFLICT DO NOTHING
        if !self
            .transparent_spend_search_queue
            .0
            .contains_key(&(tx_ref, output_index))
        {
            self.transparent_spend_search_queue
                .queue(receiving_address, tx_ref, output_index);
        }
        Ok(())
    }

    #[cfg(feature = "transparent-inputs")]
    fn queue_transparent_input_retrieval(
        &mut self,
        tx_ref: Self::TxRef,
        d_tx: &DecryptedTransaction<Transaction, Self::AccountId>,
    ) -> Result<(), Self::Error> {
        if let Some(b) = d_tx.tx().transparent_bundle() {
            if !b.is_coinbase() {
                let prevouts: Vec<TxId> = b.vin.iter().map(|txin| *txin.prevout().txid()).collect();
                self.queue_tx_retrieval(prevouts.into_iter(), Some(tx_ref))?;
            }
        }
        Ok(())
    }

    fn delete_retrieval_queue_entries(&mut self, txid: TxId) -> Result<(), Self::Error> {
        self.tx_retrieval_queue
            .remove(&txid, TxQueryType::Enhancement);
        Ok(())
    }

    fn notify_scan_complete(
        &mut self,
        range: Range<BlockHeight>,
        wallet_note_positions: &[(ShieldedPool, Position)],
    ) -> Result<(), Self::Error> {
        self.scan_complete(range, wallet_note_positions)?;
        // `put_blocks` prunes the spend maps (`prune_tracked_spends`) before it updates the scan
        // queue, so with the fully scanned height of the previous batch. When this batch
        // completes a restore's scan (fully scanned jumps from the birthday to the tip), the
        // entries of the whole out-of-order chain-tip range (tens of MiB after a month-long
        // range) would stay in memory and in every save until another block is scanned. Pruning
        // again with this batch's fully scanned height is the same rule, one batch earlier: an
        // entry below fully scanned - PRUNING_DEPTH can only serve a note in a block below it,
        // and all of those are scanned (verifier finding M3).
        self.prune_tracked_spends(PRUNING_DEPTH)
    }

    #[cfg(feature = "transparent-inputs")]
    fn update_gap_limits(
        &mut self,
        gap_limits: &GapLimits,
        txid: TxId,
        observation_height: BlockHeight,
    ) -> Result<(), Self::Error> {
        self.update_gap_limits_for(gap_limits, txid, observation_height)
    }
}

#[cfg(feature = "transparent-inputs")]
impl<P: consensus::Parameters> MemoryWalletDb<P> {
    /// `excluding_wallet_internal_ephemeral_outputs`: an output at an ephemeral address is
    /// eligible only if its creating transaction spent nothing of the receiving account,
    /// or the output was observed unspent above that transaction's expiry height (the
    /// second half of a TEX pair then failed and expired).
    pub(crate) fn ephemeral_output_eligible(&self, o: &ReceivedTransparentOutput) -> Result<bool, Error> {
        let is_ephemeral = self
            .addresses
            .get(o.address_id)
            .is_some_and(|a| a.key_scope == KeyScope::Ephemeral);
        if !is_ephemeral {
            return Ok(true);
        }
        let creating = *o.outpoint.txid();
        let account_funded = self
            .received_notes
            .iter()
            .any(|rn| {
                rn.account_id() == o.account_id
                    && self.received_notes.spends_of(&rn.note_id()).any(|t| *t == creating)
            })
            || self.transparent.iter().any(|t| {
                t.account_id == o.account_id
                    && self.transparent.spends_of(&t.outpoint).any(|s| *s == creating)
            });
        if !account_funded {
            return Ok(true);
        }
        let expiry = self.tx_table.get(&creating).and_then(|t| t.expiry_height());
        Ok(match (o.max_observed_unspent_height, expiry) {
            (Some(observed), Some(expiry)) => observed > expiry,
            _ => false,
        })
    }

    /// `find_gap_start`: the index after the first used index that is followed by at
    /// least `gap_limit` unused indices (or by no used index at all); index 0 if no
    /// address of the scope has been used. `None` once that index leaves the
    /// non-hardened range.
    pub(crate) fn gap_start(
        &self,
        account: AccountId,
        key_scope: KeyScope,
        gap_limit: u32,
    ) -> Option<NonHardenedChildIndex> {
        let first_use = self.address_first_use_heights();
        let used: BTreeSet<u32> = self
            .addresses
            .for_account(account)
            .filter(|(id, a)| a.key_scope == key_scope && first_use.contains_key(id))
            .filter_map(|(_, a)| a.transparent_child_index.map(|i| i.index()))
            .collect();
        let mut iter = used.iter().peekable();
        while let Some(i) = iter.next() {
            match iter.peek() {
                Some(next) if **next - *i - 1 < gap_limit => continue,
                _ => return NonHardenedChildIndex::from_index(i + 1),
            }
        }
        Some(NonHardenedChildIndex::ZERO)
    }
}

#[cfg(feature = "transparent-inputs")]
impl<P: consensus::Parameters> AddressStore for MemoryWalletDb<P> {
    type Error = Error;
    type AccountRef = AccountId;

    fn find_gap_start(
        &self,
        account_ref: Self::AccountRef,
        key_scope: TransparentKeyScope,
        gap_limit: u32,
    ) -> Result<Option<NonHardenedChildIndex>, Self::Error> {
        Ok(self.gap_start(account_ref, KeyScope::from_transparent(key_scope)?, gap_limit))
    }

    fn store_address_range(
        &mut self,
        account_id: Self::AccountRef,
        key_scope: TransparentKeyScope,
        list: Vec<(zcash_keys::address::Address, TransparentAddress, NonHardenedChildIndex)>,
    ) -> Result<(), Self::Error> {
        self.require_account(account_id)?;
        self.addresses
            .store_range(account_id, KeyScope::from_transparent(key_scope)?, list)
    }
}
