//! The scan queue (the `scan_queue` table of zcash_client_sqlite 0.23).
//!
//! The rules follow zcash_client_sqlite 0.23 `wallet/scanning.rs`: `suggest_scan_ranges`,
//! `insert_queue_entries`, `replace_queue_entries`, `queue_rescan`,
//! `prune_scan_queue_below`, and `trim_scan_queue_to` (`wallet.rs`).

use std::cmp::min;
use std::ops::Range;

use zcash_client_backend::data_api::scanning::{
    ScanPriority, ScanRange, spanning_tree::SpanningTree,
};
use zcash_protocol::consensus::BlockHeight;

use crate::error::Error;

/// A queue of scanning ranges: start (inclusive), end (exclusive) and priority of each.
/// Ranges do not overlap.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct ScanQueue(pub(crate) Vec<(BlockHeight, BlockHeight, ScanPriority)>);

impl ScanQueue {
    pub(crate) fn new() -> Self {
        ScanQueue(Vec::new())
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = &(BlockHeight, BlockHeight, ScanPriority)> {
        self.0.iter()
    }

    pub(crate) fn ranges(&self) -> impl Iterator<Item = ScanRange> + '_ {
        self.0
            .iter()
            .map(|(start, end, p)| ScanRange::from_parts(*start..*end, *p))
    }

    /// `suggest_scan_ranges`: ranges with at least `min_priority`, ordered by priority
    /// (highest first), then by end height (highest first).
    pub(crate) fn suggest_scan_ranges(&self, min_priority: ScanPriority) -> Vec<ScanRange> {
        let mut ranges: Vec<ScanRange> = self
            .ranges()
            .filter(|r| r.priority() >= min_priority)
            .collect();
        ranges.sort_by(|a, b| {
            b.priority()
                .cmp(&a.priority())
                .then(b.block_range().end.cmp(&a.block_range().end))
        });
        ranges
    }

