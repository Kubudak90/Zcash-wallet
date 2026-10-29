//! Transparent queries and address reservation, following zcash_client_sqlite 0.23
//! `wallet/transparent.rs` (each function names its sqlite counterpart).

use std::collections::HashMap;
use std::time::{Duration, SystemTime};

use ::transparent::{
    address::TransparentAddress,
    keys::{IncomingViewingKey as _, NonHardenedChildIndex, TransparentKeyScope},
};
use zcash_client_backend::{
    data_api::{
        Account as _, AccountBalance, Balance, CoinbaseFilter, OutputStatusFilter, TargetValue,
        TransactionDataRequest, TransactionStatusFilter, TransparentBalances,
        TransparentKeyOrigin,
        locking::LockFilter,
        wallet::{ConfirmationsPolicy, TargetHeight},
    },
    fees::StandardFeeRule,
    wallet::{Exposure, GapMetadata, TransparentAddressMetadata, WalletTransparentOutput},
};
use zcash_primitives::transaction::{
    builder::default_tx_expiry_delta,
    fees::{
        transparent::InputSize,
        zip317,
    },
};
use zcash_primitives::transaction::fees::{FeeRule as _, transparent::InputView as _};
use zcash_protocol::{
    PoolType,
    consensus::{self, BlockHeight, BranchId, COINBASE_MATURITY_BLOCKS},
    value::Zatoshis,
};

use crate::{
    AccountId, MemoryWalletDb, ReceivedTransparentOutput,
    error::Error,
    types::{address::{AddressId, KeyScope}, transaction::TransactionEntry},
};

/// Seconds since the Unix epoch as a `SystemTime` (no clock is read).
pub(crate) fn epoch_seconds_to_time(secs: u64) -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_secs(secs)
}

impl<P: consensus::Parameters> MemoryWalletDb<P> {
    /// `uivk_legacy_transparent_address`: the account's BIP 44 address at index 0.
    pub(crate) fn legacy_transparent_address(
        &self,
        account: AccountId,
    ) -> Option<(TransparentAddress, NonHardenedChildIndex)> {
        self.accounts
            .get(account)
            .and_then(|a| a.uivk().p2pkh().as_ref().map(|ivk| ivk.default_address()))
    }

    /// `get_receiver_accounts`.
    pub(crate) fn receiver_accounts(
        &self,
    ) -> Result<HashMap<TransparentAddress, (AccountId, Option<TransparentKeyScope>)>, Error> {
        let mut receivers: HashMap<_, _> = self
            .addresses
            .iter()
            .filter_map(|(_, a)| {
                a.transparent_receiver
                    .map(|t| (t, (a.account_id, a.key_scope.as_transparent())))
            })
            .collect();
        for account in self.accounts.ids() {
            if let Some((legacy, _)) = self.legacy_transparent_address(account) {
                receivers
                    .entry(legacy)
                    .or_insert((account, Some(TransparentKeyScope::EXTERNAL)));
            }
        }
        Ok(receivers)
    }

    /// The gap metadata of an exposed derived address (`get_transparent_receivers`).
    fn gap_metadata(
        &self,
        account: AccountId,
        scope: KeyScope,
        index: Option<NonHardenedChildIndex>,
    ) -> GapMetadata {
        let t_scope = scope.as_transparent();
        let limit = t_scope.and_then(|s| self.gap_limits.limit_for(s));
        match (limit, index) {
            (Some(gap_limit), Some(idx)) => match self.gap_start(account, scope, gap_limit) {
                Some(start) => match idx.index().checked_sub(start.index()) {
                    Some(gap_position) => GapMetadata::InGap {
                        gap_position,
                        gap_limit,
                    },
                    None => GapMetadata::GapRecoverable { gap_limit },
                },
                None => GapMetadata::GapRecoverable { gap_limit },
            },
            _ => GapMetadata::DerivationUnknown,
        }
    }

