use async_trait::async_trait;
use std::collections::BTreeMap;
use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
use wasm_sync::RwLock;
use zcash_client_backend::data_api::chain::{BlockCache, BlockSource};
use zcash_client_backend::data_api::scanning::ScanRange;
use zcash_client_backend::proto::compact_formats::CompactBlock;
use zcash_protocol::consensus::BlockHeight;

/// A block cache that just holds blocks in a map in memory
#[derive(Default)]
pub struct MemBlockCache(pub(crate) RwLock<BTreeMap<BlockHeight, CompactBlock>>);

impl MemBlockCache {
    /// Constructs a new empty [`MemBlockCache`].
    pub fn new() -> Self {
        Default::default()
    }

    /// Returns the [`CompactBlock`] at the given height, if it exists in the cache.
    pub fn find_block(&self, block_height: BlockHeight) -> Option<CompactBlock> {
        self.0.read().unwrap().get(&block_height).cloned()
    }
}

impl BlockSource for MemBlockCache {
    type Error = Infallible;

    fn with_blocks<F, WalletErrT>(
        &self,
        from_height: Option<zcash_protocol::consensus::BlockHeight>,
        limit: Option<usize>,
        mut with_block: F,
    ) -> Result<(), zcash_client_backend::data_api::chain::error::Error<WalletErrT, Self::Error>>
    where
        F: FnMut(
            CompactBlock,
        ) -> Result<
            (),
            zcash_client_backend::data_api::chain::error::Error<WalletErrT, Self::Error>,
        >,
    {
        let inner = self.0.read().unwrap();
        let block_iter = inner
            .iter()
            .filter(|(_, cb)| {
                if let Some(from_height) = from_height {
                    cb.height() >= from_height
                } else {
                    true
                }
            })
            .take(limit.unwrap_or(usize::MAX));

        for (_, cb) in block_iter {
            with_block(cb.clone())?;
        }
        Ok(())
    }
}

#[async_trait]
impl BlockCache for MemBlockCache {
    fn get_tip_height(
        &self,
        range: Option<&ScanRange>,
    ) -> Result<Option<BlockHeight>, Self::Error> {
        let inner = self.0.read().unwrap();
        if let Some(range) = range {
            let range = range.block_range();
            for h in (u32::from(range.start)..u32::from(range.end)).rev() {
                if let Some(cb) = inner.get(&h.into()) {
                    return Ok(Some(cb.height()));
                }
            }
        } else {
            return Ok(inner.last_key_value().map(|(h, _)| *h));
        }

        Ok(None)
    }

    async fn read(&self, range: &ScanRange) -> Result<Vec<CompactBlock>, Self::Error> {
        let inner = self.0.read().unwrap();
        let mut ret = Vec::with_capacity(range.len());
        let range = range.block_range();
        for height in u32::from(range.start)..u32::from(range.end) {
            if let Some(cb) = inner.get(&height.into()) {
                ret.push(cb.clone());
            }
        }

        Ok(ret)
    }

    async fn insert(&self, compact_blocks: Vec<CompactBlock>) -> Result<(), Self::Error> {
        let mut inner = self.0.write().unwrap();
        compact_blocks.into_iter().for_each(|compact_block| {
            inner.insert(compact_block.height(), compact_block);
        });
        Ok(())
    }

    /// Removes the blocks of `range` when called, not when the returned future is polled.
    ///
    /// `zcash_client_backend::sync::run` keeps the futures `delete` returns and awaits them
    /// only when the pass ends (or drops them on an error), so an `async fn` here would keep
    /// every block of the pass in memory until then: on a restore, the whole range from the
    /// birthday to the tip (review finding R3). `run` calls `delete` right after scanning a
    /// range and never reads that range again without downloading it again.
    fn delete<'life0, 'async_trait>(
        &'life0 self,
        range: ScanRange,
    ) -> Pin<Box<dyn Future<Output = Result<(), Self::Error>> + Send + 'async_trait>>
    where
        'life0: 'async_trait,
        Self: 'async_trait,
    {
        self.remove_range(&range);
        Box::pin(std::future::ready(Ok(())))
    }
}

impl MemBlockCache {
    /// Removes the blocks of `range` from the cache.
    pub fn remove_range(&self, range: &ScanRange) {
        let mut inner = self.0.write().unwrap();
        let range = range.block_range();
        if range.start >= range.end {
            return;
        }
        // Everything at or above `range.start`, minus what is at or above `range.end`.
        let mut tail = inner.split_off(&range.start);
        let mut keep = tail.split_off(&range.end);
        inner.append(&mut keep);
        drop(tail);
    }

    /// The number of blocks in the cache.
    pub fn len(&self) -> usize {
        self.0.read().unwrap().len()
    }

    /// Whether the cache holds no block.
    pub fn is_empty(&self) -> bool {
        self.0.read().unwrap().is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::pin::pin;
    use std::task::{Context, Poll, Waker};
    use zcash_client_backend::data_api::scanning::ScanPriority;

    fn block(height: u32) -> CompactBlock {
        CompactBlock {
            height: height.into(),
            ..Default::default()
        }
    }

    fn poll_once<F: Future>(f: F) -> Poll<F::Output> {
        let mut cx = Context::from_waker(Waker::noop());
        pin!(f).poll(&mut cx)
    }

    /// `zcash_client_backend::sync::run` collects the futures `delete` returns and awaits them
    /// only when the pass ends, so the blocks of a scanned batch must leave the cache when
    /// `delete` is called, not when its future is polled (review finding R3: otherwise a pass
    /// keeps every block it downloaded in memory until it ends).
    #[test]
    fn delete_frees_the_blocks_when_called() {
        let cache = MemBlockCache::new();
        assert!(poll_once(cache.insert((100..110).map(block).collect())).is_ready());
        assert_eq!(cache.0.read().unwrap().len(), 10);

        let range = ScanRange::from_parts(BlockHeight::from(100)..BlockHeight::from(105), ScanPriority::Historic);
        let pending = cache.delete(range);
        assert_eq!(
            cache.0.read().unwrap().keys().map(|h| u32::from(*h)).collect::<Vec<_>>(),
            (105..110).collect::<Vec<_>>(),
            "the deleted range is gone before the future is awaited"
        );
        assert!(poll_once(pending).is_ready());
        assert_eq!(cache.0.read().unwrap().len(), 5);

        // A future that is dropped without being awaited (as `run` drops them on an error)
        // has still deleted its range.
        drop(cache.delete(ScanRange::from_parts(BlockHeight::from(105)..BlockHeight::from(110), ScanPriority::Historic)));
        assert!(cache.0.read().unwrap().is_empty());
    }
}