    /// `insert_queue_entries`: empty entries are skipped. A non-empty entry overlapping an
    /// existing one is an error (sqlite's table has no such constraint, but its callers
    /// never insert overlapping ranges; here the invariant is checked).
    fn insert_queue_entries<'a>(
        &mut self,
        entries: impl Iterator<Item = &'a ScanRange>,
    ) -> Result<(), Error> {
        for entry in entries {
            if entry.is_empty() {
                continue;
            }
            let r = entry.block_range();
            if self
                .0
                .iter()
                .any(|(start, end, _)| *start < r.end && r.start < *end)
            {
                return Err(Error::InvalidScanRange(
                    r.start,
                    r.end,
                    "range overlaps an existing scan queue entry".to_string(),
                ));
            }
            self.0.push((r.start, r.end, entry.priority()));
        }
        self.0.sort_by_key(|(start, _, _)| *start);
        Ok(())
    }

    /// `replace_queue_entries`: merges `entries` with the queue entries overlapping or
    /// adjacent to `query_range` through a [`SpanningTree`], and replaces those entries
    /// with the result.
    pub(crate) fn replace_queue_entries(
        &mut self,
        query_range: &Range<BlockHeight>,
        entries: impl Iterator<Item = ScanRange>,
        force_rescans: bool,
    ) -> Result<(), Error> {
        let mut existing: Vec<ScanRange> = self
            .ranges()
            // Ignore ranges that do not overlap and are not adjacent to the query range.
            .filter(|r| !(r.block_range().start > query_range.end || query_range.start > r.block_range().end))
            .collect();
        existing.sort_by_key(|r| r.block_range().end);

        let mut to_create: Option<SpanningTree> = None;
        let mut to_delete_ends: Vec<BlockHeight> = vec![];
        for entry in existing {
            to_delete_ends.push(entry.block_range().end);
            to_create = Some(match to_create {
                Some(cur) => cur.insert(entry, force_rescans),
                None => SpanningTree::Leaf(entry),
            });
        }
        for entry in entries {
            to_create = Some(match to_create {
                Some(cur) => cur.insert(entry, force_rescans),
                None => SpanningTree::Leaf(entry),
            });
        }

        if let Some(tree) = to_create {
            self.0.retain(|(_, end, _)| !to_delete_ends.contains(end));
            let scan_ranges = tree.into_vec();
            self.insert_queue_entries(scan_ranges.iter())?;
        }
        Ok(())
    }

    /// `queue_rescan`: queues `range` at `Historic` priority, overriding `Scanned`.
    pub(crate) fn queue_rescan(&mut self, range: Range<BlockHeight>) -> Result<(), Error> {
        if range.is_empty() {
            return Ok(());
        }
        self.replace_queue_entries(
            &range,
            Some(ScanRange::from_parts(range.clone(), ScanPriority::Historic)).into_iter(),
            true,
        )
    }

    /// `prune_scan_queue_below`. Returns the number of entries removed or altered.
    pub(crate) fn prune_below(
        &mut self,
        height: BlockHeight,
        retain_with_priority: Option<ScanPriority>,
    ) -> Result<u64, Error> {
        let is_retained = |priority: ScanPriority| {
            retain_with_priority
                .is_some_and(|retain| priority <= ScanPriority::Scanned || priority >= retain)
        };

        let mut existing: Vec<ScanRange> = self
            .ranges()
            .filter(|r| r.block_range().start < height)
            .collect();
        existing.sort_by_key(|r| r.block_range().start);

        let fill_from = existing
            .iter()
            .find(|entry| is_retained(entry.priority()))
            .map(|entry| entry.block_range().start);

        let replacement = existing
            .iter()
            .flat_map(|entry| {
                let range = entry.block_range();
                if is_retained(entry.priority()) {
                    vec![entry.clone()]
                } else {
                    let pruned = ScanRange::from_parts(
                        range.start..min(range.end, height),
                        ScanPriority::Ignored,
                    );
                    let kept = (range.end > height)
                        .then(|| ScanRange::from_parts(height..range.end, entry.priority()));
                    match fill_from {
                        Some(floor) if pruned.block_range().end > floor => {
                            Some(pruned).into_iter().chain(kept).collect()
                        }
                        _ => kept.into_iter().collect(),
                    }
                }
            })
            .fold(Vec::<ScanRange>::new(), |mut acc, entry| {
                match acc.last() {
                    Some(prev)
                        if prev.priority() == entry.priority()
                            && prev.block_range().end == entry.block_range().start =>
                    {
                        let merged = ScanRange::from_parts(
                            prev.block_range().start..entry.block_range().end,
                            prev.priority(),
                        );
                        acc.pop();
                        acc.push(merged);
                    }
                    _ => acc.push(entry),
                }
                acc
            });

        if replacement == existing {
            return Ok(0);
        }

        self.0.retain(|(start, _, _)| *start >= height);
        self.insert_queue_entries(replacement.iter())?;

        Ok(existing
            .iter()
            .filter(|entry| !replacement.contains(entry))
            .count() as u64)
    }

    /// `trim_scan_queue_to`: removes everything above `max_height`.
    pub(crate) fn trim_to(&mut self, max_height: BlockHeight) {
        let new_end = max_height + 1;
        self.0.retain(|(start, _, _)| *start < new_end);
        for (_, end, _) in self.0.iter_mut() {
            if *end > new_end {
                *end = new_end;
            }
        }
    }

    /// Restores a queue from stored entries, checking that they do not overlap.
    pub(crate) fn from_entries(
        entries: impl IntoIterator<Item = ScanRange>,
    ) -> Result<Self, Error> {
        let mut q = ScanQueue::new();
        let entries: Vec<ScanRange> = entries.into_iter().collect();
        q.insert_queue_entries(entries.iter())?;
        Ok(q)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(n: u32) -> BlockHeight {
        BlockHeight::from_u32(n)
    }

    #[test]
    fn replace_merges_and_skips_empty() {
        let mut q = ScanQueue::new();
        q.replace_queue_entries(
            &(h(10)..h(20)),
            Some(ScanRange::from_parts(h(10)..h(20), ScanPriority::Historic)).into_iter(),
            false,
        )
        .unwrap();
        q.replace_queue_entries(
            &(h(12)..h(14)),
            [
                ScanRange::from_parts(h(12)..h(14), ScanPriority::Scanned),
                ScanRange::from_parts(h(14)..h(14), ScanPriority::FoundNote),
            ]
            .into_iter(),
            false,
        )
        .unwrap();
        let ranges: Vec<_> = q.ranges().collect();
        assert_eq!(
            ranges,
            vec![
                ScanRange::from_parts(h(10)..h(12), ScanPriority::Historic),
                ScanRange::from_parts(h(12)..h(14), ScanPriority::Scanned),
                ScanRange::from_parts(h(14)..h(20), ScanPriority::Historic),
            ]
        );
        let suggested = q.suggest_scan_ranges(ScanPriority::Historic);
        assert_eq!(suggested[0].block_range(), &(h(14)..h(20)));
        q.trim_to(h(15));
        assert_eq!(q.ranges().last().unwrap().block_range(), &(h(14)..h(16)));
    }
}
