// Only one Celari page at a time opens the wallet (review round 7: PLAT-1, VAULT-2,
// SPEND-5). Every page keeps its own in-memory copy of the wallet database and saves it
// over the stored one, so two unlocked pages would overwrite each other's saves, hand out
// the same "never shown" address, and a page that kept a removed wallet's key would write
// its database back over the next wallet's.
//
// A page takes this Web Lock when it opens a wallet (unlock, create, restore), before it
// opens or writes anything, and holds it until it unloads: locking reloads the page, which
// releases it. A page on the lock screen or on onboarding holds nothing, so a forgotten tab
// never stops another from opening the wallet.

export const TAB_LOCK_NAME = 'celari-wallet';

/**
 * How long a request waits for the lock: a page reloaded to lock releases it as it unloads,
 * and the reloaded page asks only once a password is typed, but a slow unload should not
 * read as another tab.
 */
export const TAB_LOCK_WAIT_MS = 1_500;

/** Gives the lock back (before the page unloads: an attempt that failed after taking it). */
export type ReleaseTabLock = () => void;

/**
 * Asks for the lock and holds it until released or the page unloads. Resolves with the
 * release function once granted, null if another page holds it for longer than `waitMs`.
 */
export function holdTabLock(locks: LockManager, waitMs = TAB_LOCK_WAIT_MS): Promise<ReleaseTabLock | null> {
  return new Promise((resolve) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), waitMs);
    locks
      .request(TAB_LOCK_NAME, { signal: abort.signal }, () => {
        clearTimeout(timer);
        // Held until this promise settles: never, unless release() is called.
        return new Promise<void>((release) => resolve(release));
      })
      .catch(() => {
        // Aborted while waiting (another page holds it), or the lock manager refused.
        clearTimeout(timer);
        resolve(null);
      });
  });
}
