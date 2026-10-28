import { describe, expect, it } from 'vitest';

import { spendWait } from '../../src/lib/spendWait';
import { CATCH_UP_BLOCKS, syncView, type SyncInfo } from '../../src/lib/syncView';

const BIRTHDAY = 2_900_000;
const TIP = 3_100_000;

const sync = (patch: Partial<SyncInfo>): SyncInfo => ({
  status: 'idle',
  error: null,
  catchUp: null,
  networkTip: TIP,
  progress: null,
  ...patch,
});

/** What the confirm screen sees for this sync state and summary. */
const waitFor = (s: SyncInfo, summary: { scannedHeight: number; tipHeight: number } | null) =>
  spendWait(syncView(s, summary, BIRTHDAY), s, summary);

describe('spendWait', () => {
  it('lets an up-to-date wallet spend', () => {
    expect(waitFor(sync({}), { scannedHeight: TIP, tipHeight: TIP })).toBeNull();
  });

  it('waits while syncing or connecting', () => {
    const catchUp = { from: BIRTHDAY, to: TIP };
    expect(waitFor(sync({ status: 'syncing', catchUp }), { scannedHeight: BIRTHDAY, tipHeight: BIRTHDAY })).toEqual({
      kind: 'syncing',
      blocksLeft: TIP - BIRTHDAY,
    });
    expect(waitFor(sync({ status: 'starting', networkTip: null }), null)).toEqual({ kind: 'connecting' });
  });

  it('keeps waiting when a pass fails far behind the measured tip', () => {
    // The pill says "Connection problem", but the gap the last reading measured still stands.
    const failed = sync({ status: 'error', error: 'stream reset' });
    expect(waitFor(failed, { scannedHeight: 2_900_000, tipHeight: 2_900_000 })).toEqual({
      kind: 'behind',
      blocksLeft: 200_000,
    });
    // The wallet's own record of the tip counts too, when no reading came through.
    expect(waitFor(sync({ status: 'error', error: 'x', networkTip: null }), { scannedHeight: TIP - 50, tipHeight: TIP })).toEqual({
      kind: 'behind',
      blocksLeft: 50,
    });
  });

  it('does not hold an error back when the wallet is near the tip', () => {
    const failed = sync({ status: 'error', error: 'stream reset' });
    expect(waitFor(failed, { scannedHeight: TIP - CATCH_UP_BLOCKS, tipHeight: TIP })).toBeNull();
    expect(waitFor(sync({ status: 'error', error: 'x', networkTip: null }), null)).toBeNull();
  });
});
