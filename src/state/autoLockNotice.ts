// Locking reloads the page (see controller.lock), so the reason for an
// auto-lock is carried across that reload in sessionStorage. It holds only
// the reason and the configured number of minutes, nothing about the wallet.

import { useState } from 'react';

import type { AutoLockReason } from '../lib/autoLock';

const KEY = 'celari.autoLocked';

/** Records why the wallet is about to lock itself. */
export function markAutoLocked(reason: AutoLockReason): void {
  try {
    sessionStorage.setItem(KEY, reason.kind === 'hidden' ? 'hidden' : String(reason.minutes));
  } catch {
    // Storage blocked: the wallet still locks, just without the notice.
  }
}

/** Forgets the reason once the wallet is unlocked, so a later lock by hand shows none. */
export function clearAutoLocked(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

function read(): AutoLockReason | null {
  const value = sessionStorage.getItem(KEY);
  if (value === 'hidden') return { kind: 'hidden' };
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes > 0 ? { kind: 'idle', minutes } : null;
}

/**
 * Why the wallet locked itself, or null; read once. It is kept until the
 * wallet is unlocked rather than cleared on reading: the lock screen can show
 * before the page reloads (a soft lock, see controller.lock) and again after.
 */
export function useAutoLockReason(): AutoLockReason | null {
  const [reason] = useState(() => {
    try {
      return read();
    } catch {
      return null;
    }
  });
  return reason;
}
