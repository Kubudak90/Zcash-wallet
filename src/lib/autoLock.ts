// When the wallet locks itself. Kept pure so the rules (and which reason wins
// after a sleep) can be unit-tested; App's useAutoLock feeds it the clock.

/** A tab that stays in the background this long locks the wallet. */
export const HIDDEN_LOCK_MS = 60_000;

export type AutoLockReason = { kind: 'idle'; minutes: number } | { kind: 'hidden' };

export interface AutoLockClock {
  now: number;
  /** The last user input. */
  lastActivity: number;
  /** The configured inactivity limit. */
  minutes: number;
  /** When the tab went into the background, or null while it is visible. */
  hiddenSince: number | null;
}

/**
 * Why the wallet should lock now, or null. When both limits have passed (a
 * laptop that slept with the tab in the background), the one that passed
 * first is the reason.
 */
export function dueAutoLock({ now, lastActivity, minutes, hiddenSince }: AutoLockClock): AutoLockReason | null {
  const idleAt = lastActivity + minutes * 60_000;
  const hiddenAt = hiddenSince === null ? Infinity : hiddenSince + HIDDEN_LOCK_MS;
  if (now < Math.min(idleAt, hiddenAt)) return null;
  return hiddenAt <= idleAt ? { kind: 'hidden' } : { kind: 'idle', minutes };
}
