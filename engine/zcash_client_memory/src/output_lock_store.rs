//! `OutputLockStore` (zcash_client_backend 0.25 `data_api::locking`), following
//! zcash_client_sqlite 0.23 `wallet/locking.rs`.

use zcash_client_backend::{
    data_api::locking::{LockError, LockOwner, OutputLockStore},
    wallet::{NoteId, OutputRef},
};
use zcash_protocol::{PoolType, consensus::{self, BlockHeight}};

use crate::{
    AccountId, MemoryWalletDb,
    error::Error,
    types::locks::{LockKey, OutputLock},
};

impl<P: consensus::Parameters> MemoryWalletDb<P> {
    /// The account that received the output, if the wallet has it.
    fn output_owner_account(&self, output: &OutputRef) -> Option<AccountId> {
        match output.pool() {
            PoolType::Shielded(pool) => {
                let index = u16::try_from(output.output_index()).ok()?;
                self.received_notes
                    .get(&NoteId::new(*output.txid(), pool, index))
                    .map(|rn| rn.account_id())
            }
            PoolType::Transparent => {
                #[cfg(feature = "transparent-inputs")]
                {
                    self.transparent
                        .get(&::transparent::bundle::OutPoint::new(
                            *output.txid().as_ref(),
                            output.output_index(),
                        ))
                        .map(|o| o.account_id)
                }
                #[cfg(not(feature = "transparent-inputs"))]
                {
                    None
                }
            }
        }
    }
}

fn key_of(output: &OutputRef) -> LockKey {
    (*output.txid(), output.pool(), output.output_index())
}

impl<P: consensus::Parameters> OutputLockStore for MemoryWalletDb<P> {
    type Error = Error;
    type AccountId = AccountId;

    fn lock_outputs(
        &mut self,
        outputs: &[OutputRef],
        owner: LockOwner,
        lock_expiry_height: BlockHeight,
    ) -> Result<usize, LockError<Self::Error>> {
        // All or nothing: check every output first. An output may be locked when it
        // exists and is unlocked, held by `owner`, or its lock expired as of the chain tip.
        let chain_tip = self.chain_tip_height();
        for output in outputs {
            if self.output_owner_account(output).is_none() {
                return Err(LockError::LockFailure(*output));
            }
            let key = key_of(output);
            let lockable = match self.output_locks.get(&key) {
                None => true,
                Some(lock) => {
                    lock.owner == owner || chain_tip.is_some_and(|tip| lock.expiry_height <= tip)
                }
            };
            if !lockable {
                return Err(LockError::LockFailure(*output));
            }
        }
        for output in outputs {
            self.output_locks.set(
                key_of(output),
                OutputLock {
                    expiry_height: lock_expiry_height,
                    owner,
                },
            );
        }
        // One update per reference, duplicates included.
        Ok(outputs.len())
    }

    fn unlock_output(&mut self, output: &OutputRef, owner: LockOwner) -> Result<bool, Self::Error> {
        Ok(self.output_locks.unlock(&key_of(output), owner))
    }

    fn clear_locked_outputs(&mut self, account: Self::AccountId) -> Result<usize, Self::Error> {
        let keys: Vec<LockKey> = self
            .output_locks
            .0
            .keys()
            .filter(|(txid, pool, index)| {
                self.output_owner_account(&OutputRef::new(*txid, *pool, *index)) == Some(account)
            })
            .copied()
            .collect();
        let mut n = 0;
        for key in keys {
            if self.output_locks.clear(&key) {
                n += 1;
            }
        }
        Ok(n)
    }

    fn get_locked_outputs(&self, account: Self::AccountId) -> Result<Vec<OutputRef>, Self::Error> {
        // Locked: lock_expiry_height > chain tip (that is, >= the next block's height).
        let chain_tip = self.chain_tip_height().ok_or(Error::ChainHeightUnknown)?;
        Ok(self
            .output_locks
            .0
            .iter()
            .filter(|(_, lock)| lock.expiry_height > chain_tip)
            .map(|((txid, pool, index), _)| OutputRef::new(*txid, *pool, *index))
            .filter(|o| self.output_owner_account(o) == Some(account))
            .collect())
    }
}
