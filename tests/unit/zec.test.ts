import { describe, expect, it } from 'vitest';

import { AmountError, formatZec, parseZec, zatsToPlainZec } from '../../src/lib/zec';

describe('parseZec', () => {
  it.each([
    ['1', 100_000_000n],
    ['0.5', 50_000_000n],
    ['0,5', 50_000_000n],
    ['.25', 25_000_000n],
    ['12.', 1_200_000_000n],
    ['0.00000001', 1n],
    ['  2.1  ', 210_000_000n],
    ['21000000', 2_100_000_000_000_000n],
  ])('parses %j', (input, zats) => {
    expect(parseZec(input)).toBe(zats);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'invalid'],
    ['1.000,5', 'invalid'],
    ['1,000.5', 'invalid'],
    ['-1', 'invalid'],
    ['1e3', 'invalid'],
    ['0.000000001', 'tooManyDecimals'],
    ['0', 'zero'],
    ['0.00000000', 'zero'],
  ])('rejects %j as %s', (input, code) => {
    expect(() => parseZec(input)).toThrow(AmountError);
    try {
      parseZec(input);
    } catch (e) {
      expect((e as AmountError).code).toBe(code);
    }
  });
});

describe('formatZec', () => {
  it('formats with English separators', () => {
    expect(formatZec(123_456_789_000n)).toBe('1,234.56789');
    expect(formatZec(0n)).toBe('0.00');
    expect(formatZec(1n)).toBe('0.00000001');
    expect(formatZec(150_000_000n)).toBe('1.50');
  });

  it('formats with Turkish separators', () => {
    expect(formatZec(123_456_789_000n, { locale: 'tr' })).toBe('1.234,56789');
    expect(formatZec(50_000_000n, { locale: 'tr' })).toBe('0,50');
  });

  it('handles negative values and numbers', () => {
    expect(formatZec(-10_000n)).toBe('-0.0001');
    expect(formatZec(25_000_000)).toBe('0.25');
  });

  it('round-trips through parseZec', () => {
    for (const zats of [1n, 99_999_999n, 100_000_000n, 2_100_000_000_000_000n]) {
      expect(parseZec(zatsToPlainZec(zats))).toBe(zats);
    }
  });
});
