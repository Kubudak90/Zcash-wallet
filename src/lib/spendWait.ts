// When a spend has to wait for the sync. WebZjs holds its database for a whole
// pass, so a spend started during one sits on "building" until the pass ends,
// and pczt_create runs a catch-up sync of its own, on the main thread, when
// the wallet is more than a few blocks behind.

import type { Lang, Translate } from '../i18n';
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

/** What the confirm screen says while a spend has to wait; null when it need not. */
export function spendWaitText(wait: SpendWait | null, t: Translate, lang: Lang): string | null {
  const blocks = (n: number) => n.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US');
  switch (wait?.kind) {
    case 'syncing':
      // The last pass counts down to one block (final review V2-3).
      return wait.blocksLeft === 1 ? t('send.waitForSyncOne') : t('send.waitForSync', { blocks: blocks(wait.blocksLeft) });
    case 'behind':
      // More than CATCH_UP_BLOCKS behind, so never one block.
      return t('send.waitForRetry', { blocks: blocks(wait.blocksLeft) });
    case 'connecting':
      return t('send.waitForConnect');
    default:
      return null;
  }
}
