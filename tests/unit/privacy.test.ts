import { describe, expect, it } from 'vitest';

import { poolPrivacy, txPrivacy } from '../../src/lib/privacy';

describe('history privacy labels', () => {
  it('maps every pool WebZjs reports, Ironwood included', () => {
    expect(poolPrivacy('sapling')).toBe('shielded');
    expect(poolPrivacy('orchard')).toBe('shielded');
    expect(poolPrivacy('ironwood')).toBe('shielded');
    expect(poolPrivacy('mixed')).toBe('partial');
    expect(poolPrivacy('transparent')).toBe('transparent');
  });

  it('labels nothing it cannot vouch for', () => {
    expect(poolPrivacy('unknown')).toBeNull();
    expect(poolPrivacy('')).toBeNull();
    expect(poolPrivacy('zfuture')).toBeNull();
    // Not an inherited object key either.
    expect(poolPrivacy('constructor')).toBeNull();
  });

  it('says a shielding shows its amount, though its outputs are shielded', () => {
    expect(txPrivacy({ type: 'shielded', pool: 'orchard' })).toBe('shielding');
    expect(txPrivacy({ type: 'received', pool: 'orchard' })).toBe('shielded');
    expect(txPrivacy({ type: 'sent', pool: 'sapling' })).toBe('shielded');
    expect(txPrivacy({ type: 'shielded', pool: 'mixed' })).toBe('partial');
    expect(txPrivacy({ type: 'shielded', pool: 'unknown' })).toBeNull();
  });
});
