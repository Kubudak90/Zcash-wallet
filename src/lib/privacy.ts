// How private a History row is, from the pool WebZjs reports for it
// (crates/webzjs-wallet/src/bindgen/transaction_history.rs). WebZjs looks only
// at the wallet's own outputs: notes it received, and what it sent, change
// included. Other inputs and outputs of the transaction are not classified.

export type Privacy = 'shielded' | 'partial' | 'transparent';

const POOLS = new Map<string, Privacy>([
  ['sapling', 'shielded'],
  ['orchard', 'shielded'],
  // The NU6.3 pool, once the engine reports it.
  ['ironwood', 'shielded'],
  // Outputs in more than one pool: some may be transparent, and crossing
  // between shielded pools shows the amount that crossed.
  ['mixed', 'partial'],
  ['transparent', 'transparent'],
]);

/** null for 'unknown' and anything WebZjs may add later: no label rather than a guess. */
export function poolPrivacy(pool: string): Privacy | null {
  return POOLS.get(pool.toLowerCase()) ?? null;
}
