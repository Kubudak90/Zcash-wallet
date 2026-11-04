// Celari video stage: a deterministic, frame-addressable timeline.
//
// A scene is a pure function of time. The renderer (promo/render.mjs) calls window.__seek(t) for every
// frame and takes a screenshot; nothing runs on its own clock, so renders are reproducible. Open a scene
// at http://localhost:PORT/scenes/<id>/index.html?lang=tr&t=3.2 to freeze it at 3.2 s, or &play=1 to
// preview it in real time in a browser.
//
//   import { Scene, ease, lang, pick, loadPlates, plateEl, rectOf } from '/lib/stage.js';
//   const s = new Scene({ duration: 10 });
//   s.track(el, { opacity: [[0, 0], [0.6, 1], [9.4, 1], [10, 0]], y: [[0, 40], [0.9, 0, 'out']] });
//   await s.start();            // waits for fonts + images, seeks to 0, sets window.__ready
//
// Keyframes are [time, value, easing?]; the easing shapes the segment that ENDS at that keyframe
// (default 'out'). Before the first keyframe a property holds its first value, after the last its last.

export const params = new URLSearchParams(location.search);
export const lang = params.get('lang') === 'en' ? 'en' : 'tr';
/** pick({ tr: '…', en: '…' }) -> the text of the language being rendered. */
export const pick = (o) => o[lang];
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, p) => a + (b - a) * p;

// ---- easing ---------------------------------------------------------------------------------------
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-6) break;
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return Y(clamp(t));
  };
}
export const ease = {
  linear: (p) => p,
  out: bezier(0.2, 0.7, 0.2, 1), // the wallet's own --ease
  inOut: bezier(0.65, 0, 0.35, 1),
  in: bezier(0.5, 0, 0.9, 0.4),
  soft: bezier(0.33, 0, 0.2, 1),
  smooth: (p) => p * p * (3 - 2 * p),
  outBack: bezier(0.2, 1.35, 0.35, 1),
  spring: (p) => (p >= 1 ? 1 : 1 - Math.exp(-7 * p) * Math.cos(10 * p)),
  hold: (p) => (p >= 1 ? 1 : 0), // stay at the previous value until the keyframe, then jump
  bezier,
};
const easeFn = (e) => (typeof e === 'function' ? e : ease[e ?? 'out'] ?? ease.out);

/** Value of keyframes [[t, v, ease?], …] at time t. */
export function sample(kfs, t) {
  const n = kfs.length;
  if (t <= kfs[0][0]) return kfs[0][1];
  for (let i = 1; i < n; i++) {
    if (t < kfs[i][0]) {
      const [t0, v0] = kfs[i - 1];
      const [t1, v1, e] = kfs[i];
      return v0 + (v1 - v0) * easeFn(e)((t - t0) / (t1 - t0));
    }
  }
  return kfs[n - 1][1];
}

/** Deterministic pseudo-random in [0,1) from an integer (for human-looking typing rhythm). */
export const hash01 = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---- plates (real UI screenshots, promo/plates) ----------------------------------------------------
let platesCache = null;
/** The plate manifest for the language being rendered: { name: { file, w, h, scale, targets } }. */
export async function loadPlates(device = 'desktop') {
  platesCache ??= await (await fetch('/plates/plates.json')).json();
  const set = platesCache[`${lang}.${device}`];
  if (!set) throw new Error(`no plates for ${lang}.${device}`);
  return set;
}
/** An <img> sized to the plate's CSS pixels (the PNG is retina, so it is sharp up to 2x zoom). */
export function plateEl(P, name) {
  const p = P[name];
  if (!p) throw new Error(`unknown plate ${name}`);
  const img = document.createElement('img');
  img.src = `/plates/${p.file}`;
  img.width = p.w;
  img.height = p.h;
  img.style.width = `${p.w}px`;
  img.style.height = `${p.h}px`;
  img.alt = '';
  return img;
}
/** A plate target's box {x,y,w,h} in the plate's CSS pixels (throws when the capture did not find it). */
export function rectOf(P, name, key) {
  const r = P[name]?.targets?.[key];
  if (!r) throw new Error(`plate ${name} has no target ${key}`);
  return r;
}

