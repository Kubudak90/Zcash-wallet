//! `WalletRead` for [`MemoryWalletDb`].
//!
//! Each method follows the zcash_client_sqlite 0.23 function named in its comment
//! (`lib.rs` `impl WalletRead for WalletDb` and the `wallet.rs` / `wallet/*.rs` functions
//! it calls). Transparent queries live in `transparent_ops.rs`.

use std::collections::HashMap;
use std::num::NonZeroU32;
use std::ops::Range;

use nonempty::NonEmpty;
use secrecy::{ExposeSecret, SecretVec};
use zcash_client_backend::{
    data_api::{
        Account as _, AccountBalance, AccountSource, AddressInfo, AddressSource, Balance,
        BlockMetadata, NullifierQuery, Progress, Ratio, ReceivedTransactionOutput, SeedRelevance,
        TransactionDataRequest, WalletRead, WalletSummary, Zip32Derivation, defaults,
        error::FindAccountForAddressError,
        scanning::{ScanPriority, ScanRange},
        wallet::{ConfirmationsPolicy, TargetHeight},
    },
    wallet::NoteId,
};
use zcash_keys::{
    address::{Address, UnifiedAddress},
    keys::{
        ReceiverRequirement, UnifiedAddressRequest, UnifiedFullViewingKey,
        UnifiedIncomingViewingKey, UnifiedSpendingKey,
    },
};
use zcash_primitives::{
    block::BlockHash,
    transaction::{Transaction, TxId, fees::zip317},
};
use zcash_protocol::{
    PoolType, ShieldedPool,
    consensus::{self, BlockHeight},
    memo::Memo,
};
use zip32::fingerprint::SeedFingerprint;

#[cfg(feature = "transparent-inputs")]
use {
    ::transparent::{
        address::TransparentAddress,
        bundle::OutPoint,
        keys::{IncomingViewingKey as _, TransparentKeyScope},
    },
    zcash_client_backend::{data_api::TransparentBalances, wallet::TransparentAddressMetadata},
};

use crate::{
    Account, AccountId, MemoryWalletDb,
    error::Error,
    types::{address::KeyScope, data_requests::TxQueryType},
};

impl<P: consensus::Parameters> MemoryWalletDb<P> {
    /// `seed_matches_derived_account`.
    fn seed_matches_derived_account(
        &self,
        seed: &SecretVec<u8>,
        seed_fingerprint: &SeedFingerprint,
        account_index: zip32::AccountId,
        uivk: &UnifiedIncomingViewingKey,
    ) -> Result<bool, Error> {
        let seed_fingerprint_match = &SeedFingerprint::from_seed(seed.expose_secret())
            .ok_or(Error::InvalidSeedLength)?
            == seed_fingerprint;

        // UIVKs are not comparable, but the receivers of their default addresses are.
        let usk = UnifiedSpendingKey::from_seed(&self.params, seed.expose_secret(), account_index)
            .map_err(|e| Error::BadAccountData(format!("key derivation failed: {e:?}")))?;
        let (seed_addr, _) = usk
            .to_unified_full_viewing_key()
            .default_address(UnifiedAddressRequest::AllAvailableKeys)?;
        let (uivk_addr, _) = uivk.default_address(UnifiedAddressRequest::AllAvailableKeys)?;

        #[cfg(feature = "orchard")]
        let orchard_match = seed_addr
            .orchard()
            .zip(uivk_addr.orchard())
            .is_some_and(|(a, b)| a == b);
        #[cfg(not(feature = "orchard"))]
        let orchard_match = false;
        let sapling_match = seed_addr
            .sapling()
            .zip(uivk_addr.sapling())
            .is_some_and(|(a, b)| a == b);
        let p2pkh_match = seed_addr
            .transparent()
            .zip(uivk_addr.transparent())
            .is_some_and(|(a, b)| a == b);
        let uivk_match = orchard_match || sapling_match || p2pkh_match;

        if seed_fingerprint_match != uivk_match {
            Err(Error::CorruptedData(format!(
                "Seed fingerprint match: {seed_fingerprint_match}, uivk match: {uivk_match}"
            )))
        } else {
            Ok(seed_fingerprint_match && uivk_match)
        }
    }

    /// `get_account_for_uivk`: the account sharing any receiver key (Orchard, Sapling or
    /// P2PKH IVK) with `uivk`; more than one is an error.
    pub(crate) fn account_for_uivk(
        &self,
        uivk: &UnifiedIncomingViewingKey,
    ) -> Result<Option<&Account>, Error> {
        #[cfg(feature = "orchard")]
        let orchard = uivk.orchard().as_ref().map(|k| k.to_bytes().to_vec());
        #[cfg(not(feature = "orchard"))]
        let orchard: Option<Vec<u8>> = None;
        let sapling = uivk.sapling().as_ref().map(|k| k.to_bytes().to_vec());
        #[cfg(feature = "transparent-inputs")]
        let p2pkh = uivk.p2pkh().as_ref().map(|k| k.serialize());
        #[cfg(not(feature = "transparent-inputs"))]
        let p2pkh: Option<Vec<u8>> = None;

        let same = |a: &Option<Vec<u8>>, b: &Option<Vec<u8>>| matches!((a, b), (Some(x), Some(y)) if x == y);
        let mut found = self.accounts.iter().filter(|account| {
            let other = account.uivk();
            #[cfg(feature = "orchard")]
            let o = other.orchard().as_ref().map(|k| k.to_bytes().to_vec());
            #[cfg(not(feature = "orchard"))]
            let o: Option<Vec<u8>> = None;
            let s = other.sapling().as_ref().map(|k| k.to_bytes().to_vec());
            #[cfg(feature = "transparent-inputs")]
            let t = other.p2pkh().as_ref().map(|k| k.serialize());
            #[cfg(not(feature = "transparent-inputs"))]
            let t: Option<Vec<u8>> = None;
            same(&orchard, &o) || same(&sapling, &s) || same(&p2pkh, &t)
        });
        let first = found.next();
        if found.next().is_some() {
            return Err(Error::CorruptedData(
                "Multiple account records matched the provided UIVK".to_owned(),
            ));
        }
        Ok(first)
    }

