import { describe, expect, it } from 'vitest';

import { balancesFrom, type RawBalance } from '../../src/engine/webzjs-balances';

// The AccountBalance the vendored webzjs-wallet reports (bindgen/wallet.rs), as get_wallet_summary
// hands it over (serde): every field a number of zatoshis.
const raw = (patch: Partial<RawBalance> = {}): RawBalance => ({
  sapling_balance: 0,
  orchard_balance: 0,
  ironwood_balance: 0,
  unshielded_balance: 0,
  unshielded_pending: 0,
  pending_change: 0,
  pending_spendable: 0,
  locked: 0,
  ...patch,
});

describe('balancesFrom', () => {
  it('reads every pool', () => {
    expect(
      balancesFrom(raw({ sapling_balance: 1, orchard_balance: 20, ironwood_balance: 300, unshielded_balance: 4_000 })),
    ).toEqual({ sapling: 1n, orchard: 20n, ironwood: 300n, transparent: 4_000n, pending: 0n });
  });

  it('counts transparent value that is not spendable yet as pending (review finding R7)', () => {
    // A t-address payment at too few confirmations: not in unshielded_balance, so without
    // unshielded_pending it showed nowhere, and the total was short by it.
    const b = balancesFrom(raw({ unshielded_balance: 50_000, unshielded_pending: 70_000 }));
    expect(b.transparent).toBe(50_000n);
    expect(b.pending).toBe(70_000n);
  });

  it('adds every pending bucket once', () => {
    const b = balancesFrom(raw({ pending_change: 1, pending_spendable: 20, locked: 300, unshielded_pending: 4_000 }));
    expect(b.pending).toBe(4_321n);
  });

  it('refuses a build that does not report the pending transparent value', () => {
    const { unshielded_pending: _, ...old } = raw();
    expect(() => balancesFrom(old as RawBalance)).toThrow(/does not report/);
  });

  it('refuses a build without Ironwood', () => {
    const { ironwood_balance: _, ...old } = raw();
    expect(() => balancesFrom(old as RawBalance)).toThrow(/does not report Ironwood/);
  });

  it('gives zeros for an account the summary does not list yet', () => {
    expect(balancesFrom(undefined)).toEqual({ sapling: 0n, orchard: 0n, ironwood: 0n, transparent: 0n, pending: 0n });
  });
});
