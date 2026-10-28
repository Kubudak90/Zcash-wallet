import { describe, expect, it } from 'vitest';

import { CATCH_UP_BLOCKS, catchUpFor, syncView, type SyncInfo } from '../../src/lib/syncView';

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
