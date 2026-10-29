//! Accounts (the `accounts` table of zcash_client_sqlite 0.23).

use std::collections::BTreeMap;

use subtle::ConditionallySelectable;
use zcash_client_backend::data_api::{AccountBirthday, AccountSource};
use zcash_keys::keys::{UnifiedFullViewingKey, UnifiedIncomingViewingKey};
use zcash_protocol::consensus::BlockHeight;

use crate::error::Error;

/// The identifier of an account in this wallet. Unique and never reused within a wallet.
#[derive(
    Debug,
    Copy,
    Clone,
    PartialEq,
    Eq,
    Hash,
    Default,
    PartialOrd,
    Ord,
    serde::Serialize,
    serde::Deserialize,
)]
pub struct AccountId(u32);

impl From<u32> for AccountId {
    fn from(id: u32) -> Self {
        AccountId(id)
    }
}

impl From<AccountId> for u32 {
    fn from(id: AccountId) -> Self {
        id.0
    }
}

impl std::ops::Deref for AccountId {
    type Target = u32;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl ConditionallySelectable for AccountId {
    fn conditional_select(a: &Self, b: &Self, choice: subtle::Choice) -> Self {
        AccountId(ConditionallySelectable::conditional_select(
            &a.0, &b.0, choice,
        ))
    }
}

/// An account: a unified full viewing key, its source, and its birthday.
#[derive(Debug, Clone)]
pub struct Account {
    pub(crate) id: AccountId,
    pub(crate) name: Option<String>,
    pub(crate) source: AccountSource,
    pub(crate) ufvk: UnifiedFullViewingKey,
    pub(crate) birthday: AccountBirthday,
}

impl Account {
    pub(crate) fn birthday(&self) -> &AccountBirthday {
        &self.birthday
    }
}

impl zcash_client_backend::data_api::Account for Account {
    type AccountId = AccountId;

    fn id(&self) -> AccountId {
        self.id
    }

    fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    fn birthday_height(&self) -> BlockHeight {
        self.birthday.height()
    }

    fn source(&self) -> &AccountSource {
        &self.source
    }

    fn ufvk(&self) -> Option<&UnifiedFullViewingKey> {
        Some(&self.ufvk)
    }

    fn uivk(&self) -> UnifiedIncomingViewingKey {
        self.ufvk.to_unified_incoming_viewing_key()
    }
}

/// The accounts of the wallet.
#[derive(Debug, Clone, Default)]
pub(crate) struct Accounts {
    /// The id of the most recently created account; ids are never reused.
    pub(crate) nonce: u32,
    pub(crate) accounts: BTreeMap<AccountId, Account>,
}

impl Accounts {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Creates a new account. Use `MemoryWalletDb::add_account`, which also updates the
    /// note commitment trees and the scan queue.
    pub(crate) fn new_account(
        &mut self,
        account_name: &str,
        source: AccountSource,
        ufvk: UnifiedFullViewingKey,
        birthday: AccountBirthday,
    ) -> Result<(AccountId, Account), Error> {
        let next = self
            .nonce
            .checked_add(1)
            .ok_or(Error::AccountOutOfRange)?;
        let id = AccountId(next);
        let account = Account {
            id,
            name: Some(account_name.to_owned()),
            source,
            ufvk,
            birthday,
        };
        self.nonce = next;
        self.accounts.insert(id, account.clone());
        Ok((id, account))
    }

    pub(crate) fn get(&self, id: AccountId) -> Option<&Account> {
        self.accounts.get(&id)
    }

    pub(crate) fn get_mut(&mut self, id: AccountId) -> Option<&mut Account> {
        self.accounts.get_mut(&id)
    }

    pub(crate) fn ids(&self) -> impl Iterator<Item = AccountId> + '_ {
        self.accounts.keys().copied()
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = &Account> {
        self.accounts.values()
    }

    pub(crate) fn remove(&mut self, id: AccountId) -> Option<Account> {
        self.accounts.remove(&id)
    }

    /// The earliest birthday of any account (the wallet birthday).
    pub(crate) fn wallet_birthday(&self) -> Option<BlockHeight> {
        self.accounts.values().map(|a| a.birthday.height()).min()
    }

    /// The latest `recover_until` height of any account.
    pub(crate) fn recover_until(&self) -> Option<BlockHeight> {
        self.accounts
            .values()
            .filter_map(|a| a.birthday.recover_until())
            .max()
    }
}
