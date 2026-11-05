// s01-open (8.2 s) · free-form · act 1 opening.
// The engraved C draws itself on black, the gold facet lights, the lockup rises, then the tagline.
// Quiet, no UI. Continues into s02-default, which starts from the same faint C + echo field.
import { Scene, lang, pick, ease } from '/lib/stage.js';
import { engravedCSVG, lockupHTML } from '/lib/brand.js';

document.documentElement.lang = lang; // so text-transform: uppercase handles Turkish i / İ

const T = {
  // TR/EN: src/i18n/{tr,en}.ts welcome.tagline (the same line is landing's hero copy). '*' marks the emphasised phrase.
  tr: { tagline: ['Zcash için açık kaynak,', '*gizlilik öncelikli* tarayıcı cüzdanı.'], etym: 'Celare (Latince): gizlemek.' }, // etym: README "Celare (Latin): to hide, to conceal."
  en: { tagline: ['An open-source, *privacy-first*', 'browser wallet for Zcash.'], etym: 'Celare (Latin): to hide.' },      // README
};
const t = pick(T);

/** "a *b c* d" -> inline-block word spans (the emphasised words in <em>), so words can enter one by one. */
function words(line) {
  return line.split(/(\*[^*]+\*)/).filter(Boolean).flatMap((part) => {
    const em = part.startsWith('*');
    return (em ? part.slice(1, -1) : part).split(' ').filter(Boolean).map((w) => `<span class="w">${em ? `<em>${w}</em>` : w}</span>`);
  }).join(' ');
}

const SIZE = 2400; // the engraved C: silhouette ~390 x 450 px at this size, echoes run out of the frame
const stage = document.getElementById('stage');
stage.innerHTML = `
  <div class="glow"></div>
  <div id="spark" class="abs" style="left:${960 - 520}px;top:${540 - 420}px;width:1040px;height:840px;background:radial-gradient(50% 50% at 47% 50%, rgba(244,183,40,.34), rgba(244,183,40,0) 70%)"></div>
  <div id="motif" class="abs" style="left:${960 - SIZE / 2}px;top:${540 - SIZE / 2}px;width:${SIZE}px;height:${SIZE}px;color:var(--text)">${engravedCSVG(SIZE)}</div>
  <div id="scrim" class="abs" style="left:160px;top:190px;width:1600px;height:700px;background:radial-gradient(50% 50% at 50% 50%, rgba(13,12,10,.9), rgba(13,12,10,.62) 52%, rgba(13,12,10,0) 100%)"></div>
  <div id="lock" class="abs row" style="left:0;top:480px;width:1920px;height:120px;justify-content:center;color:var(--text)">${lockupHTML(120)}</div>
  <div id="tag" class="abs display" style="left:0;top:492px;width:1920px;text-align:center;font-size:92px;line-height:1.1">
    <div id="l1">${words(t.tagline[0])}</div><div id="l2">${words(t.tagline[1])}</div>
  </div>
  <div id="etym" class="eyebrow plain" style="position:absolute;left:0;top:742px;width:1920px;justify-content:center;font-size:28px;letter-spacing:.12em;color:var(--muted)">${t.etym}</div>
  <div class="vignette"></div><div class="grain" id="grain"></div>`;
const $ = (id) => document.getElementById(id);
const s = new Scene({ duration: 8.2 });

// ---- 0 - 2.6 s: the C draws itself: silhouette + inner lines, echoes ripple outward, the facet lights last
const lines = [...document.querySelectorAll('.ec-sil, .ec-band')];
lines.forEach((p, i) => s.track(p, { draw: [[0.2 + i * 0.045, 0], [1.75 + i * 0.045, 1, 'inOut']] }));
document.querySelectorAll('.ec-echo').forEach((p) => {
  const i = +p.dataset.i;
  s.track(p, { draw: [[0.55 + 0.075 * i, 0], [2.0 + 0.075 * i, 1, 'out']], scale: [[0.55 + 0.075 * i, 0.93], [2.1 + 0.075 * i, 1, 'out']] }, { origin: '600px 600px' });
});
// outward drift of all echoes to the very end (the same state is the start of s02-default: scale 1.06 at the end)
s.track(document.querySelector('.ec-echoes'), { scale: [[2.0, 1], [8.2, 1.06, 'linear']] }, { origin: '600px 600px' });
// the facet outline fades with the fill (2.6 - 3.4 s) so the lockup's own C does not sit on a second gold crescent; s02 starts from 0.15
s.track(document.querySelector('.ec-facet'), { draw: [[1.05, 0], [1.95, 1, 'out']], opacity: [[2.6, 1], [3.4, 0.15, 'inOut']] });
const fill = document.querySelector('.ec-facet-fill');
fill.setAttribute('fill-opacity', '1');
s.track(fill, { opacity: [[1.9, 0], [2.4, 0.92, 'out'], [2.45, 0.92], [3.1, 0.1, 'inOut']] });
s.track($('spark'), { opacity: [[1.6, 0], [2.1, 1, 'out'], [2.4, 1], [3.3, 0.08, 'inOut']], scale: [[1.6, 0.8], [3.0, 1.1, 'out']] });

// the C steps back into the field behind the words: it grows and goes quiet (s02 starts from this state)
s.track($('motif'), { scale: [[2.3, 1], [4.6, 1.75, 'inOut'], [8.2, 1.9, 'linear']], opacity: [[2.4, 1], [4.0, 0.55, 'inOut']] });

// ---- lockup 2.2 - 3.2 s, then it rises to make room for the tagline
s.track($('scrim'), { opacity: [[2.7, 0], [3.9, 1, 'inOut']] });
s.track($('lock'), {
  opacity: [[2.8, 0], [3.7, 1, 'out']],
  y: [[2.8, 26], [3.7, 0, 'out'], [3.72, 0], [4.25, -162, 'inOut']],   // it has risen clear of the tagline's first line (top 492) by ~4.1 s
  blur: [[2.8, 9], [3.5, 0, 'out']],
});

// ---- tagline 4.0 - 5.4 s: words rise in one by one, the emphasised phrase last; it then holds (to the dissolve at 7.7 s)
const ws = [...document.querySelectorAll('#tag .w')];
ws.forEach((w, i) => {
  const a = 4.0 + i * 0.10;
  s.track(w, { opacity: [[a, 0], [a + 0.7, 1, 'out']], y: [[a, 22], [a + 0.85, 0, 'out']], blur: [[a, 7], [a + 0.6, 0, 'out']] });
});
s.track($('etym'), { opacity: [[5.3, 0], [6.1, 1, 'out']], y: [[5.3, 12], [6.1, 0, 'out']] });

s.grain($('grain'));
await s.start();
