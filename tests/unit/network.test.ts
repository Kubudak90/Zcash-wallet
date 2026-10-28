import { describe, expect, it } from 'vitest';

import type { NetworkStatus } from '../../src/engine/types';
import { branchName, canSpend, networkView, unsupportedUpcoming, upgradeName } from '../../src/lib/network';

const SUPPORTED: NetworkStatus = { branchId: '4dec4df0', height: 3_300_000, supported: true };
const IRONWOOD: NetworkStatus = { branchId: '37a5165b', height: 3_533_505, supported: false };

describe('network view', () => {
  it('allows spending only after a successful check that says supported', () => {
    expect(networkView({ status: null, error: null })).toEqual({ kind: 'checking' });
    expect(networkView({ status: SUPPORTED, error: null })).toEqual({ kind: 'supported' });
    expect(networkView({ status: IRONWOOD, error: null })).toEqual({ kind: 'outdated', upgrade: 'NU6.3 (Ironwood)' });
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
    expect(networkView({ status: { ...IRONWOOD, branchId: '0badc0de' }, error: null })).toEqual({
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
});
