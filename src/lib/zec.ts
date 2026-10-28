// ZEC amounts are handled as integer zatoshis (bigint) end to end so that no
// value ever passes through a float.

export const ZATS_PER_ZEC = 100_000_000n;
const DECIMALS = 8;

export type AmountErrorCode = 'empty' | 'invalid' | 'tooManyDecimals' | 'zero';

export class AmountError extends Error {
  constructor(public readonly code: AmountErrorCode) {
    super(`invalid amount: ${code}`);
    this.name = 'AmountError';
  }
}

/**
 * Parses a user-typed ZEC amount into zatoshis.
 * Accepts either "." or "," as the decimal separator (Turkish keyboards use ",").
 * A single separator is always read as the decimal one, so "1.000" and "1,000"
 * both mean 1 ZEC; the Send form echoes the parsed value so this stays visible.
 * Inputs with more than one separator, such as "1.000,5", are rejected.
 */
export function parseZec(input: string): bigint {
  const trimmed = input.trim();
  if (trimmed === '') throw new AmountError('empty');

  const normalized = trimmed.replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(normalized)) throw new AmountError('invalid');

  const [whole = '', frac = ''] = normalized.split('.');
  if (frac.length > DECIMALS) throw new AmountError('tooManyDecimals');

  const zats = BigInt(whole || '0') * ZATS_PER_ZEC + BigInt(frac.padEnd(DECIMALS, '0') || '0');
  if (zats === 0n) throw new AmountError('zero');
  return zats;
}

/**
 * Formats zatoshis as a ZEC string, e.g. 123456789n -> "1.23456789".
 * Trailing zeros are dropped but at least `minDecimals` digits are kept.
 */
export function formatZec(
  zats: bigint | number,
  { locale = 'en', minDecimals = 2 }: { locale?: 'tr' | 'en'; minDecimals?: number } = {},
): string {
  const value = typeof zats === 'bigint' ? zats : BigInt(Math.trunc(zats));
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const whole = (abs / ZATS_PER_ZEC).toString();
  let frac = (abs % ZATS_PER_ZEC).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  if (frac.length < minDecimals) frac = frac.padEnd(minDecimals, '0');

  const groupSep = locale === 'tr' ? '.' : ',';
  const decimalSep = locale === 'tr' ? ',' : '.';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep);

  return `${negative ? '-' : ''}${grouped}${frac ? decimalSep + frac : ''}`;
}

/** Converts a zatoshi amount to the plain "1.5" form used in ZIP-321 URIs. */
export function zatsToPlainZec(zats: bigint): string {
  const whole = zats / ZATS_PER_ZEC;
  const frac = (zats % ZATS_PER_ZEC).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

/**
 * Formats zatoshis for an amount field: no grouping, and a decimal comma in
 * Turkish, so a filled-in "1,001" is not read as one thousand and one.
 */
export function formatZecInput(zats: bigint, locale: 'tr' | 'en'): string {
  const plain = zatsToPlainZec(zats);
  return locale === 'tr' ? plain.replace('.', ',') : plain;
}
