// s14-phone (7.2 s) · free-form · act 3.
// "The same wallet on your phone." Three real phone plates (home, receive, send-filled) in a gentle staggered
// arrangement with slow parallax drift; a faint real desktop window beside them with its sidebar ringed (1),
// and a ring on each phone's bottom tabs (2) with one tap ripple on the first. The sub line carries the legend.
// The glow stands composed from t = 0; the phones and the faint desktop window fade in over 0.15-0.65 s (the phones 0.08 s apart), so the
// previous scene's big content does not ghost over them in the dissolve; the headline and its sub come in at 0.35-1.3 s, after the
// dissolve's midpoint, so two headlines are never printed over each other. In the last 0.45 s the headline, the sub and the top-right chip
// fade out (the phones stay composed to the end), so this scene's title is gone before the closing scene's headline has any weight.
// Gold stays on the number badges, the emphasised word and the one tap ripple, the rings are the light text tone.
import { Scene, lang, pick, loadPlates, plateEl, rectOf } from '/lib/stage.js';

document.documentElement.lang = lang; // so Turkish i / İ casing is right

// ---- copy ---------------------------------------------------------------------------------------------
// Claims: storyboard s14 / README "Features": "a web app with a sidebar on wide screens and bottom tabs on phones".
// '*' marks the one emphasised word. The sub sentence is the README claim, shown once, split only to hang the two legend badges on it.
const T = {
  tr: {
    h: 'Telefonda da aynı *cüzdan.*',                                   // storyboard s14
    sub: ['Geniş ekranda', 'kenar çubuğu', ', telefonda', 'alt sekmeler', '.'], // README: sidebar on wide screens, bottom tabs on phones
    chip: 'Gerçek arayüz · demo verisi',                                      // s05 chip: the plates are the real UI with demo data
  },
  en: {
    h: 'The *same* wallet on your phone.',                              // storyboard s14
    sub: ['A', 'sidebar', 'on wide screens, ', 'bottom tabs', 'on phones.'],  // README
    chip: 'Real interface · demo data',
  },
};
const t = pick(T);

function words(line) {
  return line.split(/(\*[^*]+\*)/).filter(Boolean).flatMap((part) => {
    const em = part.startsWith('*');
    return (em ? part.slice(1, -1) : part).split(' ').filter(Boolean).map((w) => `<span class="w">${em ? `<em>${w}</em>` : w}</span>`);
  }).join(' ');
}
const nb = (n, cls) => `<span class="nb ${cls}">${n}</span>`;
const subHTML = lang === 'tr'
  ? `${t.sub[0]} <b>${nb(1, 'sn1')}${t.sub[1]}</b>${t.sub[2]} <b>${nb(2, 'sn2')}${t.sub[3]}</b>${t.sub[4]}`
  : `${t.sub[0]} <b>${nb(1, 'sn1')}${t.sub[1]}</b> ${t.sub[2]}<b>${nb(2, 'sn2')}${t.sub[3]}</b> ${t.sub[4]}`;

// ---- geometry -----------------------------------------------------------------------------------------
const PS = 0.78;                    // phone scale (outer frame 422 x 876 css px at 1.0)
const PW = 422 * PS, PH = 876 * PS;
const PG = 20, PX0 = 1840 - 3 * PW - 2 * PG; // the trio ends on the 80 px safe margin
const PHONES = [
  { plate: 'home',        x: PX0,                 y: 284, d: [20, -20],  tilt: -2.5, tab: 'navHome' },
  { plate: 'receive',     x: PX0 + PW + PG,       y: 246, d: [-18, 20], tilt: 0,     tab: 'navReceive' },
  { plate: 'send-filled', x: PX0 + 2 * (PW + PG), y: 292, d: [20, -18], tilt: 2.5,  tab: 'navSend' },
];
const GK = 0.54;                   // the faint desktop window's scale: ends before the first phone, so no card is cut mid-word
const GX = 96, GY = 300;            // its top-left on the canvas (its bottom stays above badge 2)

const P = await loadPlates('phone');
const D = await loadPlates('desktop');

