// What the sync indicator shows, derived from the controller's sync state and
// the wallet summary. Kept pure so its rules (and the "no flicker" guarantee)
// can be unit-tested.

import { syncProgress } from './birthday';

/**
 * A wallet more than this many blocks behind the network tip is shown as
 * syncing. Steady-state passes (every 30 s; a block every ~75 s, ~25 s from
 * NU7 on) start 0–3 blocks behind and keep showing "up to date".
 */
export const CATCH_UP_BLOCKS = 10;

export type SyncStatus = 'starting' | 'syncing' | 'idle' | 'error';

/** Heights read just before a pass, while the engine could still answer. */
export interface CatchUp {
  /** The wallet's fully scanned height. */
  from: number;
  /** The network tip (lightwalletd GetLatestBlock). */
  to: number;
}

export interface SyncInfo {
  status: SyncStatus;
  /** The last pass's error; it stands through a retry until the server answers again. */
  error: string | null;
  /**
   * Set while a pass that started far behind the network runs. WebZjs keeps
   * its database locked for the whole pass, so the summary cannot say this
   * until the pass ends; the heights are read just before it starts.
   */
  catchUp: CatchUp | null;
  /** The highest network tip read so far, kept across passes. */
  networkTip: number | null;
  /**
   * The engine's counters for the running catch-up pass (ZcashEngine.syncProgress),
   * in blocks of that pass; null when the engine has none or no pass is watched.
   */
  progress: PassProgress | null;
}

export interface PassProgress {
  /** Blocks the scanner has reached. */
  visited: number;
  /** Blocks whose batch is committed to the wallet database. */
  scanned: number;
}

export type SyncView =
  | { kind: 'connecting' }
  | { kind: 'error' }
  // `pct` is null while the engine reports no progress mid-pass.
  | { kind: 'syncing'; blocksLeft: number; pct: number | null }
  | { kind: 'upToDate'; height: number };

export function catchUpFor(scannedHeight: number, networkTip: number): CatchUp | null {
  return networkTip - scannedHeight > CATCH_UP_BLOCKS ? { from: scannedHeight, to: networkTip } : null;
}

const percent = (from: number, scanned: number, to: number) => Math.floor(syncProgress(from, scanned, to) * 100);

/**
 * Blocks of a `total`-block pass that the engine's counters say are done.
 * WebZjs scans in batches of up to 10,000 blocks: it walks a batch (trial
 * decryption), then commits it, which takes at least as long, and only the
 * next batch's download shows that the commit is over. A block therefore
 * counts half once the scanner has reached it and fully once its batch is
 * committed. The count stays below `total` (a pass can also scan blocks mined
 * after the gap was measured): only the end of the pass says it is over.
 */
export function passBlocksDone(progress: PassProgress, total: number): number {
  const done = Math.floor((progress.scanned + Math.max(progress.visited, progress.scanned)) / 2);
  return Math.max(0, Math.min(total - 1, done));
}

export function syncView(
  sync: SyncInfo,
  summary: { scannedHeight: number; tipHeight: number } | null,
  birthday: number | null,
): SyncView {
  if (sync.status === 'error' || sync.error !== null) return { kind: 'error' };

  if (sync.catchUp) {
    const { from, to } = sync.catchUp;
    const scanned = summary?.scannedHeight ?? from;
    // Within reach of the target the pass is done scanning, even while the
    // wallet is still being saved; lightwalletd servers can be a block apart.
    if (scanned <= from || to - scanned > CATCH_UP_BLOCKS) {
      // WebZjs answers no summary until the pass ends, so its summary stays
      // at `from`; its pass counters move instead.
      const counted = sync.progress ? passBlocksDone(sync.progress, to - from) : null;
      if (counted !== null && from + counted >= scanned) {
        return { kind: 'syncing', blocksLeft: to - from - counted, pct: Math.min(99, percent(from, from + counted, to)) };
      }
      if (scanned <= from) return { kind: 'syncing', blocksLeft: to - from, pct: null };
      return { kind: 'syncing', blocksLeft: to - scanned, pct: percent(from, scanned, to) };
    }
  }
  if (!summary) return { kind: 'connecting' };

  // The wallet's own record of the tip can be newer than the last reading.
  const tip = Math.max(summary.tipHeight, sync.networkTip ?? 0);
  const behind = tip - summary.scannedHeight;
  if (behind > CATCH_UP_BLOCKS) {
    const pct = birthday === null ? null : percent(birthday, summary.scannedHeight, tip);
    return { kind: 'syncing', blocksLeft: behind, pct };
  }
  // Below the birthday no pass has finished yet (WebZjs reports birthday - 1).
  if (birthday !== null && summary.scannedHeight < birthday) return { kind: 'connecting' };
  // "Up to date" needs word from the network: a finished pass, or a tip read for this one.
  if (sync.status === 'idle' || (sync.status === 'syncing' && sync.networkTip !== null)) {
    return { kind: 'upToDate', height: tip };
  }
  return { kind: 'connecting' };
}