    /// `block_metadata` / `parse_block_metadata`: tree sizes of pools not yet active at the
    /// block are reported as 0.
    pub(crate) fn block_meta(&self, height: BlockHeight) -> Option<BlockMetadata> {
        self.blocks.get(&height).map(|b| {
            #[cfg(feature = "orchard")]
            let active = |pool: ShieldedPool| {
                self.pool_activation_height(pool)
                    .is_some_and(|activation| b.height >= activation)
            };
            BlockMetadata::from_parts(
                b.height,
                b.hash,
                Some(b.sapling_commitment_tree_size),
                #[cfg(feature = "orchard")]
                Some(if active(ShieldedPool::Orchard) {
                    b.orchard_commitment_tree_size
                } else {
                    0
                }),
                #[cfg(feature = "orchard")]
                Some(if active(ShieldedPool::Ironwood) {
                    b.ironwood_commitment_tree_size
                } else {
                    0
                }),
            )
        })
    }

    /// The account balances of one shielded pool (`get_wallet_snapshot` /
    /// `with_pool_balances`).
    fn add_pool_balances(
        &self,
        pool: ShieldedPool,
        target_height: TargetHeight,
        anchor_height: Option<BlockHeight>,
        policy: ConfirmationsPolicy,
        balances: &mut HashMap<AccountId, AccountBalance>,
    ) -> Result<(), Error> {
        let target = BlockHeight::from(target_height);
        let trusted_height = target_height.saturating_sub(u32::from(policy.trusted()));
        // If the shard containing the anchor height has an unscanned range starting at or
        // below it, none of the pool's balance is spendable yet.
        let any_spendable = anchor_height.is_some_and(|h| !self.unscanned_tip_exists(pool, h));

        for rn in self.received_notes.iter().filter(|rn| rn.pool() == pool) {
            let Some(tx) = self.tx_table.get(&rn.txid()) else {
                continue;
            };
            if !tx.is_mined_or_unexpired_for(&self.params, target)
                || self.is_note_spent(&rn.note_id(), target)
            {
                continue;
            }
            let value = rn.note().value();
            // An unpositioned note is not spendable; treat it as ChainTip (> Scanned).
            let max_priority = rn
                .commitment_tree_position()
                .and_then(|p| self.shard_max_priority(pool, p))
                .unwrap_or(ScanPriority::ChainTip);
            let received_height = tx.mined_height();
            let (max_shielding_input_height, shielding_inputs_trusted) =
                self.shielding_inputs(rn.account_id(), &rn.txid());
            let is_locked = self
                .output_locks
                .is_locked_at(&Self::note_lock_key(&rn.note_id()), target);

            let is_spendable = any_spendable
                && max_priority <= ScanPriority::Scanned
                && policy.confirmations_until_spendable(
                    target_height,
                    PoolType::Shielded(pool),
                    rn.recipient_key_scope(),
                    received_height,
                    tx.is_trusted(),
                    max_shielding_input_height,
                    shielding_inputs_trusted,
                ) == 0;
            let is_pending_change =
                rn.is_change() && received_height.iter().all(|h| h > &trusted_height);

            let Some(account_balance) = balances.get_mut(&rn.account_id()) else {
                continue;
            };
            let apply = |bal: &mut Balance| -> Result<(), Error> {
                if value <= zip317::MARGINAL_FEE {
                    bal.add_uneconomic_value(value)?;
                } else if is_spendable && is_locked {
                    // Only notes that would otherwise be spendable count as locked.
                    bal.add_locked_value(value)?;
                } else if is_spendable {
                    bal.add_spendable_value(value)?;
                } else if is_pending_change {
                    bal.add_pending_change_value(value)?;
                } else {
                    bal.add_pending_spendable_value(value)?;
                }
                Ok(())
            };
            match pool {
                ShieldedPool::Sapling => account_balance.with_sapling_balance_mut(apply)?,
                ShieldedPool::Orchard => account_balance.with_orchard_balance_mut(apply)?,
                ShieldedPool::Ironwood => account_balance.with_ironwood_balance_mut(apply)?,
            }
        }
        Ok(())
    }

    /// `next_subtree_index`: the index of the second-to-last shard (the last one is
    /// incomplete, and the next range of roots should overlap the last complete one).
    fn next_subtree_index(&self, pool: ShieldedPool) -> u64 {
        self.pool_shard_indices(pool)
            .iter()
            .rev()
            .nth(1)
            .copied()
            .unwrap_or(0)
    }