// ---- the scene ------------------------------------------------------------------------------------
const TRANSFORM_KEYS = ['x', 'y', 'rotate', 'scale', 'scaleX', 'scaleY'];

export class Scene {
  constructor({ duration }) {
    this.duration = duration;
    this.items = [];
    this.callbacks = [];
    this.t = 0;
    window.__duration = duration;
    window.__ready = false;
    window.__seek = (t) => this.seek(t);
  }

  /**
   * Animate numeric properties of an element: x, y (px), rotate (deg), scale / scaleX / scaleY, opacity,
   * blur (px), brightness, w / h (px), clipT / clipR / clipB / clipL (inset %, of the element's box),
   * draw (0..1: stroke-draws an SVG path/line, which gets pathLength=1), and any CSS variable ('--k').
   * opts.origin sets transform-origin (default: the element's own).
   */
  track(el, spec, opts = {}) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) throw new Error('track: element not found');
    if (opts.origin) el.style.transformOrigin = opts.origin;
    if (spec.draw) el.setAttribute('pathLength', '1');
    this.items.push({ el, spec });
    return el;
  }

  /** Several elements, each starting `gap` seconds after the previous one: fn(el, i) -> spec shifted by i*gap. */
  stagger(els, gap, fn) {
    [...els].forEach((el, i) => this.track(el, fn(el, i, i * gap)));
  }

  /** Called with t after every track has been applied, for text, counters and anything not numeric. */
  on(fn) {
    this.callbacks.push(fn);
  }

  /** Types `text` into el from t0, ~cps characters per second with a human rhythm; shows a blinking caret. */
  type(el, text, t0, { cps = 16, caret = true, hideCaretAfter = Infinity } = {}) {
    if (typeof el === 'string') el = document.querySelector(el);
    const node = document.createTextNode('');
    el.textContent = '';
    el.append(node);
    let c = null;
    if (caret) {
      c = document.createElement('span');
      c.className = 'caret';
      el.append(c);
    }
    const chars = Array.from(text);
    const stamps = [];
    let acc = t0;
    for (let i = 0; i < chars.length; i++) {
      stamps.push(acc);
      acc += (1 / cps) * (0.55 + 0.9 * hash01(i + chars.length));
    }
    const end = acc;
    this.on((t) => {
      let n = 0;
      while (n < stamps.length && stamps[n] <= t) n++;
      node.nodeValue = chars.slice(0, n).join('');
      if (c) {
        const typing = t >= t0 && t < end;
        c.style.opacity = t < t0 - 0.3 || t > hideCaretAfter ? 0 : typing || Math.floor(t * 2) % 2 === 0 ? 1 : 0;
      }
    });
    return end;
  }

  /** Counts a number up/down: fmt(value) -> string. */
  count(el, { from, to, t0, t1, fmt = (v) => String(Math.round(v)), ease: e = 'out' }) {
    if (typeof el === 'string') el = document.querySelector(el);
    this.on((t) => {
      el.textContent = fmt(from + (to - from) * easeFn(e)(clamp((t - t0) / (t1 - t0))));
    });
  }

  /**
   * A plate stack (use ONE swap per container; a second group needs its own `z` base, e.g. z: 20): same-size layers stacked in order, layer i crossfading in over `fade` s starting at
   * times[i] and staying (later layers cover it). The first layer is simply visible from the start when
   * times[0] <= 0. To fade the whole stack away, track the stack's container.
   */
  swap(els, times, { fade = 0.3, z = 0 } = {}) {
    els.forEach((el, i) => {
      el.style.zIndex = String(z + i + 1);
      const visibleFromStart = i === 0 && times[0] <= 0;
      this.track(el, { opacity: visibleFromStart ? [[0, 1]] : [[times[i], 0], [times[i] + fade, 1, 'inOut']] });
    });
  }

  /**
   * Reveals `img` (a filled-in plate stacked over an empty one) left to right inside `rect` (plate px),
   * like typing: the rest of the image stays clipped away.
   */
  reveal(img, rect, t0, t1, e = 'linear') {
    const W = img.width || parseFloat(img.style.width), H = img.height || parseFloat(img.style.height);
    const T = (rect.y / H) * 100, B = ((H - rect.y - rect.h) / H) * 100, L = (rect.x / W) * 100;
    const R0 = 100 - L, R1 = 100 - ((rect.x + rect.w) / W) * 100;
    this.track(img, { clipT: [[0, T]], clipB: [[0, B]], clipL: [[0, L]], clipR: [[t0, R0], [t1, R1, e]] });
  }

  /**
   * An animated cursor. `el` is a .cursor element (0x0, its child svg draws the arrow) inside the layer whose
   * coordinates the points use. points: [{ t, x, y, click?, ease? }]: the cursor is at (x, y) at time t,
   * travelling from the previous point with a slight curve. A click presses the cursor and shows a ripple.
   * opts.appear / opts.leave: seconds of fade before the first point / after the last (leave: absolute time).
   */
  cursor(el, points, { appear = 0.35, leave = null } = {}) {
    const first = points[0];
    const xs = [[first.t - appear, first.x]], ys = [[first.t - appear, first.y]];
    const sc = [[0, 1]];
    points.forEach((p, i) => {
      if (i > 0 && p.from != null) {
        // wait where it is until p.from, then travel
        xs.push([p.from, points[i - 1].x]);
        ys.push([p.from, points[i - 1].y]);
      }
      if (i > 0) {
        xs.push([p.t, p.x, p.ease ?? 'inOut']);
        ys.push([p.t, p.y, p.ease ?? ease.bezier(0.45, 0.05, 0.25, 1)]);
      } else xs.push([p.t, p.x]), ys.push([p.t, p.y]);
      // hold position until the next point's travel starts (travel time is the segment before it)
      if (p.click) {
        sc.push([p.t, 1], [p.t + 0.09, 0.86, 'out'], [p.t + 0.24, 1, 'out']);
        const r = document.createElement('div');
        r.className = 'ripple';
        r.style.left = `${p.x - 36}px`;
        r.style.top = `${p.y - 36}px`;
        el.parentElement.insertBefore(r, el);
        this.track(r, { scale: [[p.t, 0.25], [p.t + 0.6, 1.5, 'out']], opacity: [[p.t, 0], [p.t + 0.02, 0.9, 'linear'], [p.t + 0.6, 0, 'out']] });
      }
    });
    const last = points[points.length - 1];
    const op = [[first.t - appear, 0], [first.t, 1, 'linear']];
    if (leave != null) op.push([leave, 1], [leave + 0.4, 0, 'inOut']);
    this.track(el, { x: xs, y: ys, scale: sc, opacity: op }, { origin: '0 0' });
    return last;
  }

  /**
   * Camera: moves/zooms `el` (a .cam wrapper at 1920x1080 in canvas space) so that shots[i].rect (in the
   * wrapper's own coordinates) fills `fill` of the frame at time shots[i].t. rect = null -> the full frame.
   * shots: [{ t, rect, fill?, ease? }]. Zoom is interpolated in log space and the centre linearly, so a move
   * reads as one camera, not a drifting layer.
   */
  camera(el, shots, { vw = 1920, vh = 1080 } = {}) {
    if (typeof el === 'string') el = document.querySelector(el);
    el.style.transformOrigin = '0 0';
    const state = shots.map((s) => {
      if (!s.rect) return { t: s.t, cx: vw / 2, cy: vh / 2, lz: 0, e: s.ease };
      const f = s.fill ?? 0.8;
      const z = Math.min((vw * f) / s.rect.w, (vh * f) / s.rect.h);
      return { t: s.t, cx: s.rect.x + s.rect.w / 2, cy: s.rect.y + s.rect.h / 2, lz: Math.log(z), e: s.ease };
    });
    this.on((t) => {
      let a = state[0], b = state[0], p = 0;
      if (t >= state[state.length - 1].t) a = b = state[state.length - 1];
      else if (t > state[0].t) {
        for (let i = 1; i < state.length; i++) {
          if (t < state[i].t) {
            a = state[i - 1];
            b = state[i];
            p = easeFn(b.e ?? 'inOut')((t - a.t) / (b.t - a.t));
            break;
          }
        }
      }
      const cx = lerp(a.cx, b.cx, p), cy = lerp(a.cy, b.cy, p), z = Math.exp(lerp(a.lz, b.lz, p));
      el.style.transform = `translate(${(vw / 2 - cx * z).toFixed(2)}px, ${(vh / 2 - cy * z).toFixed(2)}px) scale(${z.toFixed(5)})`;
    });
  }

  /** The grain overlay jitters per frame like film (deterministic). */
  grain(el) {
    this.on((t) => {
      const f = Math.floor(t * 24);
      el.style.transform = `translate(${Math.round(hash01(f) * 64 - 32)}px, ${Math.round(hash01(f + 91) * 64 - 32)}px)`;
    });
  }

  seek(t) {
    this.t = t;
    for (const { el, spec } of this.items) apply(el, spec, t);
    for (const f of this.callbacks) f(t);
  }

  /** Waits for fonts and images, seeks to the first frame, and tells the renderer the scene is ready. */
  async start() {
    const sample = 'ÇçĞğİıÖöŞşÜü ’“”…→·×0123456789';
    await Promise.all([
      document.fonts.load('400 40px "Fraunces Variable"', sample),
      document.fonts.load('italic 400 40px "Fraunces Variable"', sample),
      document.fonts.load('500 24px "Geist Variable"', sample),
      document.fonts.load('600 24px "Geist Variable"', sample),
      document.fonts.load('500 24px "Geist Mono Variable"', sample),
    ]);
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    const tFixed = params.get('t');
    this.seek(tFixed != null ? parseFloat(tFixed) : 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__ready = true;
    if (params.get('play')) {
      const t0 = performance.now();
      const loop = () => {
        this.seek(((performance.now() - t0) / 1000) % this.duration);
        requestAnimationFrame(loop);
      };
      loop();
    }
  }
}

