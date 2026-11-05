// s03-promises (13 s) · free-form · act 1, "Privacy you can check."
// Four promise cards (icon, title, one line, the wallet's own chips as proof) rise one after another, then a stats
// strip counts up. Starts from the faint C + echo field that s02-default ends on, so the 0.5 s dissolve is only a
// text swap; the C glides up into the corner to make room. Every string is backed by landing/build.py (TEXT).
import { Scene, lang, pick } from '/lib/stage.js';
import { engravedCSVG, iconSVG } from '/lib/brand.js';

document.documentElement.lang = lang;

const T = {
  tr: {
    eyebrow: '<span>Neden <span lang="en">Celari</span></span>',                   // landing tr: features_eyebrow
    head: 'Doğrulanabilen *gizlilik*.',                               // landing tr: features_h
    cards: [
      { icon: 'lock', h: 'Anahtarlar cihazında kalır',                // landing tr: features[1]
        p: 'Kurtarma kelimeleri ve cüzdan veritabanı yalnızca şifreli saklanır.' },
      { icon: 'shield', h: 'Varsayılan olarak gizli',                 // landing tr: features[0]
        p: 'Şeffaf bakiye tek tıkla gizli (shielded) havuza aktarılır.' },
      { icon: 'eye', h: 'Dürüst etiketler',                          // landing tr: features[3]
        // landing tr says "..., nedeniyle söyler." (a literal calque of "and why"); the Turkish here is a smoothed form of the site line
        // ("... olduğunu ve nedenini söyler", as in the storyboard VO); copy owner: fix landing/build.py:283 too
        p: 'Her ödeme gizli mi, kısmen gizli mi, herkese açık mı olduğunu ve nedenini söyler.' },
      { icon: 'code', h: 'Açık kaynak',                              // landing tr: lede + ticker (Token yok / Hesap yok / Airdrop yok) + features[5] (MIT / Apache-2.0)
        p: 'Token yok, hesap yok, airdrop vaadi yok.' },
    ],
    transparent: 'Şeffaf', shielded: 'Gizli', partial: 'Kısmen gizli', public: 'Herkese açık', or: 'ya da', // tr.ts send.privacy.*, history.privacy.*
    amountPublic: 'Tutar herkese açık',                                // tr.ts history.privacy.shielding: 'Gizliye aktarıldı · tutar herkese açık'; shield.intro: 'Tutar ve şeffaf adresin zincirde görünür'
    stats: [
      { to: 600000, lab: 'PBKDF2-SHA256 turu', sub: 'şifrenle anahtarların arasında' },                  // landing tr: stats[0]
      { to: 24, lab: 'kurtarma kelimesi', sub: 'tek yedeğin' },                                          // landing tr: stats[1]
      { to: 256, lab: 'bit AES-GCM', sub: 'kelimelerin ve cüzdan veritabanın üzerinde' },       // landing tr: stats[2]
    ],
  },
  en: {
    eyebrow: 'Why Celari',                                            // landing en: features_eyebrow
    head: 'Privacy you can *check*.',                                 // landing en: features_h
    cards: [
      { icon: 'lock', h: 'Keys stay on your device',                  // landing en: features[1]
        p: 'The recovery phrase and the wallet database are stored only encrypted.' },
      { icon: 'shield', h: 'Shielded by default',                     // landing en: features[0]
        p: 'Transparent funds are one click from the shielded pool.' },
      { icon: 'eye', h: 'Honest labels',                              // landing en: features[3]
        p: 'Each payment says whether it is shielded, partly shielded or public, and why.' },
      { icon: 'code', h: 'Open source',                               // landing en: lede + ticker (No token / No account / No airdrop) + features[5] (MIT / Apache-2.0)
        p: 'No token, no account, no airdrop promises.' },
    ],
    transparent: 'Transparent', shielded: 'Shielded', partial: 'Partly shielded', public: 'Public', or: 'or', // en.ts send.privacy.*, history.privacy.*
    amountPublic: 'Amount public',                                     // en.ts history.privacy.shielding: 'Shielded · amount public'; shield.intro: 'The amount and your transparent address are visible on chain'
    stats: [
      { to: 600000, lab: 'PBKDF2-SHA256 rounds', sub: 'between your password and your keys' },            // landing en: stats[0]
      { to: 24, lab: 'recovery words', sub: 'your only backup' },                                        // landing en: stats[1]
      { to: 256, lab: 'bit AES-GCM', sub: 'on the phrase and the wallet database' },                    // landing en: stats[2]
    ],
  },
};
const t = pick(T);

