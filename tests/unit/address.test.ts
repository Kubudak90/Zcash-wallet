import { base58check, base64urlnopad, bech32, bech32m } from '@scure/base';
import { blake2b } from '@noble/hashes/blake2';
import { sha256 } from '@noble/hashes/sha256';
import { describe, expect, it } from 'vitest';

import {
  acceptsMemo,
  checkAddress,
  isShieldedOnlyUnified,
  parsePaymentInput,
  shortAddress,
  unifiedReceivers,
  unpayableReason,
} from '../../src/lib/address';

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
const b58 = base58check(sha256);

// Unified address receiver typecodes (ZIP 316).
const P2PKH = 0x00;
const P2SH = 0x01;
const SAPLING_RX = 0x02;
const ORCHARD = 0x03;

/** F4Jumble (ZIP 316), written out independently of src/lib/address.ts. */
function f4jumble(m: Uint8Array): Uint8Array {
  const tag = (name: string, i: number, j = 0) => {
    const p = new Uint8Array(16);
    p.set(new TextEncoder().encode(`UA_F4Jumble_${name}`));
    p.set([i, j & 0xff, j >> 8], 13);
    return p;
  };
  const left = Math.min(64, Math.floor(m.length / 2));
  const right = m.length - left;
  const h = (i: number, u: Uint8Array) => blake2b(u, { dkLen: left, personalization: tag('H', i) });
  const g = (i: number, u: Uint8Array) => {
    const out: number[] = [];
    for (let j = 0; out.length < right; j++) out.push(...blake2b(u, { dkLen: 64, personalization: tag('G', i, j) }));
    return out.slice(0, right);
  };
  const xor = (a: Uint8Array, b: ArrayLike<number>) => a.map((v, k) => v ^ b[k]!);
  const x = xor(m.subarray(left), g(0, m.subarray(0, left)));
  const y = xor(m.subarray(0, left), h(0, x));
  const d = xor(x, g(1, y));
  const c = xor(y, h(1, d));
  return new Uint8Array([...c, ...d]);
}

/** A mainnet unified address holding receivers of these typecodes and lengths. */
function unified(receivers: [typecode: number, length: number][]): string {
  const body = receivers.flatMap(([typecode, length]) => [typecode, length, ...bytes(length, typecode + 1)]);
  const padding = [...new TextEncoder().encode('u'), ...new Array(15).fill(0)];
  return bech32m.encode('u', bech32m.toWords(f4jumble(new Uint8Array([...body, ...padding]))), false);
}

// A lone transparent receiver is too short for F4Jumble; ZIP 316 expiry metadata pads it out.
const EXPIRY: [number, number][] = [
  [0xe0, 4],
  [0xe1, 8],
];
const TRANSPARENT_ONLY_UA = unified([[P2PKH, 20], ...EXPIRY]);

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

describe('unpayableReason (review round 7, SPEND-2)', () => {
  it('refuses TEX, which takes a ZIP 320 pair the engine cannot build, and passes the others through', () => {
    expect(unpayableReason(checkAddress(TEX))).toBe('texUnsupported');
    expect(unpayableReason(checkAddress(T1))).toBeNull();
    expect(unpayableReason(checkAddress(''))).toBe('empty');
    expect(unpayableReason(checkAddress('hello'))).toBe('invalid');
  });
});

