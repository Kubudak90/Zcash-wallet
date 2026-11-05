// The shared "tutorial" layout: every usage scene (storyboard act 2) is built on it, so consecutive scenes
// dissolve into each other with the window standing still and only the content and the panel changing.
//
//   canvas 1920x1080:  [ browser window with the real UI  1178x998 ]  [ step panel 576 wide ]
//
//   const s = new Scene({ duration: 10 });
//   const sh = tutorialShell(s, document.getElementById('stage'), { P, step: 3, total: 8, title: '…', sub: '…' });
//   const a = sh.plate('password'), b = sh.plate('password-filled');     // <img>s inside the window, under the cursor
//   s.swap([a, b], [0, 4]);                                              // plates crossfade
//   sh.cursor([{ t: 1, x: 400, y: 300 }, { t: 2, x: 500, y: 420, click: true }]);   // plate px
//   sh.note('…', 3.0);                                                   // a card in the panel
//   sh.ring(sh.rect('password', 'pw1'), 1.0, 3.0);                       // highlight a captured element
//   sh.camera([{ t: 0, rect: null }, { t: 4, rect: sh.rect('password', 'pw1'), fill: 0.6 }, { t: 7, rect: null }]);
//   await s.start();
//
// Coordinates: "plate px" are the CSS pixels of the captured 1280x1040 viewport (plates.json targets use them).
import { lang, pick, plateEl, rectOf } from '/lib/stage.js';
import { iconSVG } from '/lib/brand.js';

export const WIN = { x: 48, y: 41, w: 1178, h: 998, scale: 0.92, bar: 44, plateW: 1280, plateH: 1040 };
const WORDS = { tr: 'Adım', en: 'Step' };
const DEMO = { tr: 'Ekrandaki bakiyeler, adresler, işlemler ve kelimeler demo verisidir.', en: 'Balances, addresses, transactions and words on screen are demo data.' };

const CURSOR_SVG = `<svg viewBox="0 0 34 40"><path d="M3 2 L3 31 L10.5 24.5 L15.5 36 L20.5 34 L15.6 22.8 L25.5 22.2 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>`;

