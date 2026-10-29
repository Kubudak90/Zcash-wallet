import { describe, expect, it } from 'vitest';

import {
  CATCH_UP_BLOCKS,
  catchUpFor,
  passBlocksDone,
  queueBlocksLeft,
  syncView,
  type QueueReading,
  type SyncInfo,
} from '../../src/lib/syncView';

// Values observed with the real engine: restore with this month as the start date.
const BIRTHDAY = 3_485_725;
const TIP = 3_533_370;
// Before its first pass WebZjs only knows the birthday: tip = scanned = birthday - 1.
const PRE_SYNC = { scannedHeight: BIRTHDAY - 1, tipHeight: BIRTHDAY - 1 };
const SYNCED = { scannedHeight: TIP, tipHeight: TIP };
const GAP = TIP - (BIRTHDAY - 1);

const sync = (patch: Partial<SyncInfo>): SyncInfo => ({
  status: 'syncing',
  error: null,
  catchUp: null,
  networkTip: TIP,
  progress: null,
  ...patch,
});

describe('catchUpFor', () => {
  it('flags a restore that is tens of thousands of blocks behind', () => {
    expect(catchUpFor(BIRTHDAY - 1, TIP)).toEqual({ from: BIRTHDAY - 1, to: TIP });
  });
  it('ignores the few blocks a steady-state pass sees', () => {
    for (let gap = 0; gap <= CATCH_UP_BLOCKS; gap++) expect(catchUpFor(TIP, TIP + gap)).toBeNull();
    expect(catchUpFor(TIP, TIP + CATCH_UP_BLOCKS + 1)).not.toBeNull();
  });
});

// The summary of a wallet sitting at the start of `catchUp`, as WebZjs reports it mid-pass.
const SYNCED_BEFORE = (c: { from: number }) => ({ scannedHeight: c.from, tipHeight: c.from });

describe('passBlocksDone', () => {
  it('stays below the total and above zero', () => {
    expect(passBlocksDone({ visited: 0, scanned: 0 }, 100)).toBe(0);
    expect(passBlocksDone({ visited: 60, scanned: 20 }, 100)).toBe(40);
    expect(passBlocksDone({ visited: 500, scanned: 500 }, 100)).toBe(99);
    // An engine whose counters lag behind each other is read as the committed count.
    expect(passBlocksDone({ visited: 0, scanned: 30 }, 100)).toBe(30);
  });
});

