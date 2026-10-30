import { useId, type ReactNode } from 'react';

import { BrandLockup, MASTERS } from '../components/Brand';
import { useI18n } from '../i18n';

/**
 * The pieces the screens outside the wallet share: Welcome, Create and Restore,
 * the password step, the lock screen and boot. Styles: src/styles/account.css.
 */

// The engraved mark: the logo's hexagonal C drawn as fine lines, like an
// engraving. Its silhouette (the 16 px drawing, which has no folds) is filled
// with lines that follow its outer edge inwards, and echoed outside by wider,
// fading hexagons, open to the right like its mouth. The gold facet is the one
// colour. Worked out in the logo's 64 box, shown in a 1200 x 1200 box with the
// hexagon's centre at (600, 600), 4 px to a unit.
type Pt = [number, number];

/** The centre of the silhouette's hexagon (the axis of its top vertex, and its middle height). */
const O: Pt = [33.1545, 32];
const S = Math.sin((32 * Math.PI) / 180);
const C = Math.cos((32 * Math.PI) / 180);
/** Outward normals of the hexagon's edges, from the top right one round over the top to the bottom right one, then the right. */
const N: Pt[] = [
  [S, -C],
  [-S, -C],
  [-1, 0],
  [-S, C],
  [S, C],
  [1, 0],
];
/** Each edge's distance from O. */
const P = [25.252, 25.252, 25.1545, 25.252, 25.252, 25.1545];
/** Corner radii: the rounder top and bottom, the tighter side corners. */
const R = [13.41, 4.866, 4.866, 13.41];
/** The jaws' cut: a line from each jaw's inner tip out past its outer corner. */
const CUT_AT: Pt = [44.225, 28.373];
const CUT_DIR: Pt = [10.39, -9.031];

/** Where the lines n_a.x = d_a and n_b.x = d_b meet (x relative to O). */
function meet(a: Pt, da: number, b: Pt, db: number): Pt {
  const det = a[0] * b[1] - a[1] * b[0];
  return [(da * b[1] - db * a[1]) / det, (a[0] * db - b[0] * da) / det];
}

const f = (n: number) => n.toFixed(3);
const at = (p: Pt) => `${f(O[0] + p[0])} ${f(O[1] + p[1])}`;
const add = (p: Pt, n: Pt, k: number): Pt => [p[0] + n[0] * k, p[1] + n[1] * k];

/** Where edge `i` at distance `d` meets the cut (mirrored below for the bottom jaw), relative to O. */
function onCut(i: number, d: number, below: boolean): Pt {
  const q: Pt = [CUT_AT[0] - O[0], below ? O[1] - CUT_AT[1] : CUT_AT[1] - O[1]];
  const w: Pt = [CUT_DIR[0], below ? -CUT_DIR[1] : CUT_DIR[1]];
  const n = N[i]!;
  const t = (d - (n[0] * q[0] + n[1] * q[1])) / (n[0] * w[0] + n[1] * w[1]);
  return add(q, w, t);
}

/**
 * The hexagon with its edges at `dist` and corners rounded by `radii`, from
 * the top right edge round the left to the bottom right one: open on the right,
 * from `start` to `end`.
 */
function contour(dist: number[], radii: number[], start: Pt, end: Pt): string {
  let d = `M${at(start)}`;
  for (let i = 0; i < 4; i++) {
    const r = radii[i]!;
    const [a, b] = [N[i]!, N[i + 1]!];
    const c = meet(a, dist[i]! - r, b, dist[i + 1]! - r);
    d += `L${at(add(c, a, r))}A${f(r)} ${f(r)} 0 0 0 ${at(add(c, b, r))}`;
  }
  return `${d}L${at(end)}`;
}

/** Lines inside the letter, `s` units in from its outer edge (clipped to the silhouette). */
function inset(s: number): string {
  const dist = P.map((p) => p - s);
  const radii = R.map((r) => Math.max(r - s, 0.6));
  const start = meet(N[5]!, dist[5]!, N[0]!, dist[0]!);
  const end = meet(N[4]!, dist[4]!, N[5]!, dist[5]!);
  return contour(dist, radii, start, end);
}

/** An echo: the hexagon scaled up by `k`, its ends on the jaws' cuts drawn on outwards. */
function echo(k: number): string {
  const dist = P.map((p) => p * k);
  return contour(
    dist,
    R.map((r) => r * k),
    onCut(0, dist[0]!, false),
    onCut(4, dist[4]!, true),
  );
}

/** The letter: lines 2 units (8 px in the 1200 box) apart, fading a little inwards. */
const BAND = Array.from({ length: 9 }, (_, i) => ({ d: inset(2 + i * 2), o: 0.3 - i * 0.018 }));
/** The echoes: the first 26 px out from the letter in the 1200 box, then wider apart, fading out. */
const ECHOES = Array.from({ length: 20 }, (_, i) => {
  const gap = (26 + i * 24 + i * i * 0.6) / 4;
  return { d: echo((P[0]! + gap) / P[0]!), o: 0.14 * Math.pow(0.87, i) };
});
const PLACE = `translate(600 600) scale(4) translate(${-O[0]} ${-O[1]})`;
const SILHOUETTE = MASTERS['16'].body;

export function EngravedC({ className }: { className?: string }) {
  const clip = `engraved-${useId().replace(/:/g, '')}`;
  return (
    <svg
      className={className ? `engraved-c ${className}` : 'engraved-c'}
      viewBox="0 0 1200 1200"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clip} clipPathUnits="userSpaceOnUse">
          <path d={SILHOUETTE} />
        </clipPath>
      </defs>
      <g transform={PLACE}>
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d={SILHOUETTE} strokeOpacity={0.34} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
          <g clipPath={`url(#${clip})`}>
            {BAND.map(({ d, o }) => (
              <path key={d} d={d} strokeOpacity={o} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
          {ECHOES.map(({ d, o }) => (
            <path key={d} d={d} strokeOpacity={o} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        <path
          className="engraved-facet"
          d={MASTERS['16'].facet}
          strokeWidth={1}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}

/**
 * One step of Create or Restore: the brand and a quiet "Step n of 3" above a
 * centred card that holds the step's <Screen>.
 */
export function Flow({ step, total = 3, children }: { step: number; total?: number; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flow">
      <EngravedC className="flow-motif" />
      <header className="flow-top">
        <BrandLockup />
        <p className="flow-step">
          <span>{t('flow.step', { n: step, total })}</span>
          <span className="flow-rule" aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={i < step ? 'on' : undefined} />
            ))}
          </span>
        </p>
      </header>
      <div className="flow-card">{children}</div>
    </div>
  );
}
