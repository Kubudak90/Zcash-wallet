import { describe, expect, it } from 'vitest';

import { poolPrivacy } from '../../src/lib/privacy';

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
});
