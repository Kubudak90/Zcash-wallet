import { describe, expect, it } from 'vitest';

import { olderPoolSpent } from '../../src/lib/poolCrossing';
import { parseZec } from '../../src/lib/zec';

// Review round 7, ES-2: a payment to an Orchard receiver is fully shielded only when Ironwood
// alone covers it. The cases are the verifier's, measured natively through the ported engine's
// Wallet::pczt_create (mainnet parameters, NU6.3): which pools the PCZT spent from.
const z = (zec: string) => (zec === '0' ? 0n : parseZec(zec));
const funds = (sapling: string, orchard: string, ironwood: string) => ({
  sapling: z(sapling),
  orchard: z(orchard),
  ironwood: z(ironwood),
});

describe('olderPoolSpent', () => {
  it('names Sapling when only Sapling covers the payment: its whole note value goes public', () => {
    // Measured: Sapling value balance +1 ZEC for a 0.5 ZEC payment.
    expect(olderPoolSpent(funds('1', '0', '0.3'), z('0.5'), true)).toBe('sapling');
    // Measured: Sapling alone is chosen even though Ironwood and Orchard together would cover it.
    expect(olderPoolSpent(funds('1', '0.3', '0.3'), z('0.5'), true)).toBe('sapling');
    // A restored Sapling-only seed: +1 ZEC public for a 0.01 payment.
    expect(olderPoolSpent(funds('1', '0', '0'), z('0.01'), true)).toBe('sapling');
    // Two notes spent: +0.8 ZEC public.
    expect(olderPoolSpent(funds('0.8', '0', '0.1'), z('0.6'), true)).toBe('sapling');
  });

  it('says nothing crosses when Ironwood alone covers the payment and its fee', () => {
    // Measured: no Sapling bundle for 0.2 ZEC out of 0.3 in Ironwood.
    expect(olderPoolSpent(funds('1', '0', '0.3'), z('0.2'), true)).toBeNull();
    expect(olderPoolSpent(funds('0', '0', '1.25'), z('0.25'), true)).toBeNull();
    expect(olderPoolSpent(funds('0', '0', '0'), 0n, true)).toBeNull();
  });

  it('names Orchard when Orchard covers it: the value crossing the ZIP 318 turnstile is public', () => {
    // Measured (ES-4): Orchard value balance 12,380,678 against an Ironwood output of 12,345,678.
    expect(olderPoolSpent(funds('0', '1', '0'), z('0.12345678'), true)).toBe('orchard');
    // Ironwood and Orchard together, no Sapling to reach for.
    expect(olderPoolSpent(funds('0', '0.3', '0.3'), z('0.5'), true)).toBe('orchard');
  });

  it('rather warns once too often near a pool balance', () => {
    // Measured: Ironwood + Orchard, no Sapling; still a visible crossing, named as Sapling here.
    expect(olderPoolSpent(funds('0.1', '0.3', '0.3'), z('0.5'), true)).toBe('sapling');
    // The fee bound is high: 0.29999 of 0.3 in Ironwood counts as not covered.
    expect(olderPoolSpent(funds('0', '1', '0.3'), z('0.29999'), true)).toBe('orchard');
  });

  it('treats Orchard as the current pool for an engine without Ironwood', () => {
    expect(olderPoolSpent(funds('0', '1', '0'), z('0.5'), false)).toBeNull();
    expect(olderPoolSpent(funds('1', '0.3', '0'), z('0.5'), false)).toBe('sapling');
  });
});
