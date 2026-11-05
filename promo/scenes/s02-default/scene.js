// s02-default (11.5 s) · free-form · act 1, "privacy is the default".
// Two payment rows built like the wallet's History rows (same tokens, chips and proportions; motion graphics, not
// a UI screenshot): row A transparent, everything readable; row B shielded, the same scan finds nothing.
// Starts from the faint C + echo field that s01-open ends on, so the 0.5 s dissolve is only a text swap.
import { Scene, lang, pick, ease, sample } from '/lib/stage.js';
import { engravedCSVG, iconSVG } from '/lib/brand.js';

document.documentElement.lang = lang;

const T = {
  tr: {
    // storyboard headline (landing's "varsayılan" framing; welcome pillar2 "Varsayılan olarak gizli (shielded) adres")
    head: ['Gizlilik bir ayar değil,', '*varsayılan*.'],
    sent: 'Gönderildi',                                   // tr.ts history.type.sent
    confirmed: 'Onaylandı',                               // tr.ts history.status.confirmed
    chipA: 'Şeffaf · herkese açık',                       // tr.ts history.privacy.transparent
    chipB: 'Gizli (shielded)',                            // tr.ts history.privacy.shielded 'Gizli' + the required first-use gloss (tr.ts welcome.pillar2 'gizli (shielded)'): the chip is where the viewer first meets the word
    capA: 'Zincirde herkese açık.',                       // tr.ts home.transparentHelp (first sentence)
    capB: 'Tutar ve taraflar zincirde görünmez.',         // tr.ts home.shieldedHelp
    noteB: 'Bir havuzdan diğerine geçen değer hariç.',    // tr.ts home.shieldedHelp ("... dışında")
    foot: 'Al ekranı her açılışta yeni, yalnızca gizli (shielded) bir adres gösterir.', // README Features "Private by default"; "(shielded)" is repeated here (the first-use gloss is already on chipB), as in tr.ts welcome.pillar2
    demo: 'Örnek ödeme · demo verisi',                    // BUILD.md "Plates": demo data, as the s05 chip
    num: (v) => v,
  },
  en: {
    head: ['Privacy isn’t a setting.', 'It’s the *default*.'],
    sent: 'Sent',                                         // en.ts history.type.sent
    confirmed: 'Confirmed',                               // en.ts history.status.confirmed
    chipA: 'Transparent · public',                        // en.ts history.privacy.transparent
    chipB: 'Shielded',                                    // en.ts history.privacy.shielded
    capA: 'Public on chain.',                             // en.ts home.transparentHelp (first sentence)
    capB: 'Amounts and parties are not visible on chain.', // en.ts home.shieldedHelp
    noteB: 'Except value that moves from one pool to another.', // en.ts home.shieldedHelp
    foot: 'Receive shows a new, shielded-only address every time you open it.', // README Features "Private by default"
    demo: 'Example payment · demo data',
    num: (v) => v,
  },
};
const t = pick(T);
const AMOUNT = lang === 'tr' ? '−0,5001' : '−0.5001'; // the same demo payment as the History plate (−0,5001 ZEC)
const ADDR = 't1P5MNATu9kjDdN8xRP5tinAxXprsLKyjJY';    // the demo transparent address of the Receive plates (35 chars)

/** "a *b c* d." -> inline-block word spans (the emphasised words in <em>; punctuation right after the closing * stays attached). */
function words(line) {
  let em = false;
  return line.split(' ').filter(Boolean).map((tok) => {
    if (tok.startsWith('*')) { em = true; tok = tok.slice(1); }
    let inner = tok, tail = '';
    if (em && tok.includes('*')) { [inner, tail] = tok.split('*'); em = false; return `<span class="w"><em>${inner}</em>${tail}</span>`; }
    return `<span class="w">${em ? `<em>${inner}</em>` : inner}</span>`;
  }).join(' ');
}

// ---- geometry (canvas px) ---------------------------------------------------------------------------
const X = 96, W = 1728;           // rows: 96 px margins
const ROW = 156, FULL = 216;      // main row height, with the caption strip
const YA = 384, YB = 632;         // row tops (the demo label sits above row A)
const SIZE = 2400;                // the engraved C (same as s01-open)

const dots = (n, d, gap, cls) => Array.from({ length: n }, () => `<i class="${cls}" style="display:block;width:${d}px;height:${d}px;border-radius:50%;background:var(--muted);flex:none"></i>`).join('');

