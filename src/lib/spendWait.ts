// When a spend has to wait for the sync. WebZjs holds its database for a whole
// pass, so a spend started during one sits on "building" until the pass ends,
// and pczt_create runs a catch-up sync of its own, on the main thread, when
// the wallet is more than a few blocks behind.

import { CATCH_UP_BLOCKS, type SyncInfo, type SyncView } from './syncView';

export type SpendWait =
  | { kind: 'syncing'; blocksLeft: number }
  | { kind: 'connecting' }
  /** The last pass failed while the wallet was known to be this far behind. */
  | { kind: 'behind'; blocksLeft: number };

export function spendWait(
  view: SyncView,
  sync: SyncInfo,
  summary: { scannedHeight: number; tipHeight: number } | null,
): SpendWait | null {
  if (view.kind === 'syncing') return { kind: 'syncing', blocksLeft: view.blocksLeft };
  if (view.kind === 'connecting') return { kind: 'connecting' };
  if (view.kind === 'error' && summary) {
    // A failed pass leaves the gap it measured; the spend would have to close it first.
    const behind = Math.max(summary.tipHeight, sync.networkTip ?? 0) - summary.scannedHeight;
    if (behind > CATCH_UP_BLOCKS) return { kind: 'behind', blocksLeft: behind };
  }
  return null;
}
