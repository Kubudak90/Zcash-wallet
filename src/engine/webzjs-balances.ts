// How the WebZjs adapter (./webzjs.ts) reads an account's balances. Kept apart
// from the adapter, which loads the wasm packages, so the rules can be unit-tested.

import type { Balances } from './types';

/** One entry of WalletSummary.account_balances, in zatoshis (webzjs-wallet's AccountBalance). */
export interface RawBalance {
  sapling_balance: number;
  orchard_balance: number;
  /** Spendable value in the NU6.3 Ironwood pool. */
  ironwood_balance: number;
  unshielded_balance: number;
  /**
   * Transparent value not yet spendable (too few confirmations); not in
   * unshielded_balance, nor in pending_change / pending_spendable, which cover the
   * shielded pools (review finding R7).
   */
  unshielded_pending: number;
  pending_change: number;
  pending_spendable: number;
  /** Value reserved for a transaction being built (advisory input locks); not in any *_balance. */
  locked: number;
}

/**
 * The balances of one account; `b` is undefined for an account the summary does
 * not list yet. A vendor/ built from an engine without Ironwood, or without the
 * pending transparent value, would show too low a balance without saying so, so a
 * balance without those fields is refused.
 */
export function balancesFrom(b: RawBalance | undefined): Balances {
  if (b && (typeof b.ironwood_balance !== 'number' || typeof b.locked !== 'number')) {
    throw new Error('this WebZjs build does not report Ironwood balances');
  }
  if (b && typeof b.unshielded_pending !== 'number') {
    throw new Error('this WebZjs build does not report pending transparent value');
  }
  const zats = (v: number | undefined) => BigInt(v ?? 0);
  return {
    orchard: zats(b?.orchard_balance),
    sapling: zats(b?.sapling_balance),
    ironwood: zats(b?.ironwood_balance),
    transparent: zats(b?.unshielded_balance),
    pending:
      zats(b?.pending_change) + zats(b?.pending_spendable) + zats(b?.unshielded_pending) + zats(b?.locked),
  };
}
