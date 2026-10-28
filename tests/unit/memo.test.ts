import { base64urlnopad } from '@scure/base';
import { describe, expect, it } from 'vitest';

import { MEMO_MAX_BYTES } from '../../src/engine/types';
import { decodeLinkMemo, memoBytes, memoProblem } from '../../src/lib/memo';

const b64 = (bytes: ArrayLike<number>) => base64urlnopad.encode(Uint8Array.from(bytes));
const utf8 = (text: string) => new TextEncoder().encode(text);

describe('memoBytes and memoProblem', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(memoBytes('')).toBe(0);
    expect(memoBytes('Hi')).toBe(2);
    expect(memoBytes('ğüş')).toBe(6);
    expect(memoBytes('🛡️')).toBe(7);
  });

  it('allows up to 512 bytes and no NUL', () => {
    expect(memoProblem('a'.repeat(MEMO_MAX_BYTES))).toBeNull();
    expect(memoProblem('a'.repeat(MEMO_MAX_BYTES + 1))).toBe('tooLong');
    // 256 two-byte letters fill the memo; one more character does not fit.
    expect(memoProblem('ş'.repeat(256))).toBeNull();
    expect(memoProblem(`${'ş'.repeat(256)}a`)).toBe('tooLong');
    expect(memoProblem('a\u0000b')).toBe('nul');
    expect(memoProblem('line one\nline two')).toBeNull();
  });
});

describe('decodeLinkMemo', () => {
  it('decodes base64url text memos (ZIP 321)', () => {
    expect(decodeLinkMemo('SGk')).toBe('Hi');
    expect(decodeLinkMemo(b64(utf8('Fatura #4521 için ödeme 🧾')))).toBe('Fatura #4521 için ödeme 🧾');
    expect(decodeLinkMemo(b64(utf8('line one\nline two')))).toBe('line one\nline two');
    // "-" and "_" are the URL-safe letters.
    expect(decodeLinkMemo(b64(utf8('>>>???')))).toBe('>>>???');
    expect(b64(utf8('>>>???'))).toMatch(/[-_]/);
  });

  it('reads trailing zeros as padding and an empty value as no memo', () => {
    expect(decodeLinkMemo(b64([...utf8('Hi'), 0, 0, 0]))).toBe('Hi');
    expect(decodeLinkMemo(b64(new Uint8Array(MEMO_MAX_BYTES).fill(0).fill(0x61, 0, 3)))).toBe('aaa');
    expect(decodeLinkMemo('')).toBe('');
    // ZIP 302's "no memo": 0xF6 then zeros.
    expect(decodeLinkMemo(b64([0xf6, ...new Array(511).fill(0)]))).toBe('');
    expect(decodeLinkMemo(b64([0xf6]))).toBe('');
  });

  it('accepts exactly 512 bytes and refuses more', () => {
    expect(decodeLinkMemo(b64(utf8('ş'.repeat(256))))).toBe('ş'.repeat(256));
    expect(decodeLinkMemo(b64(utf8('a'.repeat(MEMO_MAX_BYTES + 1))))).toBeNull();
    // Padding does not make an over-long memo fit.
    expect(decodeLinkMemo(b64([...utf8('a'.repeat(MEMO_MAX_BYTES)), 0]))).toBeNull();
  });

  it('refuses encodings other than base64url without padding', () => {
    expect(decodeLinkMemo('SGk=')).toBeNull();
    expect(decodeLinkMemo('S+k')).toBeNull();
    expect(decodeLinkMemo('S/k')).toBeNull();
    expect(decodeLinkMemo('SGk ')).toBeNull();
    // A lone letter cannot hold a byte, and stray low bits are not canonical.
    expect(decodeLinkMemo('S')).toBeNull();
    expect(decodeLinkMemo('SGl')).toBeNull();
  });

  it('refuses memos that are not text Celari can send', () => {
    // Arbitrary data (0xFF), reserved (0xF5, 0xF7) and malformed UTF-8.
    expect(decodeLinkMemo(b64([0xff, 1, 2, 3]))).toBeNull();
    expect(decodeLinkMemo(b64([0xf5, 1]))).toBeNull();
    expect(decodeLinkMemo(b64([0xf7]))).toBeNull();
    expect(decodeLinkMemo(b64([0xf6, 1]))).toBeNull();
    expect(decodeLinkMemo(b64([0x61, 0xc3]))).toBeNull();
    // A NUL inside the text would read as the end of it.
    expect(decodeLinkMemo(b64([0x61, 0, 0x62]))).toBeNull();
  });
});
