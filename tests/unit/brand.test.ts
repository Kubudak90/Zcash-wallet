import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MASTERS, masterFor } from '../../src/components/Brand';

// BrandLockup draws its mark with fixed drawings (the 'ui' mark on 1x screens:
// every fold and the gold crescent, with wider fold gaps; the full mark on 2x
// screens and up), while the stylesheets alone say how tall it is shown
// (--brand-h, per placement). This keeps every height they set inside both
// drawings' size ranges, so a lockup made larger in CSS cannot quietly show the
// UI drawing at full-mark size, or one made smaller show its folds as grey
// hairlines. A placement that needs another drawing passes `master` to
// BrandLockup and gets its own expectation here.
const SHEETS = ['../../src/styles.css', '../../src/styles/account.css'];

const heights = SHEETS.flatMap((path) => {
  const css = readFileSync(new URL(path, import.meta.url), 'utf8');
  return [...css.matchAll(/--brand-h:\s*([\d.]+)px/g)].map((m) => ({ path, px: Number(m[1]) }));
});

/** A drawing's height in its 64 box: the lockup shows it cropped to that. */
const cropH = (master: 'full' | 'ui') => Number(MASTERS[master].crop.split(' ')[3]);

describe('brand lockup sizes', () => {
  it('finds the lockup heights in the stylesheets', () => {
    // The default plus the sidebar, top bar, Welcome, create flow and lock screen sizes.
    expect(heights.length).toBeGreaterThanOrEqual(8);
  });

  it.each(heights)('--brand-h: $px px ($path) is a size the lockup drawings are made for', ({ px }) => {
    // masterFor takes the 64 box, in device pixels.
    expect(masterFor(Math.round((px * 64) / cropH('ui')))).toBe('ui');
    expect(masterFor(Math.round((2 * px * 64) / cropH('full')))).toBe('full');
    // Every fold at least a whole device pixel wide, so it reads as a gap: the
    // 'ui' mark's at 1x, the full mark's at 2x.
    expect((MASTERS.ui.gap * px) / cropH('ui')).toBeGreaterThanOrEqual(1);
    expect((MASTERS.full.gap * 2 * px) / cropH('full')).toBeGreaterThanOrEqual(1);
  });

  it('crops both lockup drawings to boxes of the same shape', () => {
    const aspect = (master: 'full' | 'ui') => Number(MASTERS[master].crop.split(' ')[2]) / cropH(master);
    expect(aspect('full')).toBeCloseTo(aspect('ui'), 3);
  });

  it('keeps the full mark for 48 px and up and the silhouette for 20 px and down', () => {
    expect(masterFor(72)).toBe('full');
    expect(masterFor(48)).toBe('full');
    expect(masterFor(47)).toBe('ui');
    expect(masterFor(21)).toBe('ui');
    expect(masterFor(20)).toBe('16');
    expect(masterFor(16)).toBe('16');
  });
});