    /// `get_transparent_receivers`.
    pub(crate) fn transparent_receivers(
        &self,
        account: AccountId,
        scopes: &[KeyScope],
        exposure_depth: Option<u32>,
        exclude_used: bool,
    ) -> Result<HashMap<TransparentAddress, TransparentAddressMetadata>, Error> {
        if self.accounts.get(account).is_none() {
            return Err(Error::AccountUnknown(account));
        }
        let min_exposure_height = exposure_depth
            .map(|d| {
                self.mempool_height()
                    .ok_or(Error::ChainHeightUnknown)
                    .map(|h| h.saturating_sub(d))
            })
            .transpose()?;

        let mut ret = HashMap::new();
        for (id, row) in self.addresses.for_account(account) {
            let Some(taddr) = row.transparent_receiver else {
                continue;
            };
            if !scopes.contains(&row.key_scope) || row.key_scope == KeyScope::Foreign {
                continue;
            }
            if let Some(min) = min_exposure_height {
                if row.exposed_at_height.is_none_or(|h| h < min) {
                    continue;
                }
            }
            if exclude_used && self.transparent.iter().any(|o| o.address_id == id) {
                continue;
            }
            let exposure = row.exposed_at_height.map_or(Exposure::Unknown, |h| {
                Exposure::Exposed {
                    at_height: h,
                    gap_metadata: self.gap_metadata(
                        account,
                        row.key_scope,
                        row.transparent_child_index,
                    ),
                }
            });
            let (scope, index) = row
                .key_scope
                .as_transparent()
                .zip(row.transparent_child_index)
                .ok_or_else(|| {
                    Error::CorruptedData(
                        "Derived addresses must have derivation metadata present.".to_owned(),
                    )
                })?;
            ret.insert(
                taddr,
                TransparentAddressMetadata::derived(
                    scope,
                    index,
                    exposure,
                    row.next_check_time.map(epoch_seconds_to_time),
                ),
            );
        }
        Ok(ret)
    }

    /// `get_transparent_address_metadata`.
    pub(crate) fn transparent_address_metadata(
        &self,
        account: AccountId,
        address: &TransparentAddress,
    ) -> Result<Option<TransparentAddressMetadata>, Error> {
        if let Some((_, row)) = self
            .addresses
            .find_by_transparent_receiver(address)
            .filter(|(_, r)| r.account_id == account)
        {
            return match row.key_scope.as_transparent().zip(row.transparent_child_index) {
                Some((t_scope, index)) => {
                    let exposure = row.exposed_at_height.map_or(Exposure::Unknown, |at_height| {
                        Exposure::Exposed {
                            at_height,
                            gap_metadata: self.gap_metadata(
                                account,
                                row.key_scope,
                                Some(index),
                            ),
                        }
                    });
                    Ok(Some(TransparentAddressMetadata::derived(
                        t_scope,
                        index,
                        exposure,
                        row.next_check_time.map(epoch_seconds_to_time),
                    )))
                }
                None => Err(Error::CorruptedData(
                    "standalone imported transparent addresses are not supported by this backend"
                        .to_string(),
                )),
            };
        }
        if let Some((legacy, index)) = self.legacy_transparent_address(account) {
            if &legacy == address {
                return Ok(Some(TransparentAddressMetadata::derived(
                    TransparentKeyScope::EXTERNAL,
                    index,
                    Exposure::CannotKnow,
                    None,
                )));
            }
        }
        Ok(None)
    }