    /// Heights inside a scan queue range that is pending (re)scan: their stored block
    /// rows do not count as scanned for progress (`subtree_scan_progress`).
    fn pending_scan_ranges(&self) -> Vec<Range<BlockHeight>> {
        self.scan_queue
            .iter()
            .filter(|(_, _, p)| *p > ScanPriority::Scanned)
            .map(|(s, e, _)| *s..*e)
            .collect()
    }

    /// `estimate_tree_size`: linear extrapolation of `pool`'s tree size at the chain tip.
    fn estimate_tree_size(
        &self,
        pool: ShieldedPool,
        pool_activation_height: BlockHeight,
        chain_tip_height: BlockHeight,
    ) -> Option<u64> {
        let last_scanned = self
            .blocks
            .values()
            .next_back()
            .and_then(|b| b.tree_size(pool).map(|s| (b.height, u64::from(s))));
        let subtree_ends = self.pool_subtree_ends(pool);
        let shard_height = crate::queries::shard_height(pool);
        let last_completed = subtree_ends.iter().max_by_key(|(i, _)| *i).copied();

        if let Some((last_index, last_end)) = last_completed {
            let last_completed_subtree =
                incrementalmerkletree::Address::from_parts(shard_height.into(), last_index);
            let tip_tree_size = last_scanned.and_then(|(last_scanned, last_scanned_size)| {
                (last_scanned > last_end)
                    .then(|| {
                        let scanned_notes = last_scanned_size.saturating_sub(u64::from(
                            last_completed_subtree.position_range_end(),
                        ));
                        let scanned_range = u64::from(last_scanned - last_end);
                        let unscanned_range = u64::from(chain_tip_height - last_scanned);
                        (scanned_notes * unscanned_range)
                            .checked_div(scanned_range)
                            .map(|n| last_scanned_size + n)
                    })
                    .flatten()
            });
            if let Some(tree_size) = tip_tree_size {
                Some(tree_size)
            } else if let Some(second_end) = last_index
                .checked_sub(1)
                .and_then(|i| self.pool_subtree_end_height(pool, i))
            {
                let notes_in_complete = u64::from(last_completed_subtree.position_range_end());
                let subtree_notes = 1u64 << shard_height;
                let subtree_range = u64::from(last_end - second_end);
                let unscanned_range = u64::from(chain_tip_height - last_end);
                (subtree_notes * unscanned_range)
                    .checked_div(subtree_range)
                    .map(|n| notes_in_complete + n)
            } else {
                let subtree_notes = 1u64 << shard_height;
                let subtree_range = u64::from(last_end - pool_activation_height);
                let unscanned_range = u64::from(chain_tip_height - last_end);
                (subtree_notes * unscanned_range)
                    .checked_div(subtree_range)
                    .map(|n| subtree_notes + n)
            }
        } else {
            last_scanned.and_then(|(last_height, last_size)| {
                let subtree_range = u64::from(last_height - pool_activation_height);
                let unscanned_range = u64::from(chain_tip_height - last_height);
                (last_size * unscanned_range)
                    .checked_div(subtree_range)
                    .map(|n| last_size + n)
            })
        }
    }