describe('syncView', () => {
  const catchUp = { from: BIRTHDAY - 1, to: TIP };

  it('does not call a stale pre-sync summary "up to date"', () => {
    // The bug: syncProgress(birthday, birthday-1, birthday-1) is 1, so the old pill said "Up to date".
    expect(syncView(sync({ catchUp: catchUpFor(PRE_SYNC.scannedHeight, TIP) }), PRE_SYNC, BIRTHDAY)).toEqual({
      kind: 'syncing',
      blocksLeft: GAP,
      pct: null,
    });
  });

  it('keeps the gap measured at the start while the engine reports no progress', () => {
    expect(syncView(sync({ catchUp }), null, BIRTHDAY)).toEqual({ kind: 'syncing', blocksLeft: GAP, pct: null });
  });

  it('shows a percentage and counts down from the scanned height once an engine reports progress', () => {
    const quarter = { scannedHeight: BIRTHDAY - 1 + Math.round(GAP / 4), tipHeight: TIP };
    expect(syncView(sync({ catchUp }), quarter, BIRTHDAY)).toEqual({
      kind: 'syncing',
      blocksLeft: TIP - quarter.scannedHeight,
      pct: 25,
    });
  });

  describe("with the engine's pass counters (WebZjs sync_progress)", () => {
    // The summary waits for the pass, so it still shows the pre-pass heights.
    const counting = (visited: number, scanned: number) =>
      syncView(sync({ catchUp, progress: { visited, scanned } }), PRE_SYNC, BIRTHDAY);

    it('shows 0% as soon as the counters answer, before any block is scanned', () => {
      expect(counting(0, 0)).toEqual({ kind: 'syncing', blocksLeft: GAP, pct: 0 });
    });

    it('counts a block half once reached and fully once its batch is committed', () => {
      // First batch reached, nothing committed yet.
      expect(counting(10_000, 0)).toEqual({ kind: 'syncing', blocksLeft: GAP - 5_000, pct: Math.floor((5_000 / GAP) * 100) });
      // First batch committed (the second one is being downloaded).
      expect(counting(10_000, 10_000)).toEqual({
        kind: 'syncing',
        blocksLeft: GAP - 10_000,
        pct: Math.floor((10_000 / GAP) * 100),
      });
    });

    it('never says 100% or "0 blocks left" before the pass ends', () => {
      // Every block reached and committed, or more: the pass can also scan blocks mined meanwhile.
      for (const n of [GAP, GAP + 25]) {
        expect(counting(n, n)).toEqual({ kind: 'syncing', blocksLeft: 1, pct: 99 });
      }
      // A short catch-up, where a single block is more than 1% of the pass.
      const short = { from: TIP - 20, to: TIP };
      const view = syncView(sync({ catchUp: short, progress: { visited: 20, scanned: 20 } }), SYNCED_BEFORE(short), BIRTHDAY);
      expect(view).toEqual({ kind: 'syncing', blocksLeft: 1, pct: 95 });
    });

    it('moves only forward as the counters do', () => {
      let last = { blocksLeft: Infinity, pct: -1 };
      for (let visited = 0; visited <= GAP; visited += 2_000) {
        const scanned = Math.max(0, visited - 10_000);
        const view = counting(visited, scanned);
        if (view.kind !== 'syncing' || view.pct === null) throw new Error(`unexpected ${JSON.stringify(view)}`);
        expect(view.blocksLeft).toBeLessThanOrEqual(last.blocksLeft);
        expect(view.pct).toBeGreaterThanOrEqual(last.pct);
        expect(view.pct).toBeLessThanOrEqual(99);
        last = { blocksLeft: view.blocksLeft, pct: view.pct };
      }
    });

    it('prefers the summary when it is further along than the counters', () => {
      const quarter = { scannedHeight: BIRTHDAY - 1 + Math.round(GAP / 4), tipHeight: TIP };
      expect(syncView(sync({ catchUp, progress: { visited: 0, scanned: 0 } }), quarter, BIRTHDAY)).toEqual({
        kind: 'syncing',
        blocksLeft: TIP - quarter.scannedHeight,
        pct: 25,
      });
    });

    it('is "up to date" once the summary reaches the target, whatever the counters said', () => {
      expect(syncView(sync({ catchUp, progress: { visited: 100, scanned: 0 } }), SYNCED, BIRTHDAY)).toEqual({
        kind: 'upToDate',
        height: TIP,
      });
    });
  });

  it('is "up to date" once the pass reaches its target, before the save ends', () => {
    expect(syncView(sync({ catchUp }), SYNCED, BIRTHDAY)).toEqual({ kind: 'upToDate', height: TIP });
  });

  it('treats a pass that stops a block short of the measured tip as done', () => {
    // Servers behind one lightwalletd URL can be a block apart.
    const short = { scannedHeight: TIP - 1, tipHeight: TIP - 1 };
    expect(syncView(sync({ catchUp }), short, BIRTHDAY)).toEqual({ kind: 'upToDate', height: TIP });
  });

  it('shows the network tip, not the scanned height', () => {
    const atTip = sync({ status: 'idle', networkTip: TIP + 3 });
    expect(syncView(atTip, SYNCED, BIRTHDAY)).toEqual({ kind: 'upToDate', height: TIP + 3 });
    // The wallet's own record of the tip wins when it is newer than the last reading.
    const newer = { scannedHeight: TIP + 5, tipHeight: TIP + 5 };
    expect(syncView(atTip, newer, BIRTHDAY)).toEqual({ kind: 'upToDate', height: TIP + 5 });
  });

  it("falls back to the summary's tip when no network tip was read", () => {
    expect(syncView(sync({ status: 'idle', networkTip: null }), SYNCED, BIRTHDAY)).toEqual({
      kind: 'upToDate',
      height: TIP,
    });
  });

  it('stays "up to date" during a steady-state pass', () => {
    const steady = sync({ catchUp: catchUpFor(TIP, TIP + 2), networkTip: TIP + 2 });
    expect(syncView(steady, SYNCED, BIRTHDAY)).toEqual({ kind: 'upToDate', height: TIP + 2 });
  });

  it('shows a wallet that the summary itself says is far behind as syncing', () => {
    const behind = { scannedHeight: TIP - 1000, tipHeight: TIP };
    expect(syncView(sync({ networkTip: null }), behind, BIRTHDAY)).toEqual({
      kind: 'syncing',
      blocksLeft: 1000,
      pct: Math.floor(((TIP - 1000 - BIRTHDAY) / (TIP - BIRTHDAY)) * 100),
    });
  });

  it('says "connecting" before the first pass has measured the gap', () => {
    expect(syncView(sync({ status: 'starting', networkTip: null }), PRE_SYNC, BIRTHDAY)).toEqual({
      kind: 'connecting',
    });
    expect(syncView(sync({ status: 'starting', networkTip: null }), SYNCED, BIRTHDAY)).toEqual({
      kind: 'connecting',
    });
  });

  it('is never "up to date" before a first pass ends, even if the tip read failed', () => {
    expect(syncView(sync({ networkTip: null }), PRE_SYNC, BIRTHDAY)).toEqual({ kind: 'connecting' });
    // An existing wallet whose first pass could not reach the server yet.
    expect(syncView(sync({ networkTip: null }), SYNCED, BIRTHDAY)).toEqual({ kind: 'connecting' });
  });

  it('reports errors over everything else, also through a retry that cannot reach the server', () => {
    expect(syncView(sync({ status: 'error', error: 'offline' }), SYNCED, BIRTHDAY)).toEqual({ kind: 'error' });
    expect(syncView(sync({ error: 'offline', catchUp }), PRE_SYNC, BIRTHDAY)).toEqual({ kind: 'error' });
  });
});