const stage = document.getElementById('stage');
stage.innerHTML = `
  <style>
    #head { font-size: 92px; line-height: 1.07; white-space: nowrap; }
    #head em { letter-spacing: 0.012em; }
    #head .w { display: inline-block; }
    #sub { font-size: 34px; line-height: 1.44; color: var(--muted); white-space: nowrap; }
    #sub b { color: var(--text); font-weight: 600; white-space: nowrap; }
    .nb { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 50%; background: var(--accent); color: var(--accent-text);
      font-size: 22px; font-weight: 700; letter-spacing: 0; margin-right: 12px; vertical-align: 2px; }
    .ph { box-shadow: 0 40px 70px -34px rgba(0,0,0,.92); }
    .tabring { position: absolute; border-radius: 24px; border: 2.5px solid color-mix(in srgb, var(--text) 72%, transparent); pointer-events: none; }
    .gring { position: absolute; border-radius: 18px; border: 2.5px solid color-mix(in srgb, var(--text) 72%, transparent); pointer-events: none; }
    #ghostbox { position: absolute; left: ${GX}px; top: ${GY}px; width: ${1280 * GK}px; height: ${1084 * GK}px; }
    #ghostbox .browser { left: 0; top: 0; width: 1280px; border-radius: 16px; box-shadow: none; border: 2px solid var(--border-2); }
    #ghostbox .browser .bar { height: 44px; }
    #ghostbox .browser .url { min-width: 380px; font-size: 16px; }
  </style>
  <div class="glow"></div>
  <div id="hl" class="abs" style="left:1120px;top:60px;width:1000px;height:1000px;background:radial-gradient(50% 50% at 50% 50%, color-mix(in srgb, var(--accent) 7.5%, transparent), color-mix(in srgb, var(--accent) 0%, transparent) 70%)"></div>

  <div id="gw" class="abs" style="left:0;top:0;width:1920px;height:1080px">
    <div id="ghostbox">
      <div class="browser" id="gbrowser">
        <div class="bar"><i></i><i></i><i></i><div class="url"><svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2.25"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>app.celariwallet.com</div></div>
        <div class="screen" style="width:1280px;height:1040px"></div>
      </div>
    </div>
    <div id="gring" class="gring"></div>
    <div id="gbadge" class="nb" style="position:absolute;margin:0;width:44px;height:44px;font-size:26px"></div>
  </div>

  <div id="head" class="abs display" style="left:110px;top:58px">${words(t.h)}</div>
  <div id="sub" class="abs" style="left:110px;top:172px">${subHTML}</div>
  <div id="chiptop" class="chip abs" style="left:auto;right:80px;top:84px">${t.chip}</div>

  <div id="phones"></div>
  <div class="vignette"></div><div class="grain" id="grain"></div>`;

const $ = (id) => document.getElementById(id);
const s = new Scene({ duration: 7.2 });

// ---- the faint desktop window (real plate `home`, desktop) -----------------------------------------------
const gscreen = document.querySelector('#gbrowser .screen');
const gplate = plateEl(D, 'home');
gscreen.append(gplate);
s.track($('gbrowser'), { scale: [[0, GK]] }, { origin: '0 0' });
// the silhouette is NOT there at t = 0 (the previous scene's content would ghost over it in the dissolve): it fades in 0.15 -> 0.65 s
const IN0 = 0.15, IN_LEN = 0.5, IN_GAP = 0.08;
s.track($('ghostbox'), { opacity: [[IN0, 0], [IN0 + IN_LEN, 0.74, 'out']], y: [[IN0, 20], [IN0 + 0.7, 0, 'out']] });
s.track($('gw'), { y: [[0, -14], [7.2, 14, 'linear']] });

// ring (1) on the real sidebar: the `nav` box of the desktop home plate (plate px -> canvas)
const nav = rectOf(D, 'home', 'nav');
const gpad = 8;
const gr = { x: GX + nav.x * GK - gpad, y: GY + (44 + nav.y) * GK - gpad, w: nav.w * GK + 2 * gpad, h: nav.h * GK + 2 * gpad };
Object.assign($('gring').style, { left: `${gr.x}px`, top: `${gr.y}px`, width: `${gr.w}px`, height: `${gr.h}px` });
Object.assign($('gbadge').style, { left: `${gr.x + gr.w / 2 - 22}px`, top: `${gr.y + gr.h + 14}px` }); // centred under the ring: empty sidebar, no content next to it
$('gbadge').textContent = '1';
const G_IN = 2.0;
s.track($('gring'), { opacity: [[G_IN, 0], [G_IN + 0.4, 1]], scale: [[G_IN, 1.08], [G_IN + 0.55, 1, 'out']] });
s.track($('gbadge'), { opacity: [[G_IN + 0.15, 0], [G_IN + 0.5, 1]], scale: [[G_IN + 0.15, 0.4], [G_IN + 0.7, 1, 'outBack']] });
s.track(document.querySelector('.sn1'), { scale: [[G_IN, 1], [G_IN + 0.18, 1.28, 'out'], [G_IN + 0.5, 1, 'inOut']] });