function rowHTML(k) {
  const A = k === 'A';
  const chip = A
    ? `<span class="chip copper" style="font-size:27px;padding:11px 24px"><span class="dot hollow"></span>${t.chipA}</span>`
    : `<span class="chip sage" style="font-size:27px;padding:11px 24px"><span class="dot"></span>${t.chipB}</span>`;
  const addr = A
    ? `<span id="addrA" class="mono" style="position:relative;display:inline-block;font-size:28px;line-height:1.3;color:var(--text);letter-spacing:0">${ADDR}<i id="ulAddr" style="position:absolute;left:0;right:0;bottom:-5px;height:3px;border-radius:2px;background:var(--accent);transform-origin:0 50%;transform:scaleX(0)"></i></span>`
    : `<span id="addrB" style="display:flex;align-items:center;height:36px;gap:var(--gap,5px)" data-n="${ADDR.length}"></span>`;
  const amt = A
    ? `<span id="amtA" class="nowrap" style="position:relative;display:inline-block;font-size:50px;font-weight:600;letter-spacing:-.01em;line-height:1.1;color:var(--text)">${AMOUNT}<i id="ulAmt" style="position:absolute;left:0;right:0;bottom:-4px;height:3px;border-radius:2px;background:var(--accent);transform-origin:0 50%;transform:scaleX(0)"></i></span>`
    : `<span id="amtB" style="display:inline-flex;align-items:center;height:55px;gap:10px">${dots(5, 17, 10, 'dB')}</span>`;
  return `
  <div id="row${k}" class="abs" style="left:${X}px;top:${k === 'A' ? YA : YB}px;width:${W}px;height:${FULL}px">
    <div id="card${k}" class="card" style="position:absolute;left:0;top:0;width:${W}px;height:${ROW}px;overflow:hidden;background:var(--surface)">
      <div class="main" style="position:absolute;left:0;top:0;width:${W - 3}px;height:${ROW - 3}px;display:grid;grid-template-columns:84px 640px 410px 1fr 64px;column-gap:28px;align-items:center;padding:0 40px">
        <div class="ic" style="width:84px;height:84px;border-radius:50%;border:1.5px solid var(--border-2);background:var(--surface-2);display:flex;align-items:center;justify-content:center;color:var(--muted)">${iconSVG('send', 38)}</div>
        <div class="tx" style="display:flex;flex-direction:column;gap:12px;min-width:0">
          <div style="font-size:38px;font-weight:600;line-height:1.1;color:var(--text)">${t.sent}</div>
          <div>${addr}</div>
        </div>
        <div class="pv">${chip}</div>
        <div class="am" style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
          <div style="display:flex;align-items:baseline;gap:14px">${amt}<span style="font-size:26px;font-weight:520;color:var(--muted);letter-spacing:.02em">ZEC</span></div>
          <div style="font-size:26px;color:var(--subtle)">${t.confirmed}</div>
        </div>
        <div class="ey" style="width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:${A ? 'var(--transparent)' : 'var(--shielded)'};border:1.5px solid ${A ? 'rgba(229,155,110,.4)' : 'rgba(143,195,161,.4)'};background:${A ? 'rgba(229,155,110,.07)' : 'rgba(143,195,161,.07)'}">${iconSVG(A ? 'eye' : 'eyeOff', 36)}</div>
      </div>
      <div class="strip" style="position:absolute;left:0;top:${ROW - 3}px;width:${W - 3}px;height:${FULL - ROW + 3}px;border-top:1.5px solid var(--border-2);background:var(--surface-2);display:flex;align-items:center;justify-content:flex-start;gap:20px;padding:0 40px">
        <div id="cap${k}" style="font-size:31px;font-weight:500;color:var(--text);white-space:nowrap">${A ? t.capA : t.capB}</div>
        ${A ? '' : `<div id="noteB" style="font-size:28px;color:var(--muted);white-space:nowrap">${t.noteB}</div>`}
      </div>
      <div id="scan${k}" style="position:absolute;left:0;top:0;width:0;height:${ROW - 3}px;opacity:0">
        <div style="position:absolute;right:0;top:0;width:260px;height:100%;background:linear-gradient(90deg,rgba(244,183,40,0),rgba(244,183,40,.14))"></div>
        <div style="position:absolute;right:-1.5px;top:0;width:3px;height:100%;background:var(--accent);box-shadow:0 0 26px 2px rgba(244,183,40,.55)"></div>
      </div>
    </div>
  </div>`;
}

