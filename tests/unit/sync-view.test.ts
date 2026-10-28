import { describe, expect, it } from 'vitest';

import { CATCH_UP_BLOCKS, catchUpFor, passBlocksDone, syncView, type SyncInfo } from '../../src/lib/syncView';

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
