// Locking reloads the page (see controller.lock), so the reason for an
// auto-lock is carried across that reload in sessionStorage. It holds only
// the configured number of minutes, nothing about the wallet.

import { useEffect, useState } from 'react';

const KEY = 'celari.autoLocked';

/** Records that the wallet is about to lock itself after `minutes` of inactivity. */
export function markAutoLocked(minutes: number): void {
  try {
    sessionStorage.setItem(KEY, String(minutes));
  } catch {
    // Storage blocked: the wallet still locks, just without the notice.
  }
}

/** The minutes after which the wallet locked itself before this page load, or null. Read once. */
export function useAutoLockedMinutes(): number | null {
  const [minutes] = useState(() => {
    try {
      const n = Number(sessionStorage.getItem(KEY));
      return Number.isInteger(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  });
  // Cleared in an effect rather than while reading, so StrictMode's second render still sees it.
  useEffect(() => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // Nothing to clear.
    }
  }, []);
  return minutes;
}