const stage = document.getElementById('stage');
stage.innerHTML = `
  <div class="glow"></div>
  <div id="motif" class="abs" style="left:${960 - SIZE / 2}px;top:${540 - SIZE / 2}px;width:${SIZE}px;height:${SIZE}px;color:var(--text)">${engravedCSVG(SIZE)}</div>
  <div id="scrim" class="abs" style="left:160px;top:190px;width:1600px;height:700px;background:radial-gradient(50% 50% at 50% 50%, rgba(13,12,10,.9), rgba(13,12,10,.62) 52%, rgba(13,12,10,0) 100%)"></div>
  <div id="content" class="abs" style="left:0;top:0;width:1920px;height:1080px">
  <div id="head" class="abs display" style="left:${X}px;top:92px;font-size:104px;line-height:1.08;white-space:nowrap">
    <div id="h1">${words(t.head[0])}</div><div id="h2">${words(t.head[1])}</div>
  </div>
  <div id="demo" class="abs row" style="left:${X}px;top:${YA - 46}px;align-items:center;gap:12px;font-size:24px;font-weight:520;letter-spacing:.02em;line-height:1.2;color:var(--muted);white-space:nowrap"><span style="display:flex">${iconSVG('info', 26)}</span>${t.demo}</div>
  ${rowHTML('A')}${rowHTML('B')}
  <div id="foot" class="abs row" style="left:${X}px;top:${YB + FULL + 62}px;align-items:center;gap:26px">
    <div style="width:68px;height:68px;border-radius:50%;border:1.5px solid rgba(143,195,161,.45);background:rgba(143,195,161,.08);color:var(--shielded);display:flex;align-items:center;justify-content:center">${iconSVG('receive', 36)}</div>
    <div style="font-size:38px;font-weight:480;color:var(--text);white-space:nowrap">${t.foot}</div>
  </div>
  </div>
  <div class="vignette"></div><div class="grain" id="grain"></div>`;
const $ = (id) => document.getElementById(id);
const s = new Scene({ duration: 11.5 });

// ---- measure (before any seek, so nothing is transformed yet): masks match the real fields' widths ------
const rel = (el, host) => { const a = el.getBoundingClientRect(), b = host.getBoundingClientRect(); return { x: a.left - b.left, w: a.width }; };
const addr = rel($('addrA'), $('cardA')), amt = rel($('amtA'), $('cardA'));
const addrBox = $('addrB');
{
  const n = +addrBox.dataset.n, d = 11, gap = (addr.w - n * d) / (n - 1);
  addrBox.style.setProperty('--gap', `${gap}px`);
  addrBox.innerHTML = dots(n, d, gap, 'dA');
}
const addrDots = [...addrBox.children], amtDots = [...$('amtB').children];
const dotPos = (el) => { const r = rel(el, $('cardB')); return r.x + r.w / 2; };
const dotX = [...addrDots, ...amtDots].map(dotPos);
const allDots = [...addrDots, ...amtDots];

// ---- the field: starts exactly where s01-open ends (C centred, scale 1.9, quiet; echoes at 1.06), then moves aside
const fill = document.querySelector('.ec-facet-fill');
fill.setAttribute('fill-opacity', '1');
s.track(fill, { opacity: [[0, 0.1], [1.6, 0.1]] });
// the facet outline starts where s01-open leaves it (0.15) and lights up again as the C moves aside
s.track(document.querySelector('.ec-facet'), { opacity: [[0.2, 0.15], [1.6, 1, 'inOut']] });
s.track(document.querySelector('.ec-echoes'), { scale: [[0, 1.06], [11.5, 1.13, 'linear']] }, { origin: '600px 600px' });
s.track($('motif'), {
  x: [[0.2, 0], [1.6, 640, 'inOut']], y: [[0.2, 0], [1.6, -335, 'inOut']],
  scale: [[0.2, 1.9], [1.6, 0.62, 'inOut']], opacity: [[0, 0.55], [1.6, 0.9, 'inOut']],
});
s.track($('scrim'), { opacity: [[0, 1], [1.2, 0, 'inOut']] });
// a very slow push on all the text content (the C is parked after 1.6 s, so this keeps the calm tail alive; same as s03-promises)
s.track($('content'), { scale: [[0, 1], [11.5, 1.012, 'linear']] }, { origin: '960px 540px' });

