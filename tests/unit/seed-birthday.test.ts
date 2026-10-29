import { describe, expect, it } from 'vitest';

import {
  LONG_SCAN_BLOCKS,
  NU7_ACTIVATION_HEIGHT,
  SAPLING_ACTIVATION_HEIGHT,
  blocksToScan,
  currentMonth,
  estimateBirthday,
  heightBefore,
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
    // Fixed vectors: swapping the last word of a random phrase still passes the
    // checksum one time in 256.
    expect(isValidSeedPhrase(`${'abandon '.repeat(23)}art`)).toBe(true);
    expect(isValidSeedPhrase(`${'abandon '.repeat(23)}abandon`)).toBe(false);
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

  describe('across NU7, where blocks go from 75 s to 25 s apart', () => {
    const A = NU7_ACTIVATION_HEIGHT;
    // Ten days of 25 s blocks (3456 a day) since the block before activation.
    const tipAfter = A - 1 + 10 * 3456;
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

    it('uses mainnet’s NU7 activation height', () => {
      expect(NU7_ACTIVATION_HEIGHT).toBe(3_543_405);
      // A day back from the activation block: that block at 25 s, then 75 s blocks.
      expect(heightBefore(3_543_405, 86_400)).toBe(3_542_252);
    });

    it('counts 3456 blocks a day after activation', () => {
      expect(estimateBirthday(daysAgo(4), tipAfter, now, 0)).toBe(tipAfter - 4 * 3456);
    });

    it('reaches the block before activation at the moment it activated', () => {
      expect(estimateBirthday(daysAgo(10), tipAfter, now, 0)).toBe(A - 1);
    });

    it('counts 1152 blocks a day before activation', () => {
      expect(estimateBirthday(daysAgo(12), tipAfter, now, 0)).toBe(A - 1 - 2 * 1152);
      // The 14-day safety margin crosses activation too: 10 fast days, then 8 slow ones.
      expect(estimateBirthday(daysAgo(4), tipAfter, now)).toBe(A - 1 - 8 * 1152);
    });

    it('keeps 75 s blocks while the tip is before activation', () => {
      expect(estimateBirthday(daysAgo(1), A - 1, now, 0)).toBe(A - 1 - 1152);
      // One block past it, that block counts 25 s and the rest of the day 75 s each.
      expect(heightBefore(A, 86_400)).toBe(Math.floor(A - 1 - (86_400 - 25) / 75));
    });

    it('never jumps or turns back as the date moves across activation', () => {
      let previous = Infinity;
      for (let hours = 0; hours <= 24 * 30; hours += 1) {
        const height = estimateBirthday(new Date(now.getTime() - hours * 3_600_000), tipAfter, now, 0);
        expect(height).toBeLessThanOrEqual(previous);
        // An hour is 144 blocks after activation and 48 before it.
        if (previous !== Infinity) expect(previous - height).toBeLessThanOrEqual(144);
        previous = height;
      }
    });

    it('starts new wallets about 12 minutes of blocks under the tip', () => {
      expect(newWalletBirthday(A - 1)).toBe(A - 11);
      expect(newWalletBirthday(A + 100)).toBe(A + 70);
      // Six 25 s blocks (A to A + 5), then eight 75 s ones.
      expect(newWalletBirthday(A + 5)).toBe(A - 9);
    });
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
    expect(translate('tr', 'sync.syncing', { blocks: '47.654' })).toBe('Eşitleniyor · 47.654 blok kaldı');
    expect(translate('en', 'sync.syncing', { blocks: '47,654' })).toBe('Syncing · 47,654 blocks left');
  });
});

describe('blocksToScan (the restore notice for an old birthday)', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const tip = 3_534_800;

  it('is the gap from the birthday estimateBirthday picks to the tip', () => {
    for (const month of ['2026-10', '2025-01', '2023-06', '2018-10']) {
      expect(blocksToScan(month, tip, now)).toBe(tip - estimateBirthday(new Date(`${month}-01T00:00:00Z`), tip, now));
    }
    // This month: four weeks plus the 14-day margin, at 75 s a block.
    expect(blocksToScan('2026-10', tip, now)).toBe(Math.floor((42.5 * 86_400) / 75));
  });

  it('passes LONG_SCAN_BLOCKS about 14 months back (margin included), not for a recent month', () => {
    expect(blocksToScan('2026-01', tip, now)).toBeLessThan(LONG_SCAN_BLOCKS);
    // 2025-10-01: 407.5 days with the margin, 469,440 blocks; 2025-09-01: 437.5 days, 504,000.
    expect(blocksToScan('2025-10', tip, now)).toBe(469_440);
    expect(blocksToScan('2025-09', tip, now)).toBe(504_000);
    expect(blocksToScan('2025-10', tip, now)).toBeLessThan(LONG_SCAN_BLOCKS);
    expect(blocksToScan('2025-09', tip, now)).toBeGreaterThan(LONG_SCAN_BLOCKS);
    // The verifiers' long restores: 2025-01 (784k blocks measured) and the spam era.
    expect(blocksToScan('2025-01', tip, now)).toBeGreaterThan(780_000);
    expect(blocksToScan('2022-08', tip, now)).toBeGreaterThan(1_800_000);
  });

  it('counts from the date alone, at 75 s a block, before the tip is known', () => {
    expect(blocksToScan('2025-01', null, now)).toBe(blocksToScan('2025-01', tip, now));
    expect(blocksToScan('2026-10', null, now)).toBe(Math.floor((42.5 * 86_400) / 75));
  });
});
