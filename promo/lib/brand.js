// Brand drawings for scenes, as SVG strings. All paths come from the wallet's own source
// (promo/lib/gen-brand.mjs -> brand-data.js); the engraved "C" repeats EngravedC in
// src/screens/AccountLayout.tsx, the same construction and numbers.
import { ICONS, MARK_FULL, MARK_SMALL, WORDMARK } from './brand-data.js';

/** The faceted "C" mark. Body takes currentColor, the facet is gold. `size` = height in px (crop aspect kept). */
export function markSVG(size = 160, { facet = 'var(--brand-facet)', cls = '' } = {}) {
  const [x, y, w, h] = MARK_FULL.crop.split(' ').map(Number);
  return `<svg class="${cls}" viewBox="${MARK_FULL.crop}" width="${(size * w) / h}" height="${size}" overflow="visible"><path fill="currentColor" d="${MARK_FULL.body}"/><path class="facet" fill="${facet}" d="${MARK_FULL.facet}"/></svg>`;
}

/** The drawn word "Celari", `height` px tall. */
export function wordmarkSVG(height = 60, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 359.11 104.29" width="${(height * 359.11) / 104.29}" height="${height}"><path fill="currentColor" d="${WORDMARK}"/></svg>`;
}

/** Mark and name side by side (the app's lockup proportions): `h` is the mark's height. */
export function lockupHTML(h = 120) {
  const wh = h * 0.5423;
  return `<div class="row" style="align-items:center;gap:${h * 0.31 * 0.6}px">${markSVG(h)}${wordmarkSVG(wh)}</div>`;
}

/** A 24px-grid line icon from the wallet's icon set (balance, send, receive, history, settings, lock, eye, eyeOff, shield, shieldIn, copy, info, alert, error, okCircle, clock, sync, key, server, globe, external, qr). */
export function iconSVG(name, size = 40, { stroke = 1.5, cls = 'icon' } = {}) {
  if (!ICONS[name]) throw new Error(`no icon ${name}`);
  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

// ---- the engraved C -----------------------------------------------------------------------------
const O = [33.1545, 32.0];
const SN = Math.sin((32 * Math.PI) / 180), CS = Math.cos((32 * Math.PI) / 180);
const N = [[SN, -CS], [-SN, -CS], [-1, 0], [-SN, CS], [SN, CS], [1, 0]];
const P = [25.252, 25.252, 25.1545, 25.252, 25.252, 25.1545];
const R = [13.41, 4.866, 4.866, 13.41];
const CUT_AT = [44.225, 28.373], CUT_DIR = [10.39, -9.031];
const num = (n) => +n.toFixed(2);
const meet = (a, da, b, db) => {
  const det = a[0] * b[1] - a[1] * b[0];
  return [(da * b[1] - db * a[1]) / det, (a[0] * db - b[0] * da) / det];
};
const add = (p, n, k) => [p[0] + n[0] * k, p[1] + n[1] * k];
const at = (p, box) => (box ? `${num(600 + 4 * p[0])} ${num(600 + 4 * p[1])}` : `${num(O[0] + p[0])} ${num(O[1] + p[1])}`);
function onCut(i, d, below) {
  const q = [CUT_AT[0] - O[0], below ? O[1] - CUT_AT[1] : CUT_AT[1] - O[1]];
  const w = [CUT_DIR[0], below ? -CUT_DIR[1] : CUT_DIR[1]];
  const n = N[i];
  const t = (d - (n[0] * q[0] + n[1] * q[1])) / (n[0] * w[0] + n[1] * w[1]);
  return add(q, w, t);
}
function contour(dist, radii, start, end, box) {
  const k = box ? 4 : 1;
  let d = `M${at(start, box)}`;
  for (let i = 0; i < 4; i++) {
    const r = radii[i];
    const [a, b] = [N[i], N[i + 1]];
    const c = meet(a, dist[i] - r, b, dist[i + 1] - r);
    d += `L${at(add(c, a, r), box)}A${num(r * k)} ${num(r * k)} 0 0 0 ${at(add(c, b, r), box)}`;
  }
  return `${d}L${at(end, box)}`;
}
const inset = (s) => {
  const dist = P.map((p) => p - s);
  const radii = R.map((r) => Math.max(r - s, 0.6));
  return contour(dist, radii, meet(N[5], dist[5], N[0], dist[0]), meet(N[4], dist[4], N[5], dist[5]), false);
};
const echo = (k) => {
  const dist = P.map((p) => p * k);
  return contour(dist, R.map((r) => r * k), onCut(0, dist[0], false), onCut(4, dist[4], true), true);
};

/**
 * The engraved C as an SVG in a 1200 box (centre 600,600). Class hooks for animation:
 *   .ec-sil (silhouette outline), .ec-band (9 inner lines, i = data-i), .ec-echo (20 outward echoes, data-i),
 *   .ec-facet (the gold facet). Lines are ~1 px wide at the given size; draw them with the
 *   `draw` track, and fade them with opacity. Colours: stroke currentColor, facet var(--accent).
 */
export function engravedCSVG(size = 1200, { echoes = 20 } = {}) {
  const sil = MARK_SMALL.body, facet = MARK_SMALL.facet;
  const PLACE = `translate(600 600) scale(4) translate(${-O[0]} ${-O[1]})`;
  // Lines are ~1 device px wide at `size`: widths are given in user units (1200-box; the PLACE group is x4),
  // because vector-effect:non-scaling-stroke would break the stroke-dasharray the `draw` track relies on.
  const u = 1200 / size, ub = u / 4;
  const NS = '';
  const band = Array.from({ length: 9 }, (_, i) => `<path class="ec-band" data-i="${i}" d="${inset(2 + i * 2)}" stroke-opacity="${(0.3 - i * 0.018).toFixed(3)}" stroke-width="${ub.toFixed(4)}"/>`).join('');
  const ech = Array.from({ length: echoes }, (_, i) => {
    const gap = (26 + i * 24 + i * i * 0.6) / 4;
    return `<path class="ec-echo" data-i="${i}" d="${echo((P[0] + gap) / P[0])}" stroke-opacity="${(0.14 * 0.87 ** i).toFixed(3)}" stroke-width="${u.toFixed(4)}"/>`;
  }).join('');
  return `<svg class="engraved" viewBox="0 0 1200 1200" width="${size}" height="${size}" overflow="visible">
    <defs><clipPath id="ec-clip" clipPathUnits="userSpaceOnUse"><path d="${sil}"/></clipPath></defs>
    <g fill="none" stroke="currentColor" stroke-linecap="butt" stroke-linejoin="round">
      <g class="ec-echoes">${ech}</g>
      <g transform="${PLACE}"><path class="ec-sil" d="${sil}" stroke-opacity="0.34" stroke-width="${(ub * 1.25).toFixed(4)}"/><g clip-path="url(#ec-clip)">${band}</g></g>
    </g>
    <g transform="${PLACE}"><path class="ec-facet" d="${facet}" fill="none" stroke="var(--accent)" stroke-width="${(ub * 1.2).toFixed(4)}" stroke-linejoin="round"/><path class="ec-facet-fill" d="${facet}" fill="var(--accent)" fill-opacity="0"/></g>
  </svg>`;
}
