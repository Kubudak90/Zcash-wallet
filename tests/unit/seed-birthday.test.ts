import { describe, expect, it } from 'vitest';

import {
  SAPLING_ACTIVATION_HEIGHT,
  currentMonth,
  estimateBirthday,
  newWalletBirthday,
  parseBirthdayMonth,
  syncProgress,
} from '../../src/lib/birthday';
import {
  isValidSeedPhrase,
  newSeedPhrase,
  normalizeSeedPhrase,
  pickVerificationPositions,
  seedBytes,
} from '../../src/lib/seed';
import { translate } from '../../src/i18n';
import { en } from '../../src/i18n/en';
import { tr } from '../../src/i18n/tr';

describe('seed phrases', () => {
  it('generates valid, distinct 24-word phrases', () => {
    const a = newSeedPhrase();
    const b = newSeedPhrase();
    expect(a.split(' ')).toHaveLength(24);
    expect(isValidSeedPhrase(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('validates checksums and normalizes input', () => {
    const phrase = newSeedPhrase();
    expect(isValidSeedPhrase(`  ${phrase.toUpperCase().replace(/ /g, '   ')} `)).toBe(true);
    const words = phrase.split(' ');
    words[23] = words[23] === 'abandon' ? 'zoo' : 'abandon';
    expect(isValidSeedPhrase(words.join(' '))).toBe(false);
    expect(isValidSeedPhrase('hello world')).toBe(false);
    expect(normalizeSeedPhrase(' A  b\nc ')).toBe('a b c');
  });

  it('derives the standard BIP39 seed (empty passphrase)', () => {
    // BIP39 test vector: "abandon ×11 about" with empty passphrase.
    const seed = seedBytes(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    );
    const hex = [...seed].map((x) => x.toString(16).padStart(2, '0')).join('');
    expect(hex.slice(0, 32)).toBe('5eb00bbddcf069084889a8ab91555681');
  });

  it('picks distinct sorted verification positions', () => {
    for (let i = 0; i < 20; i++) {
      const picks = pickVerificationPositions(3);
      expect(new Set(picks).size).toBe(3);
      expect([...picks].sort((a, b) => a - b)).toEqual(picks);
      expect(picks.every((p) => p >= 0 && p < 24)).toBe(true);
    }
  });
});

describe('birthday estimation', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const tip = 3_100_000;

  it('counts back 1152 blocks per day plus the safety margin', () => {
    const tenDaysAgo = new Date(now.getTime() - 10 * 86_400_000);
    expect(estimateBirthday(tenDaysAgo, tip, now, 0)).toBe(tip - 11_520);
    expect(estimateBirthday(tenDaysAgo, tip, now)).toBe(tip - 24 * 1152);
  });

  it('clamps to Sapling activation and the tip', () => {
    expect(estimateBirthday(new Date('2015-01-01'), tip, now)).toBe(SAPLING_ACTIVATION_HEIGHT);
    expect(estimateBirthday(new Date('2030-01-01'), tip, now, 0)).toBe(tip);
  });

  it('refuses an invalid date instead of returning NaN', () => {
    // new Date('2023-13-01T00:00:00Z') is an Invalid Date; it used to become a NaN birthday.
    expect(() => estimateBirthday(new Date('2023-13-01T00:00:00Z'), tip, now)).toThrow(RangeError);
    expect(() => estimateBirthday(new Date('x'), tip, now)).toThrow(RangeError);
  });

  it('reads typed birthday months', () => {
    expect(parseBirthdayMonth('2023-05', now)).toBe('2023-05');
    expect(parseBirthdayMonth(' 05.2023 ', now)).toBe('2023-05');
    expect(parseBirthdayMonth('5/2023', now)).toBe('2023-05');
    expect(parseBirthdayMonth('05-2023', now)).toBe('2023-05');
    expect(parseBirthdayMonth('2023/5', now)).toBe('2023-05');
    expect(parseBirthdayMonth('2018-10', now)).toBe('2018-10');
    expect(parseBirthdayMonth('2026-10', now)).toBe('2026-10');
  });

  it('rejects unreadable months and months outside Sapling activation to now', () => {
    for (const value of ['', '2023', '2023-13', '00.2023', '13/2023', 'Mayıs 2023', '2023-5-1', '23-05']) {
      expect(parseBirthdayMonth(value, now), value).toBeNull();
    }
    expect(parseBirthdayMonth('2018-09', now)).toBeNull();
    expect(parseBirthdayMonth('2026-11', now)).toBeNull();
  });

  it('formats the current month in local time', () => {
    expect(currentMonth(new Date(2026, 0, 31, 23, 59))).toBe('2026-01');
    expect(currentMonth(new Date(2026, 9, 1, 0, 1))).toBe('2026-10');
  });

  it('starts new wallets just under the tip', () => {
    expect(newWalletBirthday(tip)).toBe(tip - 10);
  });

  it('computes sync progress', () => {
    expect(syncProgress(1000, 1000, 2000)).toBe(0);
    expect(syncProgress(1000, 1500, 2000)).toBe(0.5);
    expect(syncProgress(1000, 2500, 2000)).toBe(1);
    expect(syncProgress(2000, 2000, 2000)).toBe(1);
  });
});

describe('i18n', () => {
  it('has the same keys in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
  });

  it('keeps placeholders consistent across languages', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(tr) as (keyof typeof tr)[]) {
      expect(vars(en[key]), key).toEqual(vars(tr[key]));
    }
  });

  it('interpolates variables', () => {
    expect(translate('tr', 'sync.syncing', { pct: 42 })).toBe('Eşitleniyor %42');
    expect(translate('en', 'sync.syncing', { pct: 42 })).toBe('Syncing 42%');
  });
});