/** "a *b c* d." -> inline-block word spans (the emphasised words in <em>; punctuation after the closing * stays attached). */
function words(line) {
  let em = false;
  return line.split(' ').filter(Boolean).map((tok) => {
    if (tok.startsWith('*')) { em = true; tok = tok.slice(1); }
    if (em && tok.includes('*')) { const [inner, tail] = tok.split('*'); em = false; return `<span class="w"><em>${inner}</em>${tail}</span>`; }
    return `<span class="w">${em ? `<em>${tok}</em>` : tok}</span>`;
  }).join(' ');
}

// The wallet's privacy mark: full = shielded, half = partly shielded, hollow = transparent / public (words always with it).
const chip = (kind, text) => {
  const c = { sage: 'sage', copper: 'copper', warn: 'warn' }[kind];
  const d = { sage: 'dot', copper: 'dot hollow', warn: 'dot half' }[kind];
  return `<span class="chip ${c}"><span class="${d}"></span>${text}</span>`;
};
const mono = (text) => `<span class="chip mono">${text}</span>`;
const plain = (text) => `<span class="chip">${text}</span>`;
const sep = (text) => `<span class="sep">${text}</span>`;
const ARROW = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12h15M14 6.5l5.5 5.5-5.5 5.5"/></svg>`;
// the website's own "code" glyph (landing/build.py ICONS['code'] = src/components/icons.tsx code); brand-data.js lacks it
const CODE = `<svg class="icon" viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.25 5.5l-2.5 13" /></svg>`;

const chipsFor = [
  `${mono('PBKDF2-SHA256')}${mono('AES-256-GCM')}`,
  `${chip('copper', t.transparent)}${ARROW}${chip('sage', t.shielded)}${sep('·')}${chip('copper', t.amountPublic)}`,   // the shielding step itself shows its amount on chain
  `${chip('sage', t.shielded)}${chip('warn', t.partial)}${chip('copper', t.public)}`,
  `${plain('MIT')}${sep(t.or)}${plain('Apache-2.0')}`,
];

// ---- geometry (canvas px) ---------------------------------------------------------------------------
const X = 96, W = 1728;
const CW = 852, CH = 250, GX = W - 2 * CW, GY = 18;     // 2 x 2 grid
const Y1 = 232, Y2 = Y1 + CH + GY;
const SIZE = 2400;                                        // the engraved C (same as s01 / s02)
const SY = 784;                                           // the stats strip's hairline
const SX = [X, 680, 1240], SW = [504, 480, 584], SD = [0, 640, 1200];   // stat columns (text left / width) and the two dividers; the 28 px sub lines stay on one line

const cardHTML = (c, i) => {
  const x = X + (i % 2) * (CW + GX), y = i < 2 ? Y1 : Y2;
  return `
  <div id="c${i}" class="card pc" style="left:${x}px;top:${y}px;width:${CW}px;height:${CH}px">
    <div class="edge"></div>
    <div class="icw" style="position:absolute;left:32px;top:32px;width:76px;height:76px">
      <svg viewBox="0 0 76 76" width="76" height="76" style="position:absolute;left:0;top:0;overflow:visible"><circle class="rg" cx="38" cy="38" r="37" transform="rotate(-90 38 38)" fill="none" stroke="var(--muted)" stroke-opacity="0.5" stroke-width="1.5"/></svg>
      <div class="ic" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text)">${c.icon === 'code' ? CODE : iconSVG(c.icon, 38)}</div>
      <div class="ping" style="position:absolute;inset:0;border-radius:50%;border:2px solid var(--text);opacity:0"></div>
    </div>
    <div class="body" style="position:absolute;left:136px;top:30px;right:32px;bottom:28px;display:flex;flex-direction:column">
      <div class="h">${c.h}</div>
      <div class="p">${c.p}</div>
      <div class="chips">${chipsFor[i]}</div>
    </div>
  </div>`;
};