// ---- three phones ---------------------------------------------------------------------------------------
const holder = $('phones');
const T_TAB = [2.6, 2.95, 3.3]; // the tab rings, one after another
PHONES.forEach((ph, i) => {
  const pw = document.createElement('div');
  pw.className = 'abs';
  pw.style.cssText = 'left:0;top:0;width:1920px;height:1080px';
  const phone = document.createElement('div');
  phone.className = 'phone ph';
  phone.style.cssText = `left:${ph.x}px;top:${ph.y}px`;
  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.style.cssText = 'width:390px;height:844px';
  screen.append(plateEl(P, ph.plate));
  phone.append(screen);
  pw.append(phone);

  // canvas position of a point (screen css px) of this phone
  const at = (x, y) => [ph.x + (16 + x) * PS, ph.y + (16 + y) * PS];
  // ring (2) around the bottom tabs (the plate's `nav` box), a little outside the screen so the rounded corners do not clip it
  const nv = rectOf(P, 'home', 'nav'); // only home captured the whole bar; the bar is identical on every phone screen
  const [rx, ry] = at(nv.x, nv.y + 1);
  const rTop = ry + 2, rH = nv.h * PS + 10 - 7;   // top edge on the bar's own top border: it must not strike through the plate's text above the bar (send: the memo label)
  const ring = document.createElement('div');
  ring.className = 'tabring';
  ring.style.cssText = `left:${rx - 3}px;top:${rTop}px;width:${nv.w * PS + 6}px;height:${rH}px`;
  pw.append(ring);
  const badge = document.createElement('div');
  badge.className = 'nb';
  badge.style.cssText = `position:absolute;margin:0;left:${rx - 3 - 56}px;top:${rTop + rH / 2 - 22}px;width:44px;height:44px;font-size:26px;${i ? 'display:none' : ''}`;
  badge.textContent = '2';
  pw.append(badge);
  // one tap ripple, on the first phone's tab (it is the active one, so the tap changes nothing on screen; three would add no meaning)
  let rip = null;
  if (i === 0) {
    const tb = rectOf(P, ph.plate, ph.tab);
    const [cx, cy] = at(tb.x + tb.w / 2, tb.y + tb.h / 2);
    rip = document.createElement('div');
    rip.className = 'ripple';
    rip.style.cssText = `left:${cx - 36}px;top:${cy - 36}px`;
    pw.append(rip);
  }
  holder.append(pw);

  // the phones are invisible at t = 0 and fade in over 0.15 -> 0.65 s (+0.08 s per phone) while they settle into place
  const a = IN0 + i * IN_GAP;
  s.track(pw, { y: [[0, ph.d[0]], [7.2, ph.d[1], 'linear']] });
  s.track(phone, {
    opacity: [[a, 0], [a + IN_LEN, 1, 'out']],
    y: [[a, 36], [a + 0.8, 0, 'out']],
    rotate: [[a, ph.tilt], [a + 0.8, 0, 'out']],
    scale: [[0, PS]],
  });
  const tr = T_TAB[i];
  s.track(ring, { opacity: [[tr, 0], [tr + 0.4, 1], [4.9 + i * 0.25, 1], [5.6 + i * 0.25, 0.62, 'inOut'], [6.4 + i * 0.25, 1, 'inOut']], scale: [[tr, 1.1], [tr + 0.55, 1, 'out']] });
  s.track(badge, { opacity: [[tr + 0.15, 0], [tr + 0.45, 1]], scale: [[tr + 0.15, 0.4], [tr + 0.7, 1, 'outBack']] });
  if (rip) s.track(rip, { scale: [[tr + 0.35, 0.25], [tr + 0.95, 1.5, 'out']], opacity: [[tr + 0.35, 0], [tr + 0.47, 0.9, 'out'], [tr + 0.95, 0, 'out']] });
});
s.track(document.querySelector('.sn2'), { scale: [[2.6, 1], [2.78, 1.28, 'out'], [3.1, 1, 'inOut']] });

const DUR = 7.2, OUT0 = DUR - 0.45, OUT1 = DUR - 0.1; // headline, sub and chip are gone before the next scene's headline has weight (its dissolve is 0.7 s)
s.track($('chiptop'), { opacity: [[0.3, 0], [0.8, 1], [OUT0, 1], [OUT1, 0, 'inOut']] });   // top right, where the previous usage scene's step badge ('ADIM 8 / 8') still fades: it arrives after the dissolve's midpoint too

// ---- headline words, sub, ambient --------------------------------------------------------------------------
// the headline and its sub do NOT stand at t = 0: the previous scene's headline sits at the same spot, and two headlines at 50 % each
// are unreadable. The phones and the faint desktop window are composed from t = 0 (the dissolve lands on them); the words follow once
// the dissolve is half over, like s03 / s04 do.
document.querySelectorAll('#head .w').forEach((w, i) => {
  const a = 0.35 + i * 0.07; // the last word (EN: 6 words) starts at 0.70 s and is in by ~1.25 s
  s.track(w, { opacity: [[a, 0], [a + 0.55, 1, 'out']], y: [[a, 24], [a + 0.6, 0, 'out']], blur: [[a, 7], [a + 0.5, 0, 'out']] });
});
s.track($('sub'), { opacity: [[0.55, 0], [1.25, 1, 'out'], [OUT0, 1], [OUT1, 0, 'inOut']], y: [[0.55, 16], [1.35, 0, 'out']] });
s.track($('head'), { opacity: [[OUT0, 1], [OUT1, 0, 'inOut']] }); // the container: the words keep their own entrance tracks
s.track($('hl'), { opacity: [[0, 0.9], [1.0, 1]], x: [[0, 30], [7.2, -30, 'linear']] });
s.grain($('grain'));
await s.start();
