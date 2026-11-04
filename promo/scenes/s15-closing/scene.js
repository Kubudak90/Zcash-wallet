// s15-closing (10 s) · free-form · the last scene (promo, tutorial and full cuts all end here).
// A calm landing: the engraved C large and faint, the lockup, the closing headline, three quiet link "buttons"
// (the wallet in gold, the website, the source), and the honest caution card. The last 2.5 s hold still: only the
// lockup's facet (a slow breath) and the wallet button (glow and a slow light sweep) stay alive, everything else rests.
// The lockup and the headline are in place by 0.3 s, so the previous scene dissolves into a composed frame.
import { Scene, lang, pick } from '/lib/stage.js';
import { engravedCSVG, lockupHTML, iconSVG } from '/lib/brand.js';

document.documentElement.lang = lang;

// ---- copy ---------------------------------------------------------------------------------------------
// '*' marks the one emphasised phrase (gold italic).
const T = {
  tr: {
    h: ['İşini *kendine* saklayan', 'bir Zcash cüzdanı.'],                      // landing tr: closing_h
    open: 'Cüzdanı aç', web: 'Web sitesi', src: 'Kaynak kod',                    // storyboard s15 labels; landing tr: footer_links 'Kaynak kod'. 'Web sitesi' has NO tr source: it is the plain translation of README "Website:" (a navigation label, not a claim)
    cautionHead: 'Dikkat',                                                       // landing tr: warn_icon
    caution: ['Erken aşamada ve henüz bağımsız bir güvenlik denetiminden geçmedi.', 'Kaybetmeyi göze alabileceğin tutarlar kullan.'], // landing tr: caution (two sentences)
    phrase: 'Kurtarma kelimelerin tek yedeğin.',                                 // README Features: "The recovery phrase is the only backup" / welcome copy
    footer: 'MIT / Apache-2.0 · ChainSafe WebZjs tabanlı',                       // tr.ts: welcome.footer
  },
  en: {
    h: ['A Zcash wallet that keeps', 'your business *your own.*'],               // landing en: closing_h
    open: 'Open the wallet', web: 'Website', src: 'Source',                      // storyboard s15 labels; README "Website:"; landing en: footer_links 'Source'
    cautionHead: 'Caution',                                                      // landing en: warn_icon
    caution: ['Early software, not yet independently audited.', 'Use amounts you can afford to lose.'], // landing en: caution (two sentences)
    phrase: 'Your recovery phrase is the only backup.',
    footer: 'MIT / Apache-2.0 · Built on ChainSafe’s WebZjs',                    // en.ts: welcome.footer
  },
};
const t = pick(T);
// EN: one sentence per line (each fits on one line). TR: the first sentence is longer than the column, so the two run on and wrap balanced.
const cautionHTML = lang === 'en' ? t.caution.join('<br>') : t.caution.join(' ');

/** "a *b c* d" -> inline-block word spans (the emphasised words in <em>), so words can enter one by one. */
function words(line) {
  return line.split(/(\*[^*]+\*)/).filter(Boolean).flatMap((part) => {
    const em = part.startsWith('*');
    return (em ? part.slice(1, -1) : part).split(' ').filter(Boolean).map((w) => `<span class="w">${em ? `<em>${w}</em>` : w}</span>`);
  }).join(' ');
}

// URLs: README ("Wallet: https://app.celariwallet.com · Website: https://celariwallet.com"), landing/build.py APP and SOURCE.
const LINKS = [
  { id: 'l1', label: t.open, url: 'app.celariwallet.com', primary: true },
  { id: 'l2', label: t.web, url: 'celariwallet.com' },
  { id: 'l3', label: t.src, url: 'github.com/Kubudak90/Zcash-wallet' },
];

