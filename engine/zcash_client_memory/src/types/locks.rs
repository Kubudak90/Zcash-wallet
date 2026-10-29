//! Advisory output locks (zcash_client_backend 0.25 `data_api::locking`).
//!
//! zcash_client_sqlite keeps `lock_expiry_height` and `lock_owner` columns on each
//! received-output table; here they are one map keyed by output, for every pool.
//! The semantics are those stated in `zcash_client_backend::data_api::locking`:
//!
//! - an output is *locked* for a transaction to be mined at `target_height` while
//!   `expiry_height >= target_height`;
//! - a lock may be acquired when the output is unlocked, when its lock expired as of the
//!   chain tip (`expiry_height <= chain_tip`), or when the same owner holds it; acquiring
//!   several outputs is all-or-nothing.

use std::collections::BTreeMap;

use zcash_client_backend::data_api::locking::LockOwner;
use zcash_primitives::transaction::TxId;
use zcash_protocol::{PoolType, consensus::BlockHeight};

/// An output as the lock table identifies it: creating transaction, pool, index.
pub(crate) type LockKey = (TxId, PoolType, u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OutputLock {
    pub(crate) expiry_height: BlockHeight,
    pub(crate) owner: LockOwner,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct OutputLocks(pub(crate) BTreeMap<LockKey, OutputLock>);

impl OutputLocks {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn get(&self, key: &LockKey) -> Option<&OutputLock> {
        self.0.get(key)
    }

    /// Whether the output counts as locked in balances at `target_height`.
    pub(crate) fn is_locked_at(&self, key: &LockKey, target_height: BlockHeight) -> bool {
        self.0
            .get(key)
            .is_some_and(|lock| lock.expiry_height >= target_height)
    }

    pub(crate) fn set(&mut self, key: LockKey, lock: OutputLock) {
        self.0.insert(key, lock);
    }

    /// Removes the lock if `owner` holds it; returns whether it did.
    pub(crate) fn unlock(&mut self, key: &LockKey, owner: LockOwner) -> bool {
        if self.0.get(key).is_some_and(|lock| lock.owner == owner) {
            self.0.remove(key);
            true
        } else {
            false
        }
    }

    /// Removes the lock regardless of owner; returns whether there was one.
    pub(crate) fn clear(&mut self, key: &LockKey) -> bool {
        self.0.remove(key).is_some()
    }
}