function apply(el, spec, t) {
  const v = {};
  for (const k in spec) v[k] = sample(spec[k], t);

  if (TRANSFORM_KEYS.some((k) => k in v)) {
    const sx = v.scaleX ?? v.scale ?? 1, sy = v.scaleY ?? v.scale ?? 1;
    el.style.transform = `translate(${(v.x ?? 0).toFixed(2)}px, ${(v.y ?? 0).toFixed(2)}px) rotate(${(v.rotate ?? 0).toFixed(3)}deg) scale(${sx.toFixed(5)}, ${sy.toFixed(5)})`;
  }
  if ('opacity' in v) {
    el.style.opacity = v.opacity.toFixed(4);
    el.style.visibility = v.opacity <= 0.001 ? 'hidden' : '';
  }
  if ('blur' in v || 'brightness' in v) {
    const f = [];
    if ('blur' in v && v.blur > 0.05) f.push(`blur(${v.blur.toFixed(2)}px)`);
    if ('brightness' in v) f.push(`brightness(${v.brightness.toFixed(3)})`);
    el.style.filter = f.join(' ') || 'none';
  }
  if ('w' in v) el.style.width = `${v.w.toFixed(2)}px`;
  if ('h' in v) el.style.height = `${v.h.toFixed(2)}px`;
  if ('clipT' in v || 'clipR' in v || 'clipB' in v || 'clipL' in v) {
    const p = (k) => (v[k] ?? 0).toFixed(3);
    el.style.clipPath = `inset(${p('clipT')}% ${p('clipR')}% ${p('clipB')}% ${p('clipL')}%)`;
  }
  if ('draw' in v) {
    el.style.strokeDasharray = '1 1';
    el.style.strokeDashoffset = (1 - clamp(v.draw)).toFixed(4);
  }
  for (const k in v) if (k.startsWith('--')) el.style.setProperty(k, v[k].toFixed(4));
}
