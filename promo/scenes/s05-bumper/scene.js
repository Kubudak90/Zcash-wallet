// s05-bumper: the chapter card that opens the how-to act. Free-form (template: _template-promo).
// Beats: the lockup, title and sub come up at 0.4-0.9 s (s04's text sits at the same coordinates, so the cross-dissolve shows only s04 until it is nearly over); a large,
// faint engraved C behind them is already mostly drawn at t=0 and finishes; after 0.5 s the numbered card arrives and its eight
// steps stagger in 0.15 s apart; the numerals light up one by one; a chip says the screens are the real interface with demo data.
import { Scene, pick } from '/lib/stage.js';
import { engravedCSVG, lockupHTML, iconSVG } from '/lib/brand.js';

// Titles and step names: STORYBOARD.md s05 (the eight steps are the eight scenes of act 2, s06-s13). Each name is exactly the
// title of the panel in the scene it introduces (s07 '24 kelimeyi yaz' / 'Write the 24 words', s08 'Yedeğini doğrula' / 'Verify the backup').
// The chip is the shell's own statement: plates are the real UI running on the scripted demo engine (BUILD.md, "Plates").
const T = {
  tr: {
    h1a: 'Nasıl',
    h1b: 'kullanılır',
    sub: 'Sekiz adımda Celari.',
    chip: 'Gerçek arayüz · demo verisi',
    steps: ['Cüzdanı aç', '24 kelimeyi yaz', 'Yedeğini doğrula', 'Şifre belirle', 'ZEC al', 'ZEC gönder', 'Gizliye aktar', 'Geçmiş, ayarlar, kilit'],
  },
  en: {
    h1a: 'How to',
    h1b: 'use it',
    sub: 'Celari in eight steps.',
    chip: 'Real interface · demo data',
    steps: ['Open the wallet', 'Write the 24 words', 'Verify the backup', 'Set a password', 'Receive ZEC', 'Send ZEC', 'Shield funds', 'History, settings, lock'],
  },
};
const t = pick(T);

const rows = t.steps
  .map(
    (name, i) => `
    <div class="row-i" style="display:flex;align-items:center;height:84px;padding:0 8px 0 4px;${i < 7 ? 'border-bottom:1.5px solid var(--border);' : ''}">
      <span class="num mono" style="width:92px;flex:none;font-size:30px;font-weight:560;letter-spacing:.02em;color:var(--accent-fg)">${String(i + 1).padStart(2, '0')}</span>
      <span style="font-size:31px;font-weight:500;letter-spacing:-.005em;color:var(--text)">${name}</span>
    </div>`
  )
  .join('');

// the engraved C is large and faint behind the title (storyboard): the silhouette is ~17% of the box, so a 4400 px box gives a C
// about 750 px wide; centred in the gap between the headline and the card (the gold facet stays clear of the text, the card covers
// the right arms of the C), its echoes fill the frame
const MS = 4400, MC = { x: 900, y: 540 };
const stage = document.getElementById('stage');
stage.innerHTML = `
  <div class="glow"></div>
  <div id="motif" class="abs" style="left:${MC.x - MS / 2}px;top:${MC.y - MS / 2}px;width:${MS}px;height:${MS}px;color:var(--text)">${engravedCSVG(MS)}</div>
  <div id="lock" class="abs" style="left:140px;top:96px">${lockupHTML(68)}</div>
  <div id="copy" class="abs col" style="left:140px;top:340px;width:840px">
    <h1 id="h1" class="display" style="margin:0;font-size:120px;line-height:1.06">${t.h1a}<br><em>${t.h1b}</em></h1>
    <div id="sub" class="lede" style="margin-top:34px;font-size:46px;line-height:1.3;color:var(--muted)">${t.sub}</div>
  </div>
  <div id="chip" class="abs" style="left:140px;top:924px"><span class="chip" style="font-size:24px"><span style="color:var(--accent-fg);display:flex">${iconSVG('info', 28)}</span>${t.chip}</span></div>
  <div id="card" class="abs card" style="left:1040px;top:168px;width:744px;height:744px;padding:36px 40px 36px 44px;background:rgba(22,21,18,.93);border-radius:32px">
    ${rows}
  </div>
  <div class="vignette"></div><div class="grain" id="grain"></div>`;
const $ = (id) => document.getElementById(id);
const D = 5;                       // scene duration
const s = new Scene({ duration: D });

// the engraved C: already mostly drawn at t=0 (negative start times), it finishes while the dissolve from s04 ends; the facet
// lights after the dissolve; a slow drift to the end
document.querySelectorAll('.ec-band, .ec-sil').forEach((p, i) => s.track(p, { draw: [[-0.5 + i * 0.025, 0], [1.4 + i * 0.025, 1, 'out']] }));
document.querySelectorAll('.ec-echo').forEach((p) => s.track(p, { draw: [[-0.3 + 0.04 * p.dataset.i, 0], [1.8 + 0.04 * p.dataset.i, 1, 'out']] }));
s.track(document.querySelector('.ec-facet'), { draw: [[0.7, 0], [1.6, 1, 'out']] });
s.track($('motif'), { x: [[0, 36], [5, -14, 'linear']], scale: [[0, 1.0], [5, 1.035, 'linear']] });

// lockup, title and sub sit at the same coordinates as s04's text, so they stay at 0 until the dissolve from s04 is nearly over (0.4 s;
// s04's end frame stays alone there, then they come up on the faint C + echo field in a 0.5 s rise); the card follows at 0.5 s.
// At the end they leave EARLIER than the card and the chip (4.2 -> 4.6 s): they sit over s06's window headline and logo, which show
// through the 4.5-4.9 s dissolve, while the card and the chip land on s06's empty panel area (the C field and the card stay composed).
const FADE = [D - 0.5, D - 0.1];   // the card and the chip leave over the last 0.4 s: s06's window and panel arrive under them (the C field stays)
const TXT_OUT = [D - 0.8, D - 0.4];
const txt = (el) => s.track(el, { opacity: [[0.4, 0], [0.9, 1, 'out'], [TXT_OUT[0], 1], [TXT_OUT[1], 0, 'linear']] });
txt($('lock'));   // the lockup leaves too: s06's own window carries the same logo at nearly the same spot
txt($('h1'));
txt($('sub'));
s.track($('card'), { opacity: [[0.5, 0], [1.0, 1], [FADE[0], 1], [FADE[1], 0, 'linear']], y: [[0.5, 26], [1.25, 0, 'out']] });
document.querySelectorAll('.row-i').forEach((r, i) => {
  const t0 = 0.75 + i * 0.15;
  s.track(r, { opacity: [[t0, 0], [t0 + 0.55, 1]], x: [[t0, 34], [t0 + 0.75, 0, 'out']] });
  // the numerals light up one by one, like a checklist being read
  const n = r.querySelector('.num');
  const t1 = 2.35 + i * 0.16;
  s.track(n, { opacity: [[0, 0.5], [t1, 0.5], [t1 + 0.45, 1]] });
});
s.track($('chip'), { opacity: [[1.7, 0], [2.2, 1], [FADE[0], 1], [FADE[1], 0, 'linear']], y: [[1.7, 16], [2.3, 0, 'out']] });
s.grain($('grain'));
await s.start();