    /// `utxo_query_height`.
    pub(crate) fn utxo_query_height_for(&self, account: AccountId) -> Result<BlockHeight, Error> {
        let birthday = self
            .accounts
            .get(account)
            .map(|a| a.birthday().height())
            .ok_or(Error::AccountUnknown(account))?;
        let first_use = self.address_first_use_heights_all();
        let get_height = |scope: KeyScope, gap_limit: u32| -> Option<BlockHeight> {
            let gap_start = self.gap_start(account, scope, gap_limit)?;
            let from = gap_start.index().saturating_sub(gap_limit + 1);
            // MIN(mined_height) over `v_address_uses` rows of addresses at or after `from`.
            self.addresses
                .for_account(account)
                .filter(|(_, a)| {
                    a.key_scope == scope
                        && a.transparent_child_index.is_some_and(|i| i.index() >= from)
                })
                .filter_map(|(id, _)| first_use.get(&id).copied().flatten())
                .min()
        };
        let h_external = get_height(KeyScope::External, self.gap_limits.external());
        let h_internal = get_height(KeyScope::Internal, self.gap_limits.internal());
        Ok(match (h_external, h_internal) {
            (Some(a), Some(b)) => a.min(b),
            (Some(h), None) | (None, Some(h)) => h,
            (None, None) => birthday,
        })
    }