// ---- headline: words rise in (after the 0.5 s dissolve from s01)
[...document.querySelectorAll('#head .w')].forEach((w, i) => {
  const a = 0.5 + i * 0.13;
  s.track(w, { opacity: [[a, 0], [a + 0.7, 1, 'out']], y: [[a, 24], [a + 0.85, 0, 'out']], blur: [[a, 7], [a + 0.6, 0, 'out']] });
});

// ---- helper: a row enters (card rises, fields follow one after another)
function enter(k, t0) {
  const c = $('card' + k);
  s.track(c, { opacity: [[t0, 0], [t0 + 0.6, 1, 'out']], y: [[t0, 38], [t0 + 0.8, 0, 'out']] });
  const parts = ['.ic', '.tx', '.pv', '.am', '.ey'];
  parts.forEach((p, i) => {
    const el = c.querySelector(p), a = t0 + 0.2 + i * 0.12;
    s.track(el, { opacity: [[a, 0], [a + 0.5, 1, 'out']], y: [[a, 14], [a + 0.6, 0, 'out']] });
  });
}
// the caption strip: the card grows to show it
function caption(k, t0, noteAt) {
  s.track($('card' + k), { h: [[0, ROW], [t0, ROW], [t0 + 0.7, FULL, 'inOut']] });
  s.track($('cap' + k), { opacity: [[t0 + 0.3, 0], [t0 + 0.9, 1, 'out']], x: [[t0 + 0.3, -14], [t0 + 0.95, 0, 'out']] });
  if (noteAt != null) s.track($('noteB'), { opacity: [[noteAt, 0], [noteAt + 0.7, 1, 'out']] });
}
// the scan line sweeps the row; lineX(t) is also what the underlines / dots follow
const SCAN = { A: [2.0, 3.4], B: [5.0, 6.3] };
const lineX = (k, t) => sample([[SCAN[k][0], -6], [SCAN[k][1], W + 6, 'inOut']], t);
function scan(k) {
  const [a, b] = SCAN[k];
  s.track($('scan' + k), { x: [[a, -6], [b, W + 6, 'inOut']], opacity: [[a, 0], [a + 0.2, 1], [b - 0.25, 1], [b + 0.05, 0]] });
}

// row A: in (0.75), read (2.0 - 3.4), caption
enter('A', 0.75);
// the demo-data label appears with row A and stays (the rows are an illustration, not a real payment)
s.track($('demo'), { opacity: [[0.95, 0], [1.55, 1, 'out']], y: [[0.95, 10], [1.6, 0, 'out']] });
scan('A');
caption('A', 3.3);

// row B: in (3.9), the same sweep finds nothing (5.0 - 6.3), caption + footnote (opaque by ~7.0 s)
enter('B', 3.9);
scan('B');
caption('B', 6.0, 6.3);   // the qualifier fades in WITH the caption, never after it

// ---- the sweep drives the underlines of row A and the shimmer of the masks of row B
const ulAddr = $('ulAddr'), ulAmt = $('ulAmt');
s.on((t) => {
  const xa = lineX('A', t);
  const f = (x0, w) => Math.min(1, Math.max(0, (xa - x0) / w));
  ulAddr.style.transform = `scaleX(${f(addr.x, addr.w).toFixed(4)})`;
  ulAmt.style.transform = `scaleX(${f(amt.x, amt.w).toFixed(4)})`;
  const xb = lineX('B', t);
  allDots.forEach((d, i) => {
    const p = Math.exp(-(((xb - dotX[i]) / 70) ** 2));
    d.style.opacity = (0.5 + 0.5 * p).toFixed(3);
    d.style.transform = `scale(${(1 + 0.3 * p).toFixed(3)})`;
  });
});

// ---- the bottom line (from 7.1 s; both captions and the line stay up ~3.2 s before the dissolve at 11.0 s)
s.track($('foot'), { opacity: [[7.1, 0], [7.8, 1, 'out']], y: [[7.1, 22], [7.9, 0, 'out']] });

s.grain($('grain'));
await s.start();