    /// `subtree_scan_progress` for one pool.
    fn pool_scan_progress(
        &self,
        pool: ShieldedPool,
        min_birthday_height: BlockHeight,
        recover_until_height: Option<BlockHeight>,
        chain_tip_height: BlockHeight,
    ) -> Option<Progress> {
        let pool_activation_height = self.pool_activation_height(pool)?;
        let pending = self.pending_scan_ranges();
        let counted = |h: BlockHeight| !pending.iter().any(|r| r.start <= h && h < r.end);
        let blocks = || self.blocks.values().filter(|b| counted(b.height));
        let count_sum = |it: &mut dyn Iterator<Item = &crate::MemoryWalletBlock>| -> Option<u64> {
            let mut any = false;
            let mut sum = 0u64;
            for b in it {
                any = true;
                sum += u64::from(b.output_count(pool).unwrap_or(0));
            }
            any.then_some(sum)
        };
        let start_size = |b: &crate::MemoryWalletBlock| {
            u64::from(b.tree_size(pool).unwrap_or(0))
                .saturating_sub(u64::from(b.output_count(pool).unwrap_or(0)))
        };
        let shard_height = crate::queries::shard_height(pool);

        let get_tree_size_near = |as_of: BlockHeight| -> Option<u64> {
            blocks()
                .filter(|b| b.height <= as_of)
                .map(start_size)
                .max()
                .or_else(|| {
                    self.pool_shard_indices(pool)
                        .into_iter()
                        .filter(|i| {
                            self.pool_subtree_end_height(pool, *i)
                                .is_none_or(|e| e >= as_of)
                        })
                        .min()
                        .map(|i| i << shard_height)
                })
        };

        // The tree size at the wallet birthday, from the birthday chain state of an account
        // with that birthday, or else from nearby data.
        let birthday_size = self
            .accounts
            .iter()
            .find(|a| a.birthday().height() == min_birthday_height)
            .map(|a| {
                let cs = a.birthday().prior_chain_state();
                match pool {
                    ShieldedPool::Sapling => cs.final_sapling_tree().tree_size(),
                    #[cfg(feature = "orchard")]
                    ShieldedPool::Orchard => cs.final_orchard_tree().tree_size(),
                    #[cfg(feature = "orchard")]
                    ShieldedPool::Ironwood => cs.final_ironwood_tree().tree_size(),
                    #[cfg(not(feature = "orchard"))]
                    _ => 0,
                }
            })
            .or_else(|| get_tree_size_near(min_birthday_height));

        let tip_tree_size = self
            .blocks
            .get(&chain_tip_height)
            .filter(|b| counted(b.height))
            .and_then(|b| b.tree_size(pool).map(u64::from))
            .or_else(|| self.estimate_tree_size(pool, pool_activation_height, chain_tip_height));

        let recover_until_size: Option<Option<u64>> = recover_until_height.map(|ru| {
            match self.blocks.get(&ru).filter(|b| counted(b.height)).map(start_size) {
                Some(size) => Some(size),
                None if ru == chain_tip_height => tip_tree_size,
                None => birthday_size.zip(tip_tree_size).and_then(|(lower, upper)| {
                    let total_notes = upper.saturating_sub(lower);
                    let total_range = u64::from(chain_tip_height)
                        .saturating_sub(u64::from(min_birthday_height));
                    let recovery_range =
                        u64::from(ru).saturating_sub(u64::from(min_birthday_height));
                    (total_notes * recovery_range)
                        .checked_div(total_range)
                        .map(|n| (lower + n).min(upper))
                }),
            }
        });

        let recovered_count = recover_until_height.map(|end| {
            count_sum(&mut blocks().filter(|b| b.height >= min_birthday_height && b.height < end))
        });

        let recover = recovered_count
            .zip(recover_until_size)
            .map(|(recovered, end_size)| {
                birthday_size.zip(end_size).map(|(start_size, end_size)| {
                    Ratio::new(recovered.unwrap_or(0), end_size.saturating_sub(start_size))
                })
            })
            .unwrap_or_else(|| Some(Ratio::new(0, 0)));

        let scan = {
            let from = recover_until_height.unwrap_or(min_birthday_height);
            let scanned_count = count_sum(&mut blocks().filter(|b| b.height >= from));
            recover_until_size
                .unwrap_or(birthday_size)
                .zip(tip_tree_size)
                .map(|(start, tip)| Ratio::new(scanned_count.unwrap_or(0), tip.saturating_sub(start)))
        };

        scan.map(|scan| Progress::new(scan, recover))
    }

    /// Scan progress of the wallet, combining the pools as zcash_client_sqlite's
    /// `get_wallet_summary` combines Sapling and Orchard (outputs of every pool are taken to
    /// cost the same to scan). Celari also counts the Ironwood pool, whose outputs replace
    /// most Orchard outputs after NU6.3; without it, progress would stall there.
    fn scan_progress(
        &self,
        birthday: BlockHeight,
        recover_until: Option<BlockHeight>,
        chain_tip: BlockHeight,
    ) -> Option<Progress> {
        Self::shielded_pools()
            .iter()
            .filter_map(|pool| self.pool_scan_progress(*pool, birthday, recover_until, chain_tip))
            .reduce(|a, b| {
                Progress::new(
                    Ratio::new(
                        a.scan().numerator() + b.scan().numerator(),
                        a.scan().denominator() + b.scan().denominator(),
                    ),
                    a.recovery()
                        .zip(b.recovery())
                        .map(|(a, b)| {
                            Ratio::new(
                                a.numerator() + b.numerator(),
                                a.denominator() + b.denominator(),
                            )
                        })
                        .or_else(|| a.recovery())
                        .or_else(|| b.recovery()),
                )
            })
    }

    /// Whether the address row satisfies the receiver requirements of `request`
    /// (`get_last_generated_address_matching`'s receiver flag test).
    fn ua_matches(ua: &UnifiedAddress, req: &zcash_keys::keys::ReceiverRequirements) -> bool {
        let ok = |requirement: ReceiverRequirement, has: bool| match requirement {
            ReceiverRequirement::Require => has,
            ReceiverRequirement::Omit => !has,
            ReceiverRequirement::Allow => true,
        };
        #[cfg(feature = "orchard")]
        let has_orchard = ua.has_orchard();
        #[cfg(not(feature = "orchard"))]
        let has_orchard = false;
        ok(req.orchard(), has_orchard)
            && ok(req.sapling(), ua.has_sapling())
            && ok(req.p2pkh(), ua.has_transparent())
    }

    /// `get_last_generated_address_matching`, with its diversifier index.
    pub(crate) fn last_generated_address_matching(
        &self,
        account: AccountId,
        request: UnifiedAddressRequest,
    ) -> Result<Option<(UnifiedAddress, zip32::DiversifierIndex)>, Error> {
        let acct = self
            .accounts
            .get(account)
            .ok_or(Error::AccountUnknown(account))?;
        let req = acct.uivk().receiver_requirements(request).map_err(|_| {
            Error::BadAccountData("Could not generate UnifiedAddressRequest for UIVK".to_string())
        })?;
        let mut best: Option<(BlockHeight, [u8; 11], UnifiedAddress, zip32::DiversifierIndex)> =
            None;
        for (_, row) in self.addresses.for_account(account) {
            if row.key_scope != KeyScope::External {
                continue;
            }
            let (Some(exposed), Some(di)) = (row.exposed_at_height, row.diversifier_index) else {
                continue;
            };
            let Address::Unified(ua) = &row.address else {
                return Err(Error::CorruptedData(
                    "an external-scope address row holds a non-unified address".into(),
                ));
            };
            if !Self::ua_matches(ua, &req) {
                continue;
            }
            let mut di_be = *di.as_bytes();
            di_be.reverse();
            let better = best
                .as_ref()
                .is_none_or(|(h, d, _, _)| (exposed, di_be) > (*h, *d));
            if better {
                best = Some((exposed, di_be, (**ua).clone(), di));
            }
        }
        Ok(best.map(|(_, _, ua, di)| (ua, di)))
    }

