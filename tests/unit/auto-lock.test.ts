import { describe, expect, it } from 'vitest';

import { HIDDEN_LOCK_MS, dueAutoLock } from '../../src/lib/autoLock';

const MIN = 60_000;
const T = 1_800_000_000_000;

describe('dueAutoLock', () => {
  it('waits out the inactivity limit while the tab is visible', () => {
    const clock = { lastActivity: T, minutes: 15, hiddenSince: null };
    expect(dueAutoLock({ ...clock, now: T + 15 * MIN - 1 })).toBeNull();
    expect(dueAutoLock({ ...clock, now: T + 15 * MIN })).toEqual({ kind: 'idle', minutes: 15 });
  });

  it('locks a tab that has been in the background for a minute', () => {
    const clock = { lastActivity: T, minutes: 15, hiddenSince: T + 5 * MIN };
    expect(dueAutoLock({ ...clock, now: T + 5 * MIN + HIDDEN_LOCK_MS - 1 })).toBeNull();
    expect(dueAutoLock({ ...clock, now: T + 5 * MIN + HIDDEN_LOCK_MS })).toEqual({ kind: 'hidden' });
  });

  it('after a long sleep, names the limit that passed first', () => {
    // Hidden right after the last input: the background minute ran out first.
    expect(dueAutoLock({ now: T + 8 * 60 * MIN, lastActivity: T, minutes: 15, hiddenSince: T })).toEqual({
      kind: 'hidden',
    });
    // Idle on screen for 14.5 minutes, then hidden: inactivity ran out first.
    const hiddenSince = T + 14.5 * MIN;
    expect(dueAutoLock({ now: T + 8 * 60 * MIN, lastActivity: T, minutes: 15, hiddenSince })).toEqual({
      kind: 'idle',
      minutes: 15,
    });
  });
});
