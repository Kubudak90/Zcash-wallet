import { base58check, bech32, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import { describe, expect, it } from 'vitest';

import { checkAddress, parsePaymentInput, shortAddress } from '../../src/lib/address';

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
const b58 = base58check(sha256);

// Example unified address from the WebZjs documentation.
const UA =
  'u18rakpts0de589sx9dkamcjms3apruqqax9k2s6e7zjxx9vv5kc67pks2trg9d3nrgd5acu8w8arzjjuepakjx38dyxl6ahd948w0mhdt9jxqsntan6px3ysz80s04a87pheg2mqvlzpehrgup7568nfd6ez23xd69ley7802dfvplnfn7c07vlyumcnfjul4pvv630ac336rjhjyak5';
const SAPLING = bech32.encode('zs', bech32.toWords(bytes(43)), 90);
const T1 = b58.encode(new Uint8Array([0x1c, 0xb8, ...bytes(20)]));
const T3 = b58.encode(new Uint8Array([0x1c, 0xbd, ...bytes(20)]));
const TM = b58.encode(new Uint8Array([0x1d, 0x25, ...bytes(20)]));
const TEX = bech32m.encode('tex', bech32m.toWords(bytes(20)), false);

describe('checkAddress', () => {
  it('accepts mainnet address kinds', () => {
    expect(checkAddress(UA)).toEqual({ ok: true, kind: 'unified' });
    expect(checkAddress(SAPLING)).toEqual({ ok: true, kind: 'sapling' });
    expect(checkAddress(T1)).toEqual({ ok: true, kind: 'transparent' });
    expect(checkAddress(T3)).toEqual({ ok: true, kind: 'transparent' });
    expect(checkAddress(TEX)).toEqual({ ok: true, kind: 'tex' });
    expect(checkAddress(`  ${UA}\n`)).toEqual({ ok: true, kind: 'unified' });
  });

  it('accepts all-uppercase bech32', () => {
    expect(checkAddress(SAPLING.toUpperCase())).toEqual({ ok: true, kind: 'sapling' });
  });

  it('flags testnet addresses', () => {
    expect(checkAddress(TM)).toEqual({ ok: false, reason: 'testnet' });
    expect(checkAddress(bech32m.encode('utest', bech32m.toWords(bytes(60)), false))).toEqual({
      ok: false,
      reason: 'testnet',
    });
    expect(checkAddress(bech32.encode('ztestsapling', bech32.toWords(bytes(43)), 90))).toEqual({
      ok: false,
      reason: 'testnet',
    });
  });

  it('catches typos through the checksum', () => {
    const typo = UA.slice(0, 40) + (UA[40] === 'q' ? 'p' : 'q') + UA.slice(41);
    expect(checkAddress(typo)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkAddress(T1.slice(0, -1) + (T1.endsWith('a') ? 'b' : 'a'))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects junk', () => {
    expect(checkAddress('')).toEqual({ ok: false, reason: 'empty' });
    expect(checkAddress('hello')).toEqual({ ok: false, reason: 'invalid' });
    expect(checkAddress('0x52908400098527886E0F7030069857D2E4169EE7')).toEqual({ ok: false, reason: 'invalid' });
    expect(checkAddress(UA.slice(0, 20) + UA.slice(20).toUpperCase())).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('parsePaymentInput', () => {
  it('passes plain addresses through', () => {
    expect(parsePaymentInput(` ${T1} `)).toEqual({ address: T1 });
  });

  it('reads ZIP-321 URIs', () => {
    expect(parsePaymentInput(`zcash:${UA}?amount=1.5&message=hi`)).toEqual({ address: UA, amountZats: 150_000_000n });
    expect(parsePaymentInput(`ZCASH:${T1}`)).toEqual({ address: T1 });
    expect(parsePaymentInput(`zcash:${T1}?amount=abc`)).toEqual({ address: T1 });
  });
});

describe('shortAddress', () => {
  it('shortens long addresses only', () => {
    expect(shortAddress('u1abcdefghijklmnopqrstuvwxyz')).toBe('u1abcdef…stuvwxyz');
    expect(shortAddress('t1short')).toBe('t1short');
  });
});
