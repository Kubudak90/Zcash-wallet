// FREE-FORM scene template (acts 1 and 3: brand, ideas, how it works, closing). Copy this directory to
// promo/scenes/<id>/ and edit. Render stills:  node promo/render.mjs scenes/<id> --lang tr --stills 1,3,6 --outdir DIR
// Shows: the engraved C drawing itself, the lockup, kinetic text, the sage/copper privacy chips, a counter.
import { Scene, lang, pick } from '/lib/stage.js';
import { engravedCSVG, lockupHTML, iconSVG } from '/lib/brand.js';

const T = {
  tr: { h1a: 'Gizli para,', h1b: 'senin tarayıcında.', chip1: 'Gizli', chip2: 'Şeffaf · herkese açık', n: 'PBKDF2 turu' },
  en: { h1a: 'Private money,', h1b: 'kept in your browser.', chip1: 'Shielded', chip2: 'Transparent · public', n: 'PBKDF2 rounds' },
};
const t = pick(T);

const stage = document.getElementById('stage');
stage.innerHTML = `
  <div class="glow"></div>
  <div id="motif" class="abs" style="left:560px;top:-60px;width:1200px;height:1200px;color:var(--text)">${engravedCSVG(1200)}</div>
  <div id="copy" class="abs col" style="left:140px;top:300px;width:1000px;gap:30px">
    <div id="eyebrow" class="eyebrow">Zcash</div>
    <div id="h1" class="display" style="font-size:112px">${t.h1a}<br><em>${t.h1b}</em></div>
    <div id="chips" class="row" style="gap:18px"><span class="chip sage"><span class="dot"></span>${t.chip1}</span><span class="chip copper"><span class="dot hollow"></span>${t.chip2}</span></div>
    <div id="num" class="display" style="font-size:96px;color:var(--accent-fg)">0</div>
  </div>
  <div id="lock" class="abs" style="left:140px;top:90px">${lockupHTML(84)}</div>
  <div class="vignette"></div><div class="grain" id="grain"></div>`;
const $ = (id) => document.getElementById(id);
const s = new Scene({ duration: 8 });

document.querySelectorAll('.ec-band, .ec-sil').forEach((p, i) => s.track(p, { draw: [[0.1 + i * 0.03, 0], [1.6 + i * 0.03, 1, 'inOut']] }));
document.querySelectorAll('.ec-echo').forEach((p) => s.track(p, { draw: [[0.4 + 0.05 * p.dataset.i, 0], [2.0 + 0.05 * p.dataset.i, 1, 'out']] }));
s.track(document.querySelector('.ec-facet'), { draw: [[1.0, 0], [1.9, 1, 'out']] });
s.track($('motif'), { x: [[0, 60], [8, 0, 'linear']] });
s.track($('lock'), { opacity: [[0.3, 0], [0.9, 1]] });
s.track($('eyebrow'), { opacity: [[1.0, 0], [1.5, 1]] });
s.track($('h1'), { opacity: [[1.2, 0], [1.9, 1]], y: [[1.2, 30], [2.0, 0, 'out']], blur: [[1.2, 10], [1.9, 0]] });
s.track($('chips'), { opacity: [[2.4, 0], [2.9, 1]], y: [[2.4, 20], [3.0, 0, 'out']] });
s.count($('num'), { from: 0, to: 600000, t0: 3.2, t1: 5.2, fmt: (v) => Math.round(v).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US') });
s.track($('num'), { opacity: [[3.2, 0], [3.6, 1]] });
s.grain($('grain'));
await s.start();