describe("with the engine's scan queue (WebZjs round 6: unscanned_blocks, wallet_tip, unscanned_visited)", () => {
  // The final review's mainnet restore (E2E-1): the engine scans the newest ranges first, so
  // the fully scanned height stays at the birthday - 1 for most of the restore, across passes.
  const catchUp = { from: BIRTHDAY - 1, to: TIP };
  const queue = (unscanned: number, visited = 0, visitedAtReport = visited, walletTip = TIP): QueueReading => ({
    unscanned,
    walletTip,
    visitedAtReport,
    visited,
  });
  const view = (q: QueueReading, patch: Partial<SyncInfo> = {}) =>
    syncView(sync({ catchUp, queue: q, ...patch }), PRE_SYNC, BIRTHDAY);

  it('counts the queued blocks, the blocks the running batch reached, and those above the wallet tip once each', () => {
    expect(queueBlocksLeft(queue(30_000), TIP)).toBe(30_000);
    // 4,000 blocks of the running batch reached since the queue was reported.
    expect(queueBlocksLeft(queue(30_000, 14_000, 10_000), TIP)).toBe(26_000);
    // The batch committed: the queue shrank by it and the report caught up with `visited`.
    expect(queueBlocksLeft(queue(20_000, 20_000, 20_000), TIP)).toBe(20_000);
    // 5 blocks mined above the tip the wallet knows.
    expect(queueBlocksLeft(queue(20_000, 0, 0, TIP - 5), TIP)).toBe(20_005);
    // A new pass's counters start at 0 while the last report is from the pass before.
    expect(queueBlocksLeft(queue(20_000, 0, 20_000), TIP)).toBe(20_000);
    // Before a restored account's first pass: nothing queued, the wallet knows only birthday - 1.
    expect(queueBlocksLeft(queue(0, 0, 0, BIRTHDAY - 1), TIP)).toBe(GAP);
  });

  it('counts down across top-down passes while the fully scanned height stays put', () => {
    // A restore in passes of 4 batches of 2,500 blocks; the controller reads the counters every
    // 500 blocks of scanning and keeps the last reading between passes (catchUp set, progress null).
    const batch = 2_500;
    const labels: number[] = [];
    const left = (v: ReturnType<typeof view>) => {
      if (v.kind !== 'syncing') throw new Error(`unexpected ${JSON.stringify(v)}`);
      return v.blocksLeft;
    };
    let unscanned = GAP;
    while (unscanned > batch) {
      let visited = 0;
      let reported = 0;
      for (let b = 0; b < 4 && unscanned > batch; b++) {
        for (let step = 500; step <= batch; step += 500) labels.push(left(view(queue(unscanned, visited + step, reported))));
        visited += batch;
        reported = visited;
        unscanned -= batch;
        labels.push(left(view(queue(unscanned, visited, reported))));
      }
      // Between this pass and the next one.
      labels.push(left(view(queue(unscanned, visited, reported))));
      labels.push(left(view(queue(unscanned, 0, reported))));
    }
    expect(labels[0]).toBe(GAP - 500);
    for (let i = 1; i < labels.length; i++) expect(labels[i]!).toBeLessThanOrEqual(labels[i - 1]!);
    expect(labels.at(-1)!).toBeLessThanOrEqual(batch);
  });

  it('never rises by more than the tip grows, and ends near zero, not at the fully scanned gap', () => {
    // The before: from the fully scanned height every pass showed the whole range again.
    const old = syncView(sync({ catchUp }), PRE_SYNC, BIRTHDAY);
    expect(old).toEqual({ kind: 'syncing', blocksLeft: GAP, pct: null });
    // The queue: one batch of 1,250 left, 3 blocks mined since the pass started.
    const late = syncView(sync({ catchUp: { from: BIRTHDAY - 1, to: TIP + 3 }, networkTip: TIP + 3, queue: queue(1_250) }), PRE_SYNC, BIRTHDAY);
    expect(late).toEqual({ kind: 'syncing', blocksLeft: 1_253, pct: Math.floor(((GAP + 3 - 1_253) / (GAP + 3)) * 100) });
    // The running batch reached every block: still at least 1 until the pass says it is over.
    expect(view(queue(1_250, 5_000, 3_750))).toEqual({ kind: 'syncing', blocksLeft: 1, pct: 99 });
  });

  it('shows the share of the range from the birthday that is done', () => {
    expect(view(queue(GAP))).toEqual({ kind: 'syncing', blocksLeft: GAP, pct: 0 });
    expect(view(queue(Math.floor(GAP / 4)))).toEqual({ kind: 'syncing', blocksLeft: Math.floor(GAP / 4), pct: 75 });
    expect(syncView(sync({ catchUp, queue: queue(Math.round(GAP / 4)) }), PRE_SYNC, null)).toEqual({
      kind: 'syncing',
      blocksLeft: Math.round(GAP / 4),
      pct: null,
    });
  });

  it('is up to date once the summary reaches the target, whatever the last queue reading said', () => {
    expect(syncView(sync({ catchUp, queue: queue(10_000) }), SYNCED, BIRTHDAY)).toEqual({ kind: 'upToDate', height: TIP });
  });

  it('counts by the queue when the summary says the wallet is behind outside a catch-up pass', () => {
    // E.g. a pass that ended early and the next has not set its catch-up yet: the fully
    // scanned height lags far behind, the queue knows better (never more than that gap).
    const behind = { scannedHeight: BIRTHDAY - 1, tipHeight: TIP };
    expect(syncView(sync({ queue: queue(5_000) }), behind, BIRTHDAY)).toEqual({
      kind: 'syncing',
      blocksLeft: 5_000,
      pct: Math.floor(((GAP - 5_000) / GAP) * 100),
    });
    expect(syncView(sync({ queue: queue(GAP + 10_000) }), behind, BIRTHDAY)).toMatchObject({ blocksLeft: GAP });
  });
});

describe('a stopped engine', () => {
  it('shows as stopped, not as a connection problem that will retry', () => {
    expect(syncView(sync({ status: 'stopped', error: 'the wallet engine stopped' }), SYNCED, BIRTHDAY)).toEqual({ kind: 'stopped' });
    expect(syncView(sync({ status: 'error', error: 'x' }), SYNCED, BIRTHDAY)).toEqual({ kind: 'error' });
  });
});