describe('parsePaymentInput', () => {
  it('passes plain addresses through', () => {
    expect(parsePaymentInput(` ${T1} `)).toEqual({ address: T1 });
  });

  it('reads ZIP-321 URIs', () => {
    expect(parsePaymentInput(`zcash:${UA}?amount=1.5&message=hi`)).toEqual({ address: UA, amountZats: 150_000_000n });
    expect(parsePaymentInput(`ZCASH:${T1}`)).toEqual({ address: T1 });
    expect(parsePaymentInput(`zcash:?address=${UA}&amount=0.1`)).toEqual({ address: UA, amountZats: 10_000_000n });
    expect(parsePaymentInput(`zcash:${T1}?amount=0.00000001`)).toEqual({ address: T1, amountZats: 1n });
    // Zero asks for no amount in particular.
    expect(parsePaymentInput(`zcash:${T1}?amount=0.0`)).toEqual({ address: T1 });
  });

  it('decodes the memo a link asks for', () => {
    expect(parsePaymentInput(`zcash:${UA}?amount=1&memo=SGk`)).toEqual({
      address: UA,
      amountZats: 100_000_000n,
      memo: 'Hi',
    });
    expect(parsePaymentInput(`zcash:${SAPLING}?memo=${base64urlnopad.encode(new TextEncoder().encode('Fatura #4521, ödeme'))}`)).toEqual({
      address: SAPLING,
      memo: 'Fatura #4521, ödeme',
    });
    // An empty memo, or ZIP 302's "no memo", asks for none.
    expect(parsePaymentInput(`zcash:${T1}?amount=1&memo=`)).toEqual({ address: T1, amountZats: 100_000_000n });
    expect(parsePaymentInput(`zcash:${UA}?memo=9gAA`)).toEqual({ address: UA });
  });

  it('flags links it must not pay in part', () => {
    const multi = `zcash:?address=${UA}&amount=0.1&address.1=${T1}&amount.1=0.2`;
    expect(parsePaymentInput(multi)).toEqual({ address: multi, refused: 'multi' });
    const req = `zcash:${UA}?amount=0.3&req-futurefeature=1`;
    expect(parsePaymentInput(req)).toEqual({ address: req, refused: 'req' });
  });

  it('refuses links that ZIP-321 calls invalid instead of guessing', () => {
    for (const link of [
      // The same parameter twice.
      `zcash:${UA}?amount=0.1&amount=10`,
      `zcash:${UA}?memo=SGk&memo=SGk`,
      // An address in the path and as a parameter.
      `zcash:${UA}?address=${T1}&amount=1`,
      // Amounts it cannot read exactly.
      `zcash:${T1}?amount=abc`,
      `zcash:${T1}?amount=`,
      `zcash:${T1}?amount=0.123456789`,
      `zcash:${T1}?amount=1,5`,
      `zcash:${T1}?amount=-1`,
      `zcash:${T1}?amount=1e3`,
      `zcash:${T1}?amount=21000000.00000001`,
      // Memos that are not base64url without padding, too long, or not text.
      `zcash:${UA}?memo=SGk=`,
      `zcash:${UA}?memo=S+k`,
      `zcash:${UA}?memo=SGl`,
      `zcash:${UA}?memo=${base64urlnopad.encode(new Uint8Array(513).fill(0x61))}`,
      `zcash:${UA}?memo=${base64urlnopad.encode(new Uint8Array([0xff, 1, 2]))}`,
    ]) {
      expect(parsePaymentInput(link), link).toEqual({ address: link, refused: 'invalid' });
    }
    expect(parsePaymentInput(`zcash:${T1}?amount=21000000`)).toEqual({ address: T1, amountZats: 2_100_000_000_000_000n });
  });

  it('refuses a memo for an address that cannot take one', () => {
    for (const address of [T1, T3, TEX, TRANSPARENT_ONLY_UA]) {
      const link = `zcash:${address}?amount=1&memo=SGk`;
      expect(parsePaymentInput(link), address).toEqual({ address: link, refused: 'memo' });
    }
  });

  it('leaves half-typed and malformed links alone', () => {
    expect(parsePaymentInput('zcash:')).toEqual({ address: 'zcash:' });
    expect(parsePaymentInput('zcash:?amount=1')).toEqual({ address: 'zcash:?amount=1' });
    expect(() => parsePaymentInput('zcash:%')).not.toThrow();
    expect(parsePaymentInput('zcash:%')).toEqual({ address: 'zcash:%' });
  });
});