export function tutorialShell(s, stage, { P, step, total = 8, title, sub = '', first = false, device = 'desktop' }) {
  const k = WIN.scale;
  stage.innerHTML = `
    <div class="glow"></div>
    <div id="winshadow" style="position:absolute;left:${WIN.x}px;top:${WIN.y}px;width:${WIN.w}px;height:${WIN.h}px;border-radius:16px;box-shadow:0 0 0 1.5px var(--border-2),0 60px 120px -40px rgba(0,0,0,.85),0 0 160px -50px rgba(244,183,40,.2);background:var(--bg)"></div>
    <div id="winclip" style="position:absolute;left:${WIN.x}px;top:${WIN.y}px;width:${WIN.w}px;height:${WIN.h}px;overflow:hidden;border-radius:16px">
      <div id="zoom" class="cam" style="width:${WIN.w}px;height:${WIN.h}px">
        <div class="browser" id="win" style="left:0;top:0;width:${WIN.plateW}px;border:0;border-radius:0;box-shadow:none;transform:scale(${k})">
          <div class="bar"><i></i><i></i><i></i><div class="url"><svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2.25"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>app.celariwallet.com</div></div>
          <div class="screen" id="screen" style="width:${WIN.plateW}px;height:${WIN.plateH}px"><div class="cursor" id="cursor">${CURSOR_SVG}</div></div>
        </div>
        <div id="overlays" class="abs" style="left:0;top:0;width:${WIN.w}px;height:${WIN.h}px"></div>
      </div>
    </div>
    <div id="panel" style="position:absolute;left:1296px;top:0;width:576px;height:1080px;display:flex;flex-direction:column;padding-top:92px">
      <div id="pbody" style="display:flex;flex-direction:column">
        <div id="badge" class="stepbadge"><span class="num">${step}</span><span>${WORDS[lang]} ${step} / ${total}</span></div>
        <h2 id="title" class="display" style="margin:34px 0 0;font-size:62px">${title}</h2>
        <p id="sub" class="lede" style="margin:26px 0 0;font-size:29px;line-height:1.45">${sub}</p>
        <div id="notes" style="margin-top:36px;display:flex;flex-direction:column;gap:16px"></div>
      </div>
      <!-- the demo-data statement and the rail stay inside the 80 px safe margin (text bottom 1004 px, right edge 1840 px) -->
      <div id="demo" style="position:absolute;left:0;bottom:76px;width:544px;font-size:22px;line-height:1.35;color:var(--muted);text-wrap:balance">${DEMO[lang]}</div>
      <div id="rail" style="position:absolute;left:0;bottom:156px;width:544px;display:flex;gap:10px">${Array.from({ length: total }, (_, i) => `<i style="flex:1;height:5px;border-radius:3px;background:${i + 1 < step ? 'rgba(244,183,40,.45)' : i + 1 === step ? 'var(--accent)' : 'var(--border-2)'}"></i>`).join('')}</div>
    </div>
    <div class="vignette"></div><div class="grain" id="grain"></div>`;
  const $ = (id) => stage.querySelector('#' + id);
  const screen = $('screen'), cursorEl = $('cursor'), overlays = $('overlays');
  s.grain($('grain'));

  // Entrance: the very first tutorial scene brings the window in; the others stand still and dissolve.
  if (first) {
    s.track($('winshadow'), { opacity: [[0, 0], [0.7, 1, 'inOut']] });
    s.track($('winclip'), { opacity: [[0, 0], [0.7, 1, 'inOut']], y: [[0, 36], [1.0, 0, 'out']] });
  }
  // Panel text at a hand-over: the old title/notes fade out inside the last dissolve (0.5 s) and the new ones come in
  // after its midpoint, so two big titles are never printed over each other. The window itself keeps dissolving.
  const pa = first ? 0.35 : 0.3;
  s.track($('pbody'), { opacity: [[s.duration - 0.5, 1], [s.duration - 0.12, 0]] });
  s.track($('badge'), { opacity: [[pa, 0], [pa + 0.45, 1]], y: [[pa, 14], [pa + 0.55, 0, 'out']] });
  s.track($('title'), { opacity: [[pa + 0.1, 0], [pa + 0.6, 1]], y: [[pa + 0.1, 18], [pa + 0.75, 0, 'out']] });
  s.track($('sub'), { opacity: [[pa + 0.25, 0], [pa + 0.75, 1]], y: [[pa + 0.25, 18], [pa + 0.9, 0, 'out']] });

  const toZoom = (r) => ({ x: r.x * k, y: (WIN.bar + r.y) * k, w: r.w * k, h: r.h * k });
  const sh = {
    s, screen, cursorEl, overlays, WIN, toZoom,
    /** An <img> of a captured plate inside the window (under the cursor). Add it to s.swap([...]) to sequence plates. */
    plate(name) {
      const img = plateEl(P, name);
      screen.insertBefore(img, cursorEl);
      return img;
    },
    /** A captured element's box in plate px. */
    rect: (name, key) => rectOf(P, name, key),
    /** Cursor path in plate px (see Scene.cursor). */
    cursor: (points, opts) => s.cursor(cursorEl, points, opts),
    /** Camera on the window: shots [{ t, rect (plate px | null), fill?, ease? }]. */
    camera(shots) {
      s.camera($('zoom'), shots.map((x) => ({ ...x, rect: x.rect ? toZoom(x.rect) : null })), { vw: WIN.w, vh: WIN.h });
    },
    /** A gold ring around a plate rect, visible t0..t1 (it gently pulses). */
    ring(rect, t0, t1, { pad = 8 } = {}) {
      const z = toZoom(rect);
      const el = document.createElement('div');
      el.className = 'hl';
      el.style.cssText = `left:${z.x - pad}px;top:${z.y - pad}px;width:${z.w + 2 * pad}px;height:${z.h + 2 * pad}px;border-radius:${12 + pad}px`;
      overlays.append(el);
      s.track(el, { opacity: [[t0, 0], [t0 + 0.35, 1], [t1 - 0.35, 1], [t1, 0]], scale: [[t0, 1.06], [t0 + 0.45, 1, 'out']] });
      return el;
    },
    /** A numbered callout next to a plate rect. side: 'right' | 'left' | 'above' | 'below'. */
    callout(rect, text, t0, t1, { side = 'right', n = null, dx = 0, dy = 0, maxWidth = 480 } = {}) {
      const z = toZoom(rect);
      const el = document.createElement('div');
      el.className = 'callout';
      el.style.maxWidth = `${maxWidth}px`;
      el.style.fontSize = '24px';
      el.innerHTML = (n != null ? `<span class="n">${n}</span>` : '') + `<span>${text}</span>`;
      let left, top, tx = '0px', ty = '0px';
      if (side === 'right') [left, top, ty] = [z.x + z.w + 22, z.y + z.h / 2, '-50%'];
      if (side === 'left') [left, top, tx, ty] = [z.x - 22, z.y + z.h / 2, '-100%', '-50%'];
      if (side === 'below') [left, top, tx] = [z.x + z.w / 2, z.y + z.h + 20, '-50%'];
      if (side === 'above') [left, top, tx, ty] = [z.x + z.w / 2, z.y - 20, '-50%', '-100%'];
      el.style.left = `${left + dx}px`;
      el.style.top = `${top + dy}px`;
      // the individual `translate` property anchors the card; the track below only moves `transform`
      el.style.translate = `${tx} ${ty}`;
      overlays.append(el);
      s.track(el, { opacity: [[t0, 0], [t0 + 0.4, 1], [t1 - 0.4, 1], [t1, 0]], y: [[t0, 12], [t0 + 0.5, 0, 'out']] });
      return el;
    },
    /** A card in the panel under the lede: appears at t (and stays). icon: a wallet icon name. tone: 'sage' | 'copper' | 'gold'. */
    note(html, t, { icon = 'okCircle', tone = 'gold' } = {}) {
      const el = document.createElement('div');
      el.className = 'callout';
      el.style.cssText = 'position:relative;max-width:576px;font-size:26px;align-items:center;gap:16px;padding:18px 24px 18px 20px';
      const col = tone === 'sage' ? 'var(--shielded)' : tone === 'copper' ? 'var(--transparent)' : 'var(--accent-fg)';
      el.innerHTML = `<span style="color:${col};flex:none">${iconSVG(icon, 34)}</span><span>${html}</span>`;
      $('notes').append(el);
      s.track(el, { opacity: [[t, 0], [t + 0.45, 1]], y: [[t, 16], [t + 0.6, 0, 'out']] });
      return el;
    },
  };
  return sh;
}