const SIZE = 2700;                   // the engraved C: silhouette ~437 x 506 px (about half the frame's height), echoes run out of the frame
const CX = 1590, CY = 270;           // its centre: top right, clear of the headline; its foot tucks behind the links row
const stage = document.getElementById('stage');
stage.innerHTML = `
  <style>
    #head { font-size: 100px; line-height: 1.07; white-space: nowrap; }
    #head .w { display: inline-block; }
    #head em { font-variant-ligatures: none; font-feature-settings: 'liga' 0, 'dlig' 0, 'calt' 0; letter-spacing: 0.01em; }
    .link { position: relative; overflow: hidden; display: flex; flex: 1 1 auto; align-items: center; justify-content: space-between; gap: 28px; height: 106px; padding: 0 34px 0 34px; border-radius: 24px;
      background: var(--surface); border: 1.5px solid var(--border-2); color: var(--text); }
    .link .lab { font-size: 24px; font-weight: 520; letter-spacing: 0.01em; color: var(--muted); line-height: 1.2; }
    .link .url { font-size: 34px; font-weight: 600; letter-spacing: -0.005em; line-height: 1.2; margin-top: 4px; white-space: nowrap; }
    .link .go { flex: none; color: var(--muted); }
    .link.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); box-shadow: 0 0 56px -18px color-mix(in srgb, var(--accent) 50%, transparent); }
    .link.primary .lab { color: var(--accent-text); opacity: .72; font-weight: 600; }
    .link.primary .go { color: var(--accent-text); }
    .link .sheen { position: absolute; top: 0; bottom: 0; left: 0; width: 160px; background: linear-gradient(100deg, color-mix(in srgb, var(--text) 0%, transparent), color-mix(in srgb, var(--text) 34%, transparent) 50%, color-mix(in srgb, var(--text) 0%, transparent)); opacity: 0; pointer-events: none; }
    #caution { position: absolute; left: 110px; top: 666px; width: 1700px; display: flex; align-items: center; padding: 32px 48px 34px 40px; border-radius: 28px;
      background: var(--surface); border: 1.5px solid color-mix(in srgb, var(--warn) 50%, transparent); }
    #caution .main { display: flex; gap: 30px; align-items: flex-start; flex: 1 1 auto; }
    #caution .ic { flex: none; color: var(--warn); margin-top: 2px; }
    #caution .ic svg { width: 48px; height: 48px; }
    #caution .hd { font-size: 22px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--warn); }
    #caution .tx { font-size: 34px; line-height: 1.36; color: var(--text); margin-top: 10px; max-width: 980px; text-wrap: balance; }
    #caution .rule { flex: none; width: 1.5px; align-self: stretch; margin: 6px 44px; background: var(--border-2); }
    #caution .ph { flex: none; width: 440px; display: flex; gap: 24px; align-items: center; font-size: 30px; line-height: 1.3; color: color-mix(in srgb, var(--text) 82%, transparent); text-wrap: balance; }
    #caution .ph .k { flex: none; display: flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 50%; color: var(--warn); border: 1.5px solid color-mix(in srgb, var(--warn) 55%, transparent); }
    #caution .ph .k svg { width: 36px; height: 36px; }
  </style>
  <div class="glow"></div>
  <div id="motif" class="abs" style="left:${CX - SIZE / 2}px;top:${CY - SIZE / 2}px;width:${SIZE}px;height:${SIZE}px;color:var(--text)">${engravedCSVG(SIZE)}</div>
  <div id="lock" class="abs" style="left:110px;top:72px;color:var(--text)">${lockupHTML(88)}</div>
  <div id="head" class="abs display" style="left:110px;top:200px"><div>${words(t.h[0])}</div><div>${words(t.h[1])}</div></div>
  <div id="links" class="abs row" style="left:110px;top:496px;width:1700px;gap:20px">
    ${LINKS.map((l) => `<div id="${l.id}" class="link${l.primary ? ' primary' : ''}"><div><div class="lab">${l.label}</div><div class="url">${l.url}</div></div><span class="go">${iconSVG('external', 36, { stroke: 1.6 })}</span>${l.primary ? '<i class="sheen" id="sheen"></i>' : ''}</div>`).join('')}
  </div>
  <div id="caution">
    <div class="main"><span class="ic" id="cic">${iconSVG('alert', 48, { stroke: 1.5 })}</span>
      <div><div class="hd" id="chd">${t.cautionHead}</div><div class="tx" id="ctx">${cautionHTML}</div></div></div>
    <i class="rule" id="crule"></i>
    <div class="ph" id="cph"><span class="k">${iconSVG('key', 36, { stroke: 1.5 })}</span><span>${t.phrase}</span></div>
  </div>
  <div id="foot" class="abs" style="left:110px;top:960px;font-size:24px;color:var(--muted);letter-spacing:0.01em">${t.footer}</div>
  <div class="vignette"></div><div class="grain" id="grain"></div>`;
const $ = (id) => document.getElementById(id);
const s = new Scene({ duration: 10 });