describe('acceptsMemo', () => {
  it('accepts shielded recipients only', () => {
    expect(acceptsMemo(UA)).toBe(true);
    expect(acceptsMemo(` ${UA}\n`)).toBe(true);
    expect(acceptsMemo(UA.toUpperCase())).toBe(true);
    expect(acceptsMemo(SAPLING)).toBe(true);
    expect(acceptsMemo(unified([[ORCHARD, 43]]))).toBe(true);
    expect(acceptsMemo(unified([[P2PKH, 20], [SAPLING_RX, 43]]))).toBe(true);
    for (const address of [T1, T3, TEX, TRANSPARENT_ONLY_UA, unified([[P2SH, 20], ...EXPIRY]), TM, 'hello', '']) {
      expect(acceptsMemo(address), address).toBe(false);
    }
  });

  it('leaves a unified address it cannot decode to the engine', () => {
    // Valid bech32m, but no F4Jumble padding inside.
    expect(acceptsMemo(bech32m.encode('u', bech32m.toWords(bytes(96)), false))).toBe(true);
  });

  it('counts only Sapling and Orchard receivers', () => {
    // A receiver type it does not know is no promise of a memo.
    expect(acceptsMemo(unified([[P2PKH, 20], [0x05, 32]]))).toBe(false);
    expect(acceptsMemo(unified([[0x05, 32], [ORCHARD, 43]]))).toBe(true);
  });
});

describe('isShieldedOnlyUnified', () => {
  // A throwaway mainnet account of the vendored engine (it owns nothing; measured in the
  // engine port's working repository, see docs/engine-port.md): get_current_address, and two
  // get_next_shielded_address answers.
  const ENGINE_FULL =
    'u1f7a0d9844ulfk5lhw7c8yym68fcvwy7w4ztswv789xcn7e3strlfvdynq2ra80p75c83df79kcm2e23f4rg5wgxudd35npz5nllt59zmcfwcu5l33a0pz7w2l080xegff06flwzx3ypeeum3fmddlpr0mla7jkwspawdfcapxhtqqnpfzsarar54gup37ysyz55pjf0vzru22qtxxq3';
  const ENGINE_FRESH = [
    'u1uhaun9qtnjcucezz6eyk700hyp8xqfg9h22elczhtney9nry9yyl7hqxnaavn7h6qj49pfeaj9j3lwvwlas34xrqyltusxz7g2qsld308tx2s4cp4xgtwaezt2dyeql53x3atyskds0jy3qn69wncug00xgqf4r97gdqdketaqmh8dkg',
    'u198c4a60gthf6vk5u7dez9tvfegvjh9m0dl99wehywnlnpvqmmq9u4lhdjgrw396wv7gjynr4ddrcdm5g87stwk06keqp7x5zrzzllhvfdzsh0slkjr6c7c6hdjc4dfwajhlm4u2vffz9pksuncymkjwmn9h6fps9r9rcp8a60vse63r3',
  ];

  it("reads the engine's addresses: the full one has a transparent receiver, the fresh ones do not", () => {
    expect(unifiedReceivers(ENGINE_FULL)?.sort()).toEqual([P2PKH, SAPLING_RX, ORCHARD]);
    for (const address of ENGINE_FRESH) expect(unifiedReceivers(address)?.sort()).toEqual([SAPLING_RX, ORCHARD]);
    expect(isShieldedOnlyUnified(ENGINE_FULL)).toBe(false);
    for (const address of ENGINE_FRESH) expect(isShieldedOnlyUnified(address)).toBe(true);
  });

  it('needs a Sapling or Orchard receiver and no transparent one', () => {
    expect(isShieldedOnlyUnified(unified([[ORCHARD, 43]]))).toBe(true);
    expect(isShieldedOnlyUnified(unified([[SAPLING_RX, 43]]))).toBe(true);
    expect(isShieldedOnlyUnified(unified([[0x05, 32], [ORCHARD, 43]]))).toBe(true);
    for (const address of [
      unified([[P2PKH, 20], [ORCHARD, 43]]),
      unified([[P2SH, 20], [SAPLING_RX, 43]]),
      TRANSPARENT_ONLY_UA,
      unified([[0x05, 32], ...EXPIRY]),
      // Valid bech32m without F4Jumble padding: nothing can be said about its receivers.
      bech32m.encode('u', bech32m.toWords(bytes(96)), false),
      SAPLING,
      T1,
      TEX,
      '',
    ]) {
      expect(isShieldedOnlyUnified(address), address).toBe(false);
    }
  });
});

describe('shortAddress', () => {
  it('shortens long addresses only', () => {
    expect(shortAddress('u1abcdefghijklmnopqrstuvwxyz')).toBe('u1abcdef…stuvwxyz');
    expect(shortAddress('t1short')).toBe('t1short');
  });
});
