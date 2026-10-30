import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MASTERS, masterFor } from '../../src/components/Brand';

// BrandLockup draws its mark with one fixed drawing (the 'ui' mark: every fold
// and the gold crescent, with wider fold gaps), while the stylesheets alone say
// how tall it is shown (--brand-h, per placement). This keeps every height they
// set inside that drawing's size range, so a lockup made larger in CSS cannot
// quietly show the UI drawing at full-mark size, or one made smaller show its
// folds as grey hairlines. A placement that needs another drawing passes
// `master` to BrandLockup and gets its own expectation here.
const SHEETS = ['../../src/styles.css', '../../src/styles/account.css'];

const heights = SHEETS.flatMap((path) => {
  const css = readFileSync(new URL(path, import.meta.url), 'utf8');
  return [...css.matchAll(/--brand-h:\s*([\d.]+)px/g)].map((m) => ({ path, px: Number(m[1]) }));
});

/** The 'ui' drawing's fold gaps in its 64 box (Brand.tsx; the full mark's are 1.27). */
const UI_GAP = 2.0;

describe('brand lockup sizes', () => {
  it('finds the lockup heights in the stylesheets', () => {
    // The default plus the sidebar, top bar, Welcome, create flow and lock screen sizes.
    expect(heights.length).toBeGreaterThanOrEqual(8);
  });

  it.each(heights)('--brand-h: $px px ($path) is a size the lockup drawing is made for', ({ px }) => {
    // The lockup shows the drawing cropped to its own height; masterFor takes the 64 box.
    const cropH = Number(MASTERS.ui.crop.split(' ')[3]);
    expect(masterFor(Math.round((px * 64) / cropH))).toBe('ui');
    // At 1x every fold is at least a whole pixel wide, so it reads as a gap.
    expect((UI_GAP * px) / cropH).toBeGreaterThanOrEqual(1);
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