    /// For every address with a `v_address_uses` row: the least mined height of the
    /// transactions using it (`None` while none of them is mined).
    fn address_first_use_heights_all(&self) -> HashMap<AddressId, Option<BlockHeight>> {
        let mut uses: HashMap<AddressId, Option<BlockHeight>> = HashMap::new();
        let mut record = |id: AddressId, txid: &zcash_primitives::transaction::TxId| {
            let h = self.tx_table.get(txid).and_then(|t| t.mined_height());
            let e = uses.entry(id).or_insert(None);
            *e = match (*e, h) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, b) => a.or(b),
            };
        };
        for rn in self.received_notes.iter() {
            if let Some(id) = rn.address_id() {
                record(id, &rn.txid());
            }
        }
        for o in self.transparent.iter() {
            record(o.address_id, o.outpoint.txid());
        }
        uses
    }

    /// `tx_unexpired_condition_minconf_0`.
    fn creating_tx_ok_minconf(
        tx: &TransactionEntry,
        target_height: BlockHeight,
        min_confirmations: u32,
    ) -> bool {
        let mined_ok = tx
            .mined_height()
            .is_some_and(|h| h < target_height && u32::from(target_height - h) >= min_confirmations);
        let zero_conf_ok = min_confirmations == 0
            && tx
                .expiry_height()
                .is_some_and(|e| u32::from(e) == 0 || e >= target_height);
        mined_ok || zero_conf_ok
    }

    /// The minimum confirmations transparent queries use: 0 under zero-conf shielding,
    /// else the untrusted count.
    fn transparent_min_confirmations(policy: &ConfirmationsPolicy) -> u32 {
        if policy.allow_zero_conf_shielding() {
            0
        } else {
            u32::from(policy.untrusted())
        }
    }

    /// Whether the output's creating transaction is coinbase (`IFNULL(tx_index, 1) == 0`).
    fn is_coinbase(tx: &TransactionEntry) -> bool {
        tx.tx_index() == Some(0)
    }

    /// The transparent outputs that are candidates for spending (`spendable_transparent_
    /// outputs_query`), unsorted.
    fn spendable_transparent_candidates<'a>(
        &'a self,
        target_height: TargetHeight,
        policy: ConfirmationsPolicy,
        output_filter: CoinbaseFilter,
        lock_filter: LockFilter<'a>,
        keep: impl Fn(&ReceivedTransparentOutput) -> bool + 'a,
    ) -> Result<Vec<&'a ReceivedTransparentOutput>, Error> {
        let target = BlockHeight::from(target_height);
        let min_confirmations = Self::transparent_min_confirmations(&policy);
        let mut out = vec![];
        for o in self.transparent.iter() {
            if !keep(o) || o.txout.value() <= zip317::MARGINAL_FEE {
                continue;
            }
            let Some(tx) = self.tx_table.get(o.outpoint.txid()) else {
                continue;
            };
            if !Self::creating_tx_ok_minconf(tx, target, min_confirmations)
                || self.is_utxo_spent(&o.outpoint, target)
                || !self.ephemeral_output_eligible(o)?
            {
                continue;
            }
            let coinbase = Self::is_coinbase(tx);
            // Immature coinbase outputs are excluded.
            if coinbase
                && tx
                    .mined_height()
                    .is_none_or(|h| u32::from(target).saturating_sub(u32::from(h)) < COINBASE_MATURITY_BLOCKS)
            {
                continue;
            }
            let filter_ok = match output_filter {
                CoinbaseFilter::AllTransparentOutputs => true,
                CoinbaseFilter::CoinbaseOnly => coinbase,
                CoinbaseFilter::NonCoinbaseOnly => !coinbase,
            };
            if !filter_ok {
                continue;
            }
            let key = (*o.outpoint.txid(), PoolType::TRANSPARENT, o.outpoint.n());
            if !self.lock_eligible(&key, target, lock_filter) {
                continue;
            }
            // Outputs of addresses without key material (Foreign rows) cannot be spent;
            // this backend never stores such rows.
            if self
                .addresses
                .get(o.address_id)
                .is_some_and(|a| a.key_scope == KeyScope::Foreign)
            {
                continue;
            }
            out.push(o);
        }
        Ok(out)
    }

    /// `to_unspent_transparent_output`.
    pub(crate) fn to_wallet_transparent_output(
        &self,
        o: &ReceivedTransparentOutput,
    ) -> Result<WalletTransparentOutput<AccountId>, Error> {
        let funding_account = self
            .funding_accounts_of(o.outpoint.txid())?
            .into_iter()
            .next()
            .map(|(a, _)| a);
        let key_scope = self
            .addresses
            .get(o.address_id)
            .and_then(|a| a.key_scope.as_transparent());
        WalletTransparentOutput::from_parts(
            o.outpoint.clone(),
            o.txout.clone(),
            self.tx_table
                .get(o.outpoint.txid())
                .and_then(|t| t.mined_height()),
            Some(o.account_id),
            key_scope,
            funding_account,
        )
        .ok_or_else(|| {
            Error::CorruptedData(
                "Txout script_pubkey value did not correspond to a P2PKH or P2SH address"
                    .to_string(),
            )
        })
    }

    /// `get_spendable_transparent_outputs_for_addresses`: ordered by address, then index.
    pub(crate) fn spendable_transparent_outputs_for(
        &self,
        addresses: &[TransparentAddress],
        target_height: TargetHeight,
        policy: ConfirmationsPolicy,
        output_filter: CoinbaseFilter,
        lock_filter: LockFilter<'_>,
    ) -> Result<Vec<WalletTransparentOutput<AccountId>>, Error> {
        if addresses.is_empty() {
            return Ok(vec![]);
        }
        let mut candidates = self.spendable_transparent_candidates(
            target_height,
            policy,
            output_filter,
            lock_filter,
            |o| {
                self.addresses
                    .get(o.address_id)
                    .and_then(|a| a.transparent_receiver)
                    .is_some_and(|t| addresses.contains(&t))
            },
        )?;
        candidates.sort_by(|a, b| {
            let enc = |o: &ReceivedTransparentOutput| {
                zcash_keys::encoding::AddressCodec::encode(&o.address, &self.params)
            };
            enc(a).cmp(&enc(b)).then(a.outpoint.n().cmp(&b.outpoint.n()))
        });
        candidates
            .into_iter()
            .map(|o| self.to_wallet_transparent_output(o))
            .collect()
    }

    /// `select_spendable_transparent_outputs`.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn select_spendable_transparent(
        &self,
        account: AccountId,
        target_height: TargetHeight,
        policy: ConfirmationsPolicy,
        output_filter: CoinbaseFilter,
        address_allow_list: Option<&[TransparentAddress]>,
        target_value: TargetValue,
        max_inputs: usize,
        fee_rule: &StandardFeeRule,
        lock_filter: LockFilter<'_>,
    ) -> Result<Vec<WalletTransparentOutput<AccountId>>, Error> {
        let target = BlockHeight::from(target_height);
        let target_zat: Option<u64> = match target_value {
            TargetValue::AtLeast(z) => Some(u64::from(z)),
            TargetValue::AllFunds(_) => None,
        };
        let mut candidates = self.spendable_transparent_candidates(
            target_height,
            policy,
            output_filter,
            lock_filter,
            |o| {
                o.account_id == account
                    && address_allow_list.is_none_or(|list| {
                        self.addresses
                            .get(o.address_id)
                            .and_then(|a| a.transparent_receiver)
                            .is_some_and(|t| list.contains(&t))
                    })
            },
        )?;
        // ORDER BY [lock tier,] value DESC, output_index.
        candidates.sort_by(|a, b| {
            let key_a = (*a.outpoint.txid(), PoolType::TRANSPARENT, a.outpoint.n());
            let key_b = (*b.outpoint.txid(), PoolType::TRANSPARENT, b.outpoint.n());
            self.lock_tier_key(&key_a, target, lock_filter)
                .cmp(&self.lock_tier_key(&key_b, target, lock_filter))
                .then(b.txout.value().cmp(&a.txout.value()))
                .then(a.outpoint.n().cmp(&b.outpoint.n()))
        });

        let mut utxos = vec![];
        let mut accumulated_value: u64 = 0;
        let mut cumulative_input_size: usize = 0;
        for o in candidates {
            if utxos.len() >= max_inputs {
                break;
            }
            let output = self.to_wallet_transparent_output(o)?;
            if let Some(target_zat) = target_zat {
                let cumulative_fee = fee_rule
                    .fee_required(
                        &self.params,
                        target,
                        [InputSize::Known(cumulative_input_size)],
                        std::iter::empty::<usize>(),
                        0,
                        0,
                        0,
                        0,
                    )
                    .map_err(|e| Error::Other(format!("fee computation failed: {e:?}")))?;
                if accumulated_value.saturating_sub(u64::from(cumulative_fee)) >= target_zat {
                    break;
                }
            }
            let input_size = match output.serialized_size() {
                InputSize::Known(size) => size,
                InputSize::Unknown(_) => zip317::P2PKH_STANDARD_INPUT_SIZE,
            };
            cumulative_input_size += input_size;
            accumulated_value = accumulated_value.saturating_add(u64::from(output.value()));
            utxos.push(output);
        }
        Ok(utxos)
    }

    fn key_origin(scope: KeyScope) -> Result<TransparentKeyOrigin, Error> {
        match scope.as_transparent() {
            Some(scope) => Ok(TransparentKeyOrigin::Derived { scope }),
            None => Ok(TransparentKeyOrigin::Imported),
        }
    }

    /// `get_transparent_balances`.
    pub(crate) fn transparent_balances(
        &self,
        account: AccountId,
        target_height: TargetHeight,
        policy: ConfirmationsPolicy,
    ) -> Result<TransparentBalances, Error> {
        let target = BlockHeight::from(target_height);
        let min_confirmations = Self::transparent_min_confirmations(&policy);
        let mut result: TransparentBalances = HashMap::new();
        for o in self.transparent.iter().filter(|o| o.account_id == account) {
            let value = o.txout.value();
            if value == Zatoshis::ZERO {
                continue;
            }
            let Some(tx) = self.tx_table.get(o.outpoint.txid()) else {
                continue;
            };
            let Some(addr) = self.addresses.get(o.address_id) else {
                continue;
            };
            if self.is_utxo_spent(&o.outpoint, target) || !self.ephemeral_output_eligible(o)? {
                continue;
            }
            let confirmed = Self::creating_tx_ok_minconf(tx, target, min_confirmations);
            let pending = min_confirmations > 0
                && (tx.mined_height().is_some_and(|h| {
                    h < target && u32::from(target - h) < min_confirmations
                }) || (tx.mined_height().is_none()
                    && tx
                        .expiry_height()
                        .is_some_and(|e| u32::from(e) == 0 || e >= target)));
            if !confirmed && !pending {
                continue;
            }
            let entry = result
                .entry(o.address)
                .or_insert((Self::key_origin(addr.key_scope)?, Balance::ZERO));
            let key = (*o.outpoint.txid(), PoolType::TRANSPARENT, o.outpoint.n());
            if value <= zip317::MARGINAL_FEE {
                entry.1.add_uneconomic_value(value)?;
            } else if confirmed && self.output_locks.is_locked_at(&key, target) {
                entry.1.add_locked_value(value)?;
            } else {
                // Confirmed: spendable. Pending (not enough confirmations): sqlite's second
                // query also reports it as spendable.
                entry.1.add_spendable_value(value)?;
            }
        }
        Ok(result)
    }

    /// `add_transparent_account_balances`. As in zcash_client_sqlite, outputs are summed per
    /// (account, lock expiry, coinbase, maturity) group before the uneconomic-value test.
    pub(crate) fn add_transparent_account_balances(
        &self,
        target_height: TargetHeight,
        policy: ConfirmationsPolicy,
        balances: &mut HashMap<AccountId, AccountBalance>,
    ) -> Result<(), Error> {
        use std::collections::BTreeMap;
        let target = BlockHeight::from(target_height);
        let min_confirmations = Self::transparent_min_confirmations(&policy);

        // (account, lock expiry, is_coinbase, is_mature) -> sum, for confirmed outputs;
        // (account, lock expiry, is_coinbase) -> sum, for pending ones.
        let mut confirmed: BTreeMap<(AccountId, Option<BlockHeight>, bool, bool), Zatoshis> =
            BTreeMap::new();
        let mut pending: BTreeMap<(AccountId, Option<BlockHeight>, bool), Zatoshis> =
            BTreeMap::new();
        for o in self.transparent.iter() {
            let Some(tx) = self.tx_table.get(o.outpoint.txid()) else {
                continue;
            };
            if self.addresses.get(o.address_id).is_none()
                || self.is_utxo_spent(&o.outpoint, target)
                || !self.ephemeral_output_eligible(o)?
            {
                continue;
            }
            let key = (*o.outpoint.txid(), PoolType::TRANSPARENT, o.outpoint.n());
            let lock_expiry = self.output_locks.get(&key).map(|l| l.expiry_height);
            let is_coinbase = Self::is_coinbase(tx);
            if Self::creating_tx_ok_minconf(tx, target, min_confirmations) {
                let is_mature = tx.mined_height().is_some_and(|h| {
                    u32::from(target).saturating_sub(u32::from(h)) >= COINBASE_MATURITY_BLOCKS
                });
                let e = confirmed
                    .entry((o.account_id, lock_expiry, is_coinbase, is_mature))
                    .or_insert(Zatoshis::ZERO);
                *e = (*e + o.txout.value()).ok_or(Error::Balance(
                    zcash_protocol::value::BalanceError::Overflow,
                ))?;
            } else if min_confirmations > 0
                && (tx.mined_height().is_some_and(|h| {
                    h < target && u32::from(target - h) < min_confirmations
                }) || (tx.mined_height().is_none()
                    && tx
                        .expiry_height()
                        .is_some_and(|e| u32::from(e) == 0 || e >= target)))
            {
                let e = pending
                    .entry((o.account_id, lock_expiry, is_coinbase))
                    .or_insert(Zatoshis::ZERO);
                *e = (*e + o.txout.value()).ok_or(Error::Balance(
                    zcash_protocol::value::BalanceError::Overflow,
                ))?;
            }
        }
        let is_locked = |exp: Option<BlockHeight>| exp.is_some_and(|e| e >= target);
        for ((account, lock_expiry, is_coinbase, is_mature), value) in confirmed {
            let balance = balances.entry(account).or_insert(AccountBalance::ZERO);
            let apply = |bal: &mut Balance| -> Result<(), Error> {
                if value <= zip317::MARGINAL_FEE {
                    bal.add_uneconomic_value(value)?;
                } else if is_locked(lock_expiry) {
                    bal.add_locked_value(value)?;
                } else if !is_coinbase || is_mature {
                    bal.add_spendable_value(value)?;
                } else {
                    bal.add_pending_spendable_value(value)?;
                }
                Ok(())
            };
            if is_coinbase {
                balance.with_unshielded_coinbase_balance_mut(apply)?;
            } else {
                balance.with_unshielded_regular_balance_mut(apply)?;
            }
        }
        for ((account, lock_expiry, is_coinbase), value) in pending {
            let balance = balances.entry(account).or_insert(AccountBalance::ZERO);
            let apply = |bal: &mut Balance| -> Result<(), Error> {
                if value <= zip317::MARGINAL_FEE {
                    bal.add_uneconomic_value(value)?;
                } else if is_locked(lock_expiry) {
                    bal.add_locked_value(value)?;
                } else {
                    bal.add_pending_spendable_value(value)?;
                }
                Ok(())
            };
            if is_coinbase {
                balance.with_unshielded_coinbase_balance_mut(apply)?;
            } else {
                balance.with_unshielded_regular_balance_mut(apply)?;
            }
        }
        Ok(())
    }

    /// The transparent part of `transaction_data_requests` (without the `spend-index`
    /// feature): spend searches for queued outputs, and checks of ephemeral addresses.
    pub(crate) fn transparent_data_requests(
        &self,
        chain_tip_height: BlockHeight,
    ) -> Result<Vec<TransactionDataRequest>, Error> {
        let mut requests = vec![];
        for ((txid, _output_index), address) in self.transparent_spend_search_queue.0.iter() {
            let Some(t) = self.tx_table.get(txid) else {
                continue;
            };
            // Joined with every received output of the transaction (as sqlite's query
            // joins on the transaction only).
            for tro in self
                .transparent
                .iter()
                .filter(|o| o.outpoint.txid() == txid)
            {
                let unspent = self.transparent.spends_of(&tro.outpoint).next().is_none();
                let not_ephemeral = self
                    .addresses
                    .get(tro.address_id)
                    .is_some_and(|a| a.key_scope != KeyScope::Ephemeral);
                let observed_ok = tro
                    .max_observed_unspent_height
                    .is_none_or(|h| h < chain_tip_height);
                let block_range_start = tro
                    .max_observed_unspent_height
                    .map(|h| h + 1)
                    .or(t.mined_height());
                let start_ok = block_range_start.is_some()
                    || t.expiry_height().is_some_and(|e| e > chain_tip_height);
                if unspent && not_ephemeral && observed_ok && start_ok {
                    let start = block_range_start.unwrap_or(chain_tip_height);
                    let max_end = start
                        + default_tx_expiry_delta(BranchId::for_height(&self.params, start))
                        + 1;
                    requests.push(TransactionDataRequest::transactions_involving_address(
                        *address,
                        start,
                        Some(std::cmp::min(chain_tip_height + 1, max_end)),
                        None,
                        TransactionStatusFilter::Mined,
                        OutputStatusFilter::All,
                    ));
                }
            }
        }

        for (id, row) in self.addresses.iter() {
            if row.key_scope != KeyScope::Ephemeral {
                continue;
            }
            let Some(taddr) = row.transparent_receiver else {
                continue;
            };
            let outputs: Vec<_> = self.transparent.iter().filter(|o| o.address_id == id).collect();
            let pending = outputs.iter().any(|o| {
                self.tx_table
                    .get(o.outpoint.txid())
                    .and_then(|t| t.expiry_height())
                    .is_some_and(|e| e > chain_tip_height)
            });
            if pending {
                continue;
            }
            let start = outputs
                .iter()
                .filter_map(|o| {
                    o.max_observed_unspent_height.map(|h| h + 1).or_else(|| {
                        self.tx_table
                            .get(o.outpoint.txid())
                            .and_then(|t| t.mined_height())
                    })
                })
                .min()
                .unwrap_or(BlockHeight::from(0));
            requests.push(TransactionDataRequest::transactions_involving_address(
                taddr,
                start,
                None,
                row.next_check_time.map(epoch_seconds_to_time),
                TransactionStatusFilter::All,
                OutputStatusFilter::Unspent,
            ));
        }
        Ok(requests)
    }

    /// `reserve_next_n_addresses`: marks the next `n` unexposed addresses of the gap as
    /// exposed at the chain tip.
    pub(crate) fn reserve_next_n_addresses(
        &mut self,
        account: AccountId,
        scope: KeyScope,
        gap_limit: u32,
        n: usize,
    ) -> Result<Vec<(TransparentAddress, TransparentAddressMetadata)>, Error> {
        if n == 0 {
            return Ok(vec![]);
        }
        let t_scope = scope.as_transparent().ok_or_else(|| {
            Error::Other("address reservation requires a derived key scope".into())
        })?;
        let gap_start = self
            .gap_start(account, scope, gap_limit)
            .ok_or_else(|| Error::Other("transparent address space exhausted".into()))?;
        let gap_end = gap_start.index().saturating_add(gap_limit);
        let mut candidates: Vec<(AddressId, NonHardenedChildIndex, TransparentAddress)> = self
            .addresses
            .for_account(account)
            .filter(|(_, a)| a.key_scope == scope && a.exposed_at_height.is_none())
            .filter_map(|(id, a)| {
                a.transparent_child_index
                    .zip(a.transparent_receiver)
                    .map(|(i, t)| (id, i, t))
            })
            .filter(|(_, i, _)| i.index() >= gap_start.index() && i.index() < gap_end)
            .collect();
        candidates.sort_by_key(|(_, i, _)| i.index());
        candidates.truncate(n);
        if candidates.len() < n {
            return Err(Error::ReachedGapLimit(account, gap_end));
        }
        let chain_tip = self.chain_tip_height().ok_or(Error::ChainHeightUnknown)?;
        let mut out = vec![];
        for (id, index, taddr) in candidates {
            self.addresses.mark_exposed(id, chain_tip);
            out.push((
                taddr,
                TransparentAddressMetadata::derived(
                    t_scope,
                    index,
                    Exposure::Exposed {
                        at_height: chain_tip,
                        gap_metadata: GapMetadata::InGap {
                            gap_position: index.index().saturating_sub(gap_start.index()),
                            gap_limit,
                        },
                    },
                    None,
                ),
            ));
        }
        Ok(out)
    }

    /// `update_observed_unspent_heights` (`notify_address_checked`).
    pub(crate) fn update_observed_unspent_heights(
        &mut self,
        address: TransparentAddress,
        checked_at: BlockHeight,
    ) -> Result<(), Error> {
        let chain_tip = self.chain_tip_height().ok_or(Error::ChainHeightUnknown)?;
        let checked_at = std::cmp::min(checked_at, chain_tip);
        let ops: Vec<_> = self
            .transparent
            .iter()
            .filter(|o| o.address == address && self.transparent.spends_of(&o.outpoint).next().is_none())
            .map(|o| o.outpoint.clone())
            .collect();
        for op in ops {
            if let Some(o) = self.transparent.outputs.get_mut(&op) {
                o.max_observed_unspent_height = Some(
                    o.max_observed_unspent_height
                        .map_or(checked_at, |h| h.max(checked_at)),
                );
            }
        }
        Ok(())
    }
}
