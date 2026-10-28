import { describe, expect, it } from 'vitest';

import type { NetworkStatus } from '../../src/engine/types';
import {
  LAG_BLOCKS,
  branchName,
  canSpend,
  networkView,
  nextCheck,
  unsupportedUpcoming,
  upgradeName,
} from '../../src/lib/network';

const SUPPORTED: NetworkStatus = { branchId: '4dec4df0', height: 3_300_000, supported: true };
const IRONWOOD: NetworkStatus = {
  branchId: '37a5165b',
  height: 3_533_505,
  supported: false,
  behind: 'engine',
  lacks: ['NU6.2', 'NU6.3'],
};
const OLD_SERVER: NetworkStatus = { branchId: 'c2d6d0b4', height: 3_300_000, supported: false, behind: 'server' };

describe('network view', () => {
  it('allows spending only after a successful check that says supported', () => {
    expect(networkView({ status: null, error: null })).toEqual({ kind: 'checking' });
    expect(networkView({ status: SUPPORTED, error: null })).toEqual({ kind: 'supported' });
    expect(networkView({ status: IRONWOOD, error: null })).toEqual({ kind: 'outdated', upgrade: 'NU6.2, NU6.3 (Ironwood)' });
    expect(canSpend({ status: null, error: null })).toBe(false);
    expect(canSpend({ status: SUPPORTED, error: null })).toBe(true);
    expect(canSpend({ status: IRONWOOD, error: null })).toBe(false);
  });

  it('fails closed when the server stops answering', () => {
    expect(networkView({ status: null, error: 'timeout' })).toEqual({ kind: 'unverified' });
    expect(networkView({ status: SUPPORTED, error: 'timeout' })).toEqual({ kind: 'unverified' });
    expect(canSpend({ status: SUPPORTED, error: 'timeout' })).toBe(false);
    // The network does not go back to older rules: still outdated.
    expect(networkView({ status: IRONWOOD, error: 'timeout' }).kind).toBe('outdated');
  });

  it('names branch ids, falling back to the raw hex', () => {
    expect(branchName('37a5165b')).toBe('NU6.3 (Ironwood)');
    expect(branchName('77190ad9')).toBe('NU7');
    expect(branchName('5437f330')).toBe('NU6.2');
    expect(branchName('4dec4df0')).toBe('NU6.1');
    expect(branchName('0badc0de')).toBe('0x0badc0de');
    expect(networkView({ status: { ...IRONWOOD, branchId: '0badc0de', lacks: undefined }, error: null })).toEqual({
      kind: 'outdated',
      upgrade: '0x0badc0de',
    });
  });

  it('names announced upgrades, but shows no sentence a server made up', () => {
    expect(upgradeName('NU7')).toBe('NU7');
    expect(upgradeName('nu6.3')).toBe('NU6.3 (Ironwood)');
    expect(upgradeName('Ironwood')).toBe('NU6.3 (Ironwood)');
    expect(upgradeName('NU8')).toBe('NU8');
    expect(upgradeName('Update now at evil.example!')).toBeNull();
    expect(upgradeName('')).toBeNull();
  });

  it('warns about an announced upgrade only when the engine will not support it', () => {
    const nu7 = { name: 'NU7', height: 3_543_405 };
    expect(unsupportedUpcoming({ status: { ...IRONWOOD, upcoming: { ...nu7, supported: false } }, error: null })).toEqual(nu7);
    expect(unsupportedUpcoming({ status: { ...SUPPORTED, upcoming: { ...nu7, supported: false } }, error: null })).toEqual(nu7);
    expect(unsupportedUpcoming({ status: { ...SUPPORTED, upcoming: { ...nu7, supported: true } }, error: null })).toBeNull();
    expect(unsupportedUpcoming({ status: SUPPORTED, error: null })).toBeNull();
    expect(unsupportedUpcoming({ status: null, error: 'timeout' })).toBeNull();
  });

  it('names what the engine lacks, or else the branch the server reports', () => {
    // A server that missed upgrades reports NU6.1, but the engine lacks NU6.2 and NU6.3.
    expect(networkView({ status: { ...IRONWOOD, branchId: '4dec4df0' }, error: null })).toEqual({
      kind: 'outdated',
      upgrade: 'NU6.2, NU6.3 (Ironwood)',
    });
    expect(networkView({ status: { ...IRONWOOD, lacks: ['NU6.2', 'NU6.3', 'NU7'] }, error: null })).toMatchObject({
      upgrade: 'NU6.2, NU6.3 (Ironwood), NU7',
    });
    // A name no upgrade has is left out; with none left, the reported branch names it.
    expect(networkView({ status: { ...IRONWOOD, lacks: ['NU7', 'Update at evil.example!'] }, error: null })).toMatchObject({
      upgrade: 'NU7',
    });
    expect(networkView({ status: { ...IRONWOOD, lacks: ['Update at evil.example!'] }, error: null })).toMatchObject({
      upgrade: 'NU6.3 (Ironwood)',
    });
    // An engine that only says "not supported" is outdated too.
    expect(networkView({ status: { branchId: '37a5165b', height: 1, supported: false }, error: null }).kind).toBe(
      'outdated',
    );
  });

  it('tells a server behind the network apart from an engine behind it', () => {
    expect(networkView({ status: OLD_SERVER, error: null })).toEqual({ kind: 'serverBehind' });
    expect(canSpend({ status: OLD_SERVER, error: null })).toBe(false);
    // Another server may be fine, so a failed check after it is only unverified.
    expect(networkView({ status: OLD_SERVER, error: 'timeout' })).toEqual({ kind: 'unverified' });
  });
});

describe('network check over time', () => {
  const fresh = { status: null, error: null };

  it('keeps the engine outdated for good: a later "supported" is a lagging server', () => {
    const outdated = nextCheck(fresh, IRONWOOD, 0);
    expect(networkView(outdated).kind).toBe('outdated');
    const after = nextCheck(outdated, { ...SUPPORTED, height: 3_533_600 }, 3_533_505);
    expect(after).toEqual({ status: IRONWOOD, error: null });
    expect(canSpend(after)).toBe(false);
    expect(networkView(nextCheck(outdated, OLD_SERVER, 0)).kind).toBe('outdated');
    // A newer answer that is outdated too replaces it.
    const later = { ...IRONWOOD, height: 3_533_600 };
    expect(nextCheck(outdated, later, 0).status).toBe(later);
  });

  it('does not let a server well under a tip already seen vouch for the network', () => {
    const tip = SUPPORTED.height + LAG_BLOCKS + 1;
    const lagging = nextCheck(fresh, SUPPORTED, tip);
    expect(lagging.status).toMatchObject({ supported: false, behind: 'server' });
    expect(networkView(lagging)).toEqual({ kind: 'serverBehind' });
    expect(canSpend(nextCheck(fresh, SUPPORTED, tip - 1))).toBe(true);
    // A server back at the tip turns spending on again.
    expect(canSpend(nextCheck(lagging, { ...SUPPORTED, height: tip }, tip))).toBe(true);
  });

  it('clears an earlier error with a fresh answer', () => {
    expect(nextCheck({ status: SUPPORTED, error: 'timeout' }, SUPPORTED, 0)).toEqual({ status: SUPPORTED, error: null });
  });
});