    /// `get_nullifiers`.
    fn nullifiers_of(
        &self,
        pool: ShieldedPool,
        query: NullifierQuery,
    ) -> Vec<(AccountId, crate::Nullifier)> {
        self.received_notes
            .iter()
            .filter(|rn| rn.pool() == pool)
            .filter_map(|rn| rn.nullifier().map(|nf| (rn, *nf)))
            .filter(|(rn, _)| match query {
                NullifierQuery::All => true,
                NullifierQuery::Unspent => {
                    // The creating transaction is mined, and no spending transaction is
                    // mined or non-expiring. (Deliberately more inclusive than
                    // `spent_notes_clause`, see zcash_client_sqlite.)
                    let mined = self
                        .tx_table
                        .get(&rn.txid())
                        .is_some_and(|t| t.mined_height().is_some());
                    let spent = self.received_notes.spends_of(&rn.note_id()).any(|stx| {
                        self.tx_table.get(stx).is_some_and(|t| {
                            t.mined_height().is_some()
                                || t.expiry_height().is_some_and(|e| u32::from(e) == 0)
                        })
                    });
                    mined && !spent
                }
            })
            .map(|(rn, nf)| (rn.account_id(), nf))
            .collect()
    }
}

impl<P: consensus::Parameters> WalletRead for MemoryWalletDb<P> {
    type Error = Error;
    type AccountId = AccountId;
    type Account = Account;

    fn anchor_retention_interval(
        &self,
    ) -> zcash_client_backend::data_api::anchor_retention::AnchorRetentionInterval {
        self.anchor_retention_interval
    }

    fn get_account_ids(&self) -> Result<Vec<Self::AccountId>, Self::Error> {
        Ok(self.accounts.ids().collect())
    }

    fn get_account(&self, account_id: Self::AccountId) -> Result<Option<Self::Account>, Self::Error> {
        Ok(self.accounts.get(account_id).cloned())
    }

    fn get_derived_account(
        &self,
        derivation: &Zip32Derivation,
    ) -> Result<Option<Self::Account>, Self::Error> {
        // `get_derived_account`: by seed fingerprint and account index, which zcash_client_sqlite
        // records for derived accounts and for spending accounts imported with a derivation.
        Ok(self
            .accounts
            .iter()
            .find(|a| {
                let d = match a.source() {
                    AccountSource::Derived { derivation, .. } => Some(derivation),
                    AccountSource::Imported {
                        purpose:
                            zcash_client_backend::data_api::AccountPurpose::Spending {
                                derivation: Some(derivation),
                            },
                        ..
                    } => Some(derivation),
                    _ => None,
                };
                d.is_some_and(|d| {
                    d.seed_fingerprint() == derivation.seed_fingerprint()
                        && d.account_index() == derivation.account_index()
                })
            })
            .cloned())
    }

    fn validate_seed(
        &self,
        account_id: Self::AccountId,
        seed: &SecretVec<u8>,
    ) -> Result<bool, Self::Error> {
        match self.accounts.get(account_id) {
            Some(account) => match account.source() {
                AccountSource::Derived { derivation, .. } => self.seed_matches_derived_account(
                    seed,
                    derivation.seed_fingerprint(),
                    derivation.account_index(),
                    &account.uivk(),
                ),
                _ => Err(Error::UnknownZip32Derivation),
            },
            // A missing account is documented to return false.
            None => Ok(false),
        }
    }

    fn seed_relevance_to_derived_accounts(
        &self,
        seed: &SecretVec<u8>,
    ) -> Result<SeedRelevance<Self::AccountId>, Self::Error> {
        let mut has_accounts = false;
        let mut has_derived = false;
        let mut relevant = vec![];
        for account in self.accounts.iter() {
            has_accounts = true;
            if let AccountSource::Derived { derivation, .. } = account.source() {
                has_derived = true;
                if self.seed_matches_derived_account(
                    seed,
                    derivation.seed_fingerprint(),
                    derivation.account_index(),
                    &account.uivk(),
                )? {
                    relevant.push(account.id());
                }
            }
        }
        Ok(if let Some(account_ids) = NonEmpty::from_vec(relevant) {
            SeedRelevance::Relevant { account_ids }
        } else if has_derived {
            SeedRelevance::NotRelevant
        } else if has_accounts {
            SeedRelevance::NoDerivedAccounts
        } else {
            SeedRelevance::NoAccounts
        })
    }

    fn get_account_for_ufvk(
        &self,
        ufvk: &UnifiedFullViewingKey,
    ) -> Result<Option<Self::Account>, Self::Error> {
        Ok(self
            .account_for_uivk(&ufvk.to_unified_incoming_viewing_key())?
            .cloned())
    }

