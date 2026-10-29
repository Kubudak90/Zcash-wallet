import { describe, expect, it } from 'vitest';

import { grandTotal, shieldedTotal, type Balances } from '../../src/engine/types';

const zero: Balances = { orchard: 0n, sapling: 0n, ironwood: 0n, transparent: 0n, pending: 0n };

describe('balance totals', () => {
  it('counts Sapling, Orchard and Ironwood as shielded', () => {
    const b = { ...zero, sapling: 1n, orchard: 20n, ironwood: 300n };
    expect(shieldedTotal(b)).toBe(321n);
  });

  it('counts every pool and pending value in the total, Ironwood included', () => {
    const b = { orchard: 1n, sapling: 20n, ironwood: 300n, transparent: 4_000n, pending: 50_000n };
    expect(grandTotal(b)).toBe(54_321n);
    // Ironwood alone, where new shielded value lands after NU6.3.
    expect(grandTotal({ ...zero, ironwood: 125_000_000n })).toBe(125_000_000n);
  });
});
