import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MASTERS, masterFor } from '../../src/components/Brand';

// BrandLockup draws its mark with one fixed drawing (the one-fold UI mark),
// while the stylesheets alone say how tall it is shown (--brand-h, per
// placement). This keeps every height they set inside that drawing's size
// range, so a lockup made larger in CSS cannot quietly show the small drawing
// at full-mark size. A placement that needs another drawing passes `master`
// to BrandLockup and gets its own expectation here.
const SHEETS = ['../../src/styles.css', '../../src/styles/account.css'];

const heights = SHEETS.flatMap((path) => {
  const css = readFileSync(new URL(path, import.meta.url), 'utf8');
  return [...css.matchAll(/--brand-h:\s*([\d.]+)px/g)].map((m) => ({ path, px: Number(m[1]) }));
});

describe('brand lockup sizes', () => {
  it('finds the lockup heights in the stylesheets', () => {
    // The default plus the sidebar, top bar, Welcome, create flow and lock screen sizes.
    expect(heights.length).toBeGreaterThanOrEqual(6);
  });

  it.each(heights)('--brand-h: $px px ($path) is a size the lockup drawing is made for', ({ px }) => {
    // The lockup shows the drawing cropped to its own height; masterFor takes the 64 box.
    const cropH = Number(MASTERS.small.crop.split(' ')[3]);
    expect(masterFor(Math.round((px * 64) / cropH))).toBe('small');
  });
});