    fn list_addresses(&self, account: Self::AccountId) -> Result<Vec<AddressInfo>, Self::Error> {
        // `list_addresses`: exposed addresses, by exposure height then diversifier index.
        let mut rows: Vec<_> = self
            .addresses
            .for_account(account)
            .filter(|(_, r)| r.exposed_at_height.is_some())
            .collect();
        rows.sort_by_key(|(_, r)| {
            let di = r.diversifier_index.map(|d| {
                let mut b = *d.as_bytes();
                b.reverse();
                b
            });
            (r.exposed_at_height, di)
        });

        let mut addrs = vec![];
        for (_, row) in rows {
            let di = row.diversifier_index.ok_or_else(|| {
                Error::CorruptedData("diversifier index may not be null".to_string())
            })?;
            #[cfg(feature = "transparent-inputs")]
            let transparent_key_scope = matches!(row.address, Address::Transparent(_) | Address::Tex(_))
                .then(|| row.key_scope.as_transparent())
                .flatten();
            let source = AddressSource::Derived {
                diversifier_index: di,
                #[cfg(feature = "transparent-inputs")]
                transparent_key_scope,
            };
            #[cfg(feature = "transparent-inputs")]
            let omitted_taddr = match (&row.address, row.transparent_receiver) {
                (Address::Unified(ua), Some(taddr)) if !ua.has_transparent() => {
                    AddressInfo::from_parts(
                        Address::Transparent(taddr),
                        AddressSource::Derived {
                            diversifier_index: di,
                            transparent_key_scope: row.key_scope.as_transparent(),
                        },
                    )
                }
                _ => None,
            };
            addrs.push(AddressInfo::from_parts(row.address.clone(), source).ok_or(
                Error::CorruptedData(
                    "transparent key scope information present for shielded address".to_string(),
                ),
            )?);
            #[cfg(feature = "transparent-inputs")]
            addrs.extend(omitted_taddr);
        }
        Ok(addrs)
    }

    fn find_account_for_address<Q: consensus::Parameters>(
        &self,
        params: &Q,
        address: &Address,
    ) -> Result<Option<Self::AccountId>, FindAccountForAddressError<Self::Error>> {
        defaults::find_account_for_address(self, params, address)
    }

    fn get_last_generated_address_matching(
        &self,
        account: Self::AccountId,
        address_filter: UnifiedAddressRequest,
    ) -> Result<Option<UnifiedAddress>, Self::Error> {
        Ok(self
            .last_generated_address_matching(account, address_filter)?
            .map(|(ua, _)| ua))
    }

    fn get_account_birthday(&self, account: Self::AccountId) -> Result<BlockHeight, Self::Error> {
        self.accounts
            .get(account)
            .map(|a| a.birthday().height())
            .ok_or(Error::AccountUnknown(account))
    }

    fn get_wallet_birthday(&self) -> Result<Option<BlockHeight>, Self::Error> {
        Ok(self.wallet_birthday())
    }

    fn get_wallet_recover_until(&self) -> Result<Option<BlockHeight>, Self::Error> {
        Ok(self.accounts.recover_until())
    }

    fn get_wallet_summary(
        &self,
        confirmations_policy: ConfirmationsPolicy,
    ) -> Result<Option<WalletSummary<Self::AccountId>>, Self::Error> {
        let Some(chain_tip_height) = self.chain_tip_height() else {
            return Ok(None);
        };
        let Some(birthday_height) = self.wallet_birthday() else {
            return Ok(None);
        };
        let Some(progress) =
            self.scan_progress(birthday_height, self.accounts.recover_until(), chain_tip_height)
        else {
            return Ok(None);
        };

        let fully_scanned_height = self.block_fully_scanned()?.map(|m| m.block_height());
        let target_height = TargetHeight::from(chain_tip_height + 1);
        let anchor_height = self.anchor_height(target_height, confirmations_policy.trusted());

        let mut account_balances: HashMap<AccountId, AccountBalance> = self
            .accounts
            .ids()
            .map(|id| (id, AccountBalance::ZERO))
            .collect();
        for pool in Self::shielded_pools() {
            self.add_pool_balances(
                *pool,
                target_height,
                anchor_height,
                confirmations_policy,
                &mut account_balances,
            )?;
        }
        #[cfg(feature = "transparent-inputs")]
        self.add_transparent_account_balances(
            target_height,
            confirmations_policy,
            &mut account_balances,
        )?;

        Ok(Some(WalletSummary::new(
            account_balances,
            chain_tip_height,
            fully_scanned_height.unwrap_or(birthday_height - 1),
            progress,
            self.next_subtree_index(ShieldedPool::Sapling),
            #[cfg(feature = "orchard")]
            self.next_subtree_index(ShieldedPool::Orchard),
            #[cfg(feature = "orchard")]
            self.next_subtree_index(ShieldedPool::Ironwood),
        )))
    }

    fn chain_height(&self) -> Result<Option<BlockHeight>, Self::Error> {
        Ok(self.chain_tip_height())
    }

    fn get_block_hash(&self, block_height: BlockHeight) -> Result<Option<BlockHash>, Self::Error> {
        Ok(self.blocks.get(&block_height).map(|b| b.hash))
    }

    fn block_metadata(&self, height: BlockHeight) -> Result<Option<BlockMetadata>, Self::Error> {
        Ok(self.block_meta(height))
    }

