// Which older shielded pool a payment to an Orchard receiver may be paid from (review
// round 7, ES-2). WebZjs pays an Orchard receiver through Ironwood and proposes with every
// shielded pool allowed (SpendPolicy::default()). zcash_client_backend 0.25 tries the
// pools in the order Ironwood, Orchard, Sapling and spends the first one that covers the
// payment and its fee alone (input_selection.rs), with the change in Ironwood. So:
// - Ironwood covers it: nothing crosses pools, the payment is fully shielded;
// - else Orchard covers it: the value leaving Orchard crosses the ZIP 318 turnstile into
//   Ironwood, publicly (the amount of the payment can be read from it);
// - else Sapling (alone or with the others): the whole value of the Sapling notes it
//   spends shows in Sapling's value balance, since no change returns to Sapling.
// Measured natively on the ported engine (verify_es2_sapling_crossing): a wallet with
// 1 ZEC in Sapling and 0.3 in Ironwood paying 0.5 made the whole 1 ZEC public.

import type { Balances } from '../engine';

/**
 * The fee assumed when telling which pool covers a payment. Celari's change splitting makes
 * real fees 20,000-35,000 zats, more with many notes (review round 7, SPEND-3, ES-4), so the
 * bound is high on purpose: near a pool's balance a payment rather reads as crossing pools
 * once too often than not at all.
 */
export const CROSSING_FEE_BOUND_ZATS = 50_000n;

export type OlderPool = 'orchard' | 'sapling';

/**
 * The older pool a shielded payment of `zats` to an Orchard receiver may spend notes from, or
 * null when the pool new funds are in covers it alone (Ironwood; Orchard for an engine without
 * Ironwood, for which Orchard is not an older pool).
 */
export function olderPoolSpent(
  b: Pick<Balances, 'ironwood' | 'orchard' | 'sapling'>,
  zats: bigint,
  ironwood: boolean,
): OlderPool | null {
  const needed = zats + CROSSING_FEE_BOUND_ZATS;
  if ((ironwood ? b.ironwood : b.orchard) >= needed) return null;
  // Orchard alone, or Ironwood and Orchard together when there is no Sapling to reach for.
  if (ironwood && b.orchard > 0n && (b.orchard >= needed || b.sapling === 0n)) return 'orchard';
  return b.sapling > 0n ? 'sapling' : null;
}