const statHTML = (s, i) => `
  <div id="s${i}" class="stat abs" style="left:${SX[i]}px;top:${SY + 22}px;width:${SW[i]}px">
    <div class="num display">0</div>
    <div class="lab">${s.lab}</div>
    <div class="sub">${s.sub}</div>
  </div>`;

const stage = document.getElementById('stage');
stage.innerHTML = `
  <div class="glow"></div>
  <div id="motif" class="abs" style="left:${960 - SIZE / 2}px;top:${540 - SIZE / 2}px;width:${SIZE}px;height:${SIZE}px;color:var(--text)">${engravedCSVG(SIZE)}</div>
  <div id="content" class="abs" style="left:0;top:0;width:1920px;height:1080px">
    <div id="eyebrow" class="eyebrow abs" style="left:${X}px;top:62px">${t.eyebrow}</div>
    <div id="head" class="abs display" style="left:${X}px;top:102px;font-size:86px;line-height:1.08;white-space:nowrap">${words(t.head)}</div>
    ${t.cards.map(cardHTML).join('')}
    <div id="sline" class="abs" style="left:${X}px;top:${SY}px;width:${W}px;height:1.5px;background:var(--border-2);transform-origin:0 50%"></div>
    <div id="glint" class="abs" style="left:${X}px;top:${SY - 1}px;width:260px;height:3.5px;border-radius:2px;background:linear-gradient(90deg,color-mix(in srgb, var(--accent) 0%, transparent),color-mix(in srgb, var(--accent) 95%, transparent) 70%,color-mix(in srgb, var(--accent) 0%, transparent));opacity:0"></div>
    ${t.stats.map(statHTML).join('')}
    ${[1, 2].map((i) => `<div id="sd${i}" class="abs" style="left:${SD[i]}px;top:${SY + 28}px;width:1.5px;height:160px;background:var(--border-2);transform-origin:50% 0"></div>`).join('')}
  </div>
  <div class="vignette"></div><div class="grain" id="grain"></div>`;
const $ = (id) => document.getElementById(id);
const s = new Scene({ duration: 13 });
const DUR = 13;

// ---- the field: starts where s02-default ends (C at the upper right, scale .62, echoes 1.13), then glides into the corner
const fill = document.querySelector('.ec-facet-fill');
fill.setAttribute('fill-opacity', '1');
s.track(fill, { opacity: [[0, 0.1], [DUR, 0.1]] });
s.track(document.querySelector('.ec-echoes'), { scale: [[0, 1.13], [DUR, 1.2, 'linear']] }, { origin: '600px 600px' });
s.track($('motif'), {
  x: [[0, 640], [0.35, 640], [1.9, 740, 'inOut']], y: [[0, -335], [0.35, -335], [1.9, -422, 'inOut']],
  scale: [[0, 0.62], [0.35, 0.62], [1.9, 0.4, 'inOut']], opacity: [[0, 0.9], [1.9, 0.85, 'inOut']],
});
// a very slow push on all the content (calm, keeps every window alive)
s.track($('content'), { scale: [[0, 1], [DUR, 1.012, 'linear']] }, { origin: '960px 540px' });

