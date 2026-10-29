import { describe, expect, it } from 'vitest';

import { translate } from '../../src/i18n';
import { spendWait, spendWaitText } from '../../src/lib/spendWait';
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

describe('spendWaitText', () => {
  it('says one block, not "1 blocks" (final review V2-3), and groups digits per language', () => {
    const en = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('en', key, vars);
    const tr = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('tr', key, vars);
    expect(spendWaitText({ kind: 'syncing', blocksLeft: 1 }, en, 'en')).toBe(
      'The wallet is still syncing (1 block left). You can continue once it is up to date.',
    );
    expect(spendWaitText({ kind: 'syncing', blocksLeft: 1 }, tr, 'tr')).toBe(
      'Cüzdan hâlâ eşitleniyor (1 blok kaldı). Güncel olunca devam edebilirsin.',
    );
    expect(spendWaitText({ kind: 'syncing', blocksLeft: 12_345 }, en, 'en')).toContain('(12,345 blocks left)');
    expect(spendWaitText({ kind: 'behind', blocksLeft: 12_345 }, tr, 'tr')).toContain('12.345 blok geride');
    expect(spendWaitText({ kind: 'connecting' }, en, 'en')).toBe(translate('en', 'send.waitForConnect'));
    expect(spendWaitText(null, en, 'en')).toBeNull();
  });
});