    fn block_fully_scanned(&self) -> Result<Option<BlockMetadata>, Self::Error> {
        Ok(self.fully_scanned_height().and_then(|h| self.block_meta(h)))
    }

    fn get_max_height_hash(&self) -> Result<Option<(BlockHeight, BlockHash)>, Self::Error> {
        Ok(self.blocks.values().next_back().map(|b| (b.height, b.hash)))
    }

    fn block_max_scanned(&self) -> Result<Option<BlockMetadata>, Self::Error> {
        Ok(self.max_scanned_height().and_then(|h| self.block_meta(h)))
    }

    fn suggest_scan_ranges(&self) -> Result<Vec<ScanRange>, Self::Error> {
        Ok(self.scan_queue.suggest_scan_ranges(ScanPriority::Historic))
    }

    fn get_target_and_anchor_heights(
        &self,
        min_confirmations: NonZeroU32,
    ) -> Result<Option<(TargetHeight, BlockHeight)>, Self::Error> {
        Ok(self.mempool_height().and_then(|target| {
            self.anchor_height(target, min_confirmations)
                .map(|anchor| (target, anchor))
        }))
    }

    fn get_tx_height(&self, txid: TxId) -> Result<Option<BlockHeight>, Self::Error> {
        let chain_tip = self.chain_tip_height().ok_or(Error::ChainHeightUnknown)?;
        Ok(self
            .tx_table
            .get(&txid)
            .and_then(|t| t.mined_height())
            .filter(|h| *h <= chain_tip))
    }

    fn get_unified_full_viewing_keys(
        &self,
    ) -> Result<HashMap<Self::AccountId, UnifiedFullViewingKey>, Self::Error> {
        Ok(self
            .accounts
            .iter()
            .map(|a| (a.id(), a.ufvk.clone()))
            .collect())
    }

    fn get_memo(&self, note_id: NoteId) -> Result<Option<Memo>, Self::Error> {
        // The sent output's memo if known, else the received note's (`get_sent_memo`,
        // `get_received_memo`).
        let sent = self
            .sent_notes
            .get(&crate::SentOutputId {
                txid: *note_id.txid(),
                pool: PoolType::Shielded(note_id.protocol()),
                output_index: u32::from(note_id.output_index()),
            })
            .and_then(|o| o.memo().cloned());
        let memo = match sent {
            Some(m) => Some(m),
            None => self
                .received_notes
                .get(&note_id)
                .and_then(|rn| rn.memo().cloned()),
        };
        memo.map(|m| Memo::try_from(m).map_err(Error::from))
            .transpose()
    }

    fn get_transaction(&self, txid: TxId) -> Result<Option<Transaction>, Self::Error> {
        Ok(self.tx_table.get(&txid).map(|t| t.parse()).transpose()?.flatten())
    }

    fn get_sapling_nullifiers(
        &self,
        query: NullifierQuery,
    ) -> Result<Vec<(Self::AccountId, sapling::Nullifier)>, Self::Error> {
        Ok(self
            .nullifiers_of(ShieldedPool::Sapling, query)
            .into_iter()
            .filter_map(|(a, nf)| match nf {
                crate::Nullifier::Sapling(nf) => Some((a, nf)),
                #[cfg(feature = "orchard")]
                _ => None,
            })
            .collect())
    }

    #[cfg(feature = "orchard")]
    fn get_orchard_nullifiers(
        &self,
        query: NullifierQuery,
    ) -> Result<Vec<(Self::AccountId, orchard::note::Nullifier)>, Self::Error> {
        Ok(self
            .nullifiers_of(ShieldedPool::Orchard, query)
            .into_iter()
            .filter_map(|(a, nf)| match nf {
                crate::Nullifier::Orchard(nf) => Some((a, nf)),
                _ => None,
            })
            .collect())
    }

    #[cfg(feature = "orchard")]
    fn get_ironwood_nullifiers(
        &self,
        query: NullifierQuery,
    ) -> Result<Vec<(Self::AccountId, orchard::note::Nullifier)>, Self::Error> {
        Ok(self
            .nullifiers_of(ShieldedPool::Ironwood, query)
            .into_iter()
            .filter_map(|(a, nf)| match nf {
                crate::Nullifier::Ironwood(nf) => Some((a, nf)),
                _ => None,
            })
            .collect())
    }

    #[cfg(feature = "transparent-inputs")]
    fn get_unspent_transparent_outpoints(
        &self,
    ) -> Result<HashMap<OutPoint, Self::AccountId>, Self::Error> {
        // `get_unspent_outpoints`: outputs without a mined spending transaction.
        Ok(self
            .transparent
            .iter()
            .filter(|o| {
                !self.transparent.spends_of(&o.outpoint).any(|stx| {
                    self.tx_table
                        .get(stx)
                        .is_some_and(|t| t.mined_height().is_some())
                })
            })
            .map(|o| (o.outpoint.clone(), o.account_id))
            .collect())
    }

    #[cfg(feature = "transparent-inputs")]
    fn get_transparent_receiver_accounts(
        &self,
    ) -> Result<HashMap<TransparentAddress, (Self::AccountId, Option<TransparentKeyScope>)>, Self::Error>
    {
        self.receiver_accounts()
    }