// ---- the engraved C: drawn while the previous scene dissolves out (the silhouette and bands are done by ~0.5 s; the echoes keep
// spreading outward as the ambient motion of the first seconds), then a slow outward drift
const lines = [...document.querySelectorAll('.ec-sil, .ec-band')];
lines.forEach((p, i) => s.track(p, { draw: [[-1.4 + i * 0.025, 0], [0.45 + i * 0.025, 1, 'inOut']] }));
document.querySelectorAll('.ec-echo').forEach((p) => {
  const i = +p.dataset.i;
  s.track(p, { draw: [[-0.6 + 0.05 * i, 0], [1.5 + 0.05 * i, 1, 'out']] });
});
s.track(document.querySelector('.ec-facet'), { draw: [[-0.6, 0], [0.6, 1, 'out']] });
const fill = document.querySelector('.ec-facet-fill');
fill.setAttribute('fill-opacity', '1');
s.track(fill, { opacity: [[1.0, 0], [1.7, 0.55, 'out'], [3.2, 0.16, 'inOut']] });
s.track(document.querySelector('.ec-echoes'), { scale: [[0, 0.97], [10, 1.05, 'linear']] }, { origin: '600px 600px' });
s.track($('motif'), { opacity: [[0, 0.9], [1.0, 1]], scale: [[0, 1], [10, 1.03, 'linear']] });

// ---- lockup, headline (words rise in one by one; the emphasised phrase last)
s.track($('lock'), { opacity: [[-0.7, 0], [0.1, 1, 'out']], y: [[-0.7, 16], [0.2, 0, 'out']], blur: [[-0.7, 6], [0.0, 0, 'out']] });
document.querySelectorAll('#head .w').forEach((w, i) => {
  const a = -0.65 + i * 0.035; // 6 (TR) / 9 (EN) words: the last one is in by ~0.15 s, the dissolve zone is composed
  s.track(w, { opacity: [[a, 0], [a + 0.5, 1, 'out']], y: [[a, 24], [a + 0.55, 0, 'out']], blur: [[a, 7], [a + 0.45, 0, 'out']] });
});

// ---- the three links: the wallet first, then the website and the source, 0.16 s apart
['l1', 'l2', 'l3'].forEach((id, i) => {
  const a = 1.5 + i * 0.16;
  s.track($(id), { opacity: [[a, 0], [a + 0.6, 1, 'out']], y: [[a, 26], [a + 0.8, 0, 'out']] });
});

// ---- the caution card, after the links: the card, the icon pops, the text follows, then the one-line reminder
// (card, icon, heading and text start together, so no empty card is ever on screen)
s.track($('caution'), { opacity: [[3.0, 0], [3.5, 1, 'out']], y: [[3.0, 28], [3.8, 0, 'out']] });
s.track($('cic'), { scale: [[3.0, 0.6], [3.7, 1, 'outBack']], opacity: [[3.0, 0], [3.5, 1]] }, { origin: '50% 50%' });
s.track($('chd'), { opacity: [[3.0, 0], [3.5, 1]] });
s.track($('ctx'), { opacity: [[3.0, 0], [3.6, 1, 'out']], y: [[3.0, 10], [3.8, 0, 'out']] });
s.track($('crule'), { opacity: [[4.8, 0], [5.3, 1]], scaleY: [[4.8, 0.2], [5.4, 1, 'out']] });
s.track($('cph'), { opacity: [[4.9, 0], [5.6, 1, 'out']], x: [[4.9, 14], [5.6, 0, 'out']] });
s.track($('foot'), { opacity: [[6.0, 0], [6.8, 1, 'out']] });

// ---- the last 2.5 s: everything rests; only the lockup's facet breathes, and the wallet button glows while a slow light crosses it
s.track($('lock').querySelector('.facet'), { opacity: [[7.0, 1], [8.6, 0.7, 'inOut'], [10, 1, 'inOut']] });
s.track($('l1'), { '--glow': [[7.0, 0], [8.5, 1, 'inOut'], [10, 0.4, 'inOut']] });
s.track($('sheen'), { x: [[7.0, -200], [9.2, 640, 'inOut']], opacity: [[7.0, 0], [7.3, 1], [8.9, 1], [9.2, 0]] });
s.on((t) => {
  const g = parseFloat($('l1').style.getPropertyValue('--glow') || '0');
  $('l1').style.boxShadow = `0 0 ${56 + 20 * g}px -${18 - 6 * g}px color-mix(in srgb, var(--accent) ${((0.5 + 0.22 * g) * 100).toFixed(1)}%, transparent)`;
});
s.grain($('grain'));
await s.start();