// ---- eyebrow + title (after the 0.5 s dissolve). Deliberately NOT composed from t=0: the previous scene's headline sits at the
// same spot, and a cross-dissolve of two headlines at 50 % each is unreadable; the dissolve instead lands on the faint C + echo field.
s.track($('eyebrow'), { opacity: [[0.4, 0], [1.0, 1]], x: [[0.4, -14], [1.1, 0, 'out']] });
[...document.querySelectorAll('#head .w')].forEach((w, i) => {
  const a = 0.5 + i * 0.13;
  s.track(w, { opacity: [[a, 0], [a + 0.7, 1, 'out']], y: [[a, 24], [a + 0.85, 0, 'out']], blur: [[a, 7], [a + 0.6, 0, 'out']] });
});

// ---- the four cards, ~0.62 s apart
t.cards.forEach((_, i) => {
  const a = 1.35 + i * 0.62, c = $('c' + i);
  s.track(c, { opacity: [[a, 0], [a + 0.7, 1, 'out']], y: [[a, 36], [a + 0.9, 0, 'out']] });
  s.track(c.querySelector('.edge'), { scaleX: [[a + 0.1, 0], [a + 1.1, 1, 'out']], opacity: [[a + 0.1, 0], [a + 0.3, 1]] });
  s.track(c.querySelector('.rg'), { draw: [[a + 0.25, 0], [a + 1.05, 1, 'inOut']] });
  s.track(c.querySelector('.ic'), { opacity: [[a + 0.4, 0], [a + 0.9, 1, 'out']], scale: [[a + 0.4, 0.82], [a + 1.0, 1, 'out']] });
  s.track(c.querySelector('.h'), { opacity: [[a + 0.3, 0], [a + 0.8, 1, 'out']], x: [[a + 0.3, 16], [a + 0.9, 0, 'out']] });
  s.track(c.querySelector('.p'), { opacity: [[a + 0.45, 0], [a + 1.0, 1, 'out']], x: [[a + 0.45, 16], [a + 1.05, 0, 'out']] });
  [...c.querySelectorAll('.chips > *')].forEach((el, j) => {
    const b = a + 0.8 + j * 0.12;
    s.track(el, { opacity: [[b, 0], [b + 0.45, 1, 'out']], y: [[b, 12], [b + 0.5, 0, 'out']] });
  });
});

// ---- the stats strip: hairline draws, three counters count up
s.track($('sline'), { scaleX: [[5.0, 0], [6.0, 1, 'out']], opacity: [[5.0, 0], [5.15, 1]] });
[1, 2].forEach((i) => s.track($('sd' + i), { scaleY: [[5.4 + i * 0.25, 0], [6.2 + i * 0.25, 1, 'out']] }));
const fmt = (v) => Math.round(v).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US');
t.stats.forEach((st, i) => {
  const a = 5.3 + i * 0.28, el = $('s' + i);
  s.track(el, { opacity: [[a, 0], [a + 0.6, 1, 'out']], y: [[a, 26], [a + 0.8, 0, 'out']] });
  s.count(el.querySelector('.num'), { from: 0, to: st.to, t0: a + 0.1, t1: a + 0.1 + (st.to > 1000 ? 2.5 : st.to > 100 ? 1.8 : 1.5), fmt });
  s.track(el.querySelector('.lab'), { opacity: [[a + 0.35, 0], [a + 0.9, 1, 'out']] });
  s.track(el.querySelector('.sub'), { opacity: [[a + 0.55, 0], [a + 1.1, 1, 'out']] });
});

// ---- a "check" pass: each card's ring pings once, in order, then a glint runs along the strip; then it all rests
t.cards.forEach((_, i) => {
  const p = 8.5 + i * 0.4, ping = $('c' + i).querySelector('.ping');
  s.track(ping, { scale: [[p, 1], [p + 1.0, 1.45, 'out']], opacity: [[p, 0], [p + 0.05, 0.6, 'linear'], [p + 1.0, 0, 'out']] });
});
s.track($('glint'), { x: [[10.3, 0], [11.6, W - 260, 'inOut']], opacity: [[10.3, 0], [10.55, 1], [11.4, 1], [11.65, 0]] });

s.grain($('grain'));
await s.start();