    #[cfg(feature = "transparent-inputs")]
    fn get_transparent_receivers(
        &self,
        account: Self::AccountId,
        include_change: bool,
        _include_standalone: bool,
    ) -> Result<HashMap<TransparentAddress, TransparentAddressMetadata>, Self::Error> {
        // Standalone (imported) addresses are not supported by this backend.
        let mut scopes = vec![KeyScope::External];
        if include_change {
            scopes.push(KeyScope::Internal);
        }
        self.transparent_receivers(account, &scopes, None, false)
    }

    #[cfg(feature = "transparent-inputs")]
    fn get_ephemeral_transparent_receivers(
        &self,
        account: Self::AccountId,
        exposure_depth: u32,
        exclude_used: bool,
    ) -> Result<HashMap<TransparentAddress, TransparentAddressMetadata>, Self::Error> {
        self.transparent_receivers(
            account,
            &[KeyScope::Ephemeral],
            Some(exposure_depth),
            exclude_used,
        )
    }

    #[cfg(feature = "transparent-inputs")]
    fn get_transparent_balances(
        &self,
        account: Self::AccountId,
        target_height: TargetHeight,
        confirmations_policy: ConfirmationsPolicy,
    ) -> Result<TransparentBalances, Self::Error> {
        self.transparent_balances(account, target_height, confirmations_policy)
    }

    #[cfg(feature = "transparent-inputs")]
    fn get_transparent_address_metadata(
        &self,
        account: Self::AccountId,
        address: &TransparentAddress,
    ) -> Result<Option<TransparentAddressMetadata>, Self::Error> {
        self.transparent_address_metadata(account, address)
    }

    #[cfg(feature = "transparent-inputs")]
    fn utxo_query_height(&self, account: Self::AccountId) -> Result<BlockHeight, Self::Error> {
        self.utxo_query_height_for(account)
    }

    fn transaction_data_requests(&self) -> Result<Vec<TransactionDataRequest>, Self::Error> {
        // Without a known chain tip, requests cannot be served meaningfully.
        let Some(_chain_tip) = self.chain_tip_height() else {
            return Ok(vec![]);
        };
        // `transaction_data_requests`: every enhancement request, and the status requests of
        // transactions that may still be mined.
        let mut requests: Vec<TransactionDataRequest> = self
            .tx_retrieval_queue
            .iter()
            .filter_map(|(txid, query_type, _)| match query_type {
                TxQueryType::Enhancement => Some(TransactionDataRequest::Enhancement(*txid)),
                TxQueryType::Status => self
                    .status_request_active(txid)
                    .then_some(TransactionDataRequest::GetStatus(*txid)),
            })
            .collect();
        #[cfg(feature = "transparent-inputs")]
        requests.extend(self.transparent_data_requests(_chain_tip)?);
        Ok(requests)
    }

    fn get_received_outputs(
        &self,
        txid: TxId,
        target_height: TargetHeight,
        confirmations_policy: ConfirmationsPolicy,
    ) -> Result<Vec<ReceivedTransactionOutput>, Self::Error> {
        // `get_received_outputs`, over the wallet's received outputs of `txid`.
        //
        // As in sqlite (`v_tx_outputs.recipient_key_scope`), the key scope passed to the
        // policy is the scope of the *address row* the output was received at. Shielded
        // outputs received by the internal key have no address row (sqlite
        // `ensure_address` records only non-internal receipts), so they report the
        // untrusted confirmation count here. This is a report only: spendability (balances,
        // note selection) uses the note's own recipient key scope, as sqlite does.
        let address_scope = |id: Option<crate::types::address::AddressId>| {
            id.and_then(|id| self.addresses.get(id))
                .and_then(|a| match a.key_scope {
                    KeyScope::External => Some(zip32::Scope::External),
                    KeyScope::Internal => Some(zip32::Scope::Internal),
                    _ => None,
                })
        };
        let tx = self.tx_table.get(&txid);
        let mined_height = tx.and_then(|t| t.mined_height());
        let tx_trusted = tx.is_some_and(|t| t.is_trusted());
        let mut out = vec![];
        for rn in self.received_notes.iter().filter(|rn| rn.txid() == txid) {
            let (max_sh, sh_trusted) = self.shielding_inputs(rn.account_id(), &txid);
            let pool = PoolType::Shielded(rn.pool());
            out.push(ReceivedTransactionOutput::from_parts(
                pool,
                usize::from(rn.output_index()),
                rn.note().value(),
                confirmations_policy.confirmations_until_spendable(
                    target_height,
                    pool,
                    address_scope(rn.address_id()),
                    mined_height,
                    tx_trusted,
                    max_sh,
                    sh_trusted,
                ),
            ));
        }
        for o in self
            .transparent
            .iter()
            .filter(|o| *o.outpoint.txid() == txid)
        {
            let (max_sh, sh_trusted) = self.shielding_inputs(o.account_id, &txid);
            let scope = address_scope(Some(o.address_id));
            out.push(ReceivedTransactionOutput::from_parts(
                PoolType::Transparent,
                usize::try_from(o.outpoint.n())?,
                o.txout.value(),
                confirmations_policy.confirmations_until_spendable(
                    target_height,
                    PoolType::Transparent,
                    scope,
                    mined_height,
                    tx_trusted,
                    max_sh,
                    sh_trusted,
                ),
            ));
        }
        Ok(out)
    }
}

