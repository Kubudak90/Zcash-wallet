// s07-recovery: step 2 of 8. The 24 recovery words.
// Beats: the cursor (carried over from s06's click) presses "Reveal words"; the grid appears and the camera pushes onto the
// lower half of the card; the words stay readable for about 2 s, then blur (they are a throwaway demo phrase) under a
// "Demo words" chip; the cursor ticks the checkbox and presses Continue; the camera pulls back on the next screen (s08's first frame).
import { Scene, pick, loadPlates, plateEl } from '/lib/stage.js';
import { tutorialShell } from '/lib/layout.js';
import { iconSVG } from '/lib/brand.js';

const T = {
  tr: {
    title: '24 kelimeyi yaz',
    sub: 'Bu kelimeler cüzdanının tek yedeği. Sırasıyla kağıda yaz.', // tr.ts create.seedIntro
    n1: 'Kimseyle paylaşma', // create.seedWarn1
    n2: 'Ekran görüntüsü alma', // create.seedWarn2
    n3: 'Kaybedersen paran kurtarılamaz', // create.seedWarn3
    demo: 'Demo kelimeleri', // BUILD.md "Plates": the 24 words are a throwaway demo phrase
  },
  en: {
    title: 'Write the 24 words',
    sub: 'These words are the only backup of your wallet. Write them down in order.', // en.ts create.seedIntro
    n1: 'Never share them',
    n2: 'Do not screenshot them',
    n3: 'If you lose them, your funds cannot be recovered', // en.ts create.seedWarn3 ("If you lose these words, your funds cannot be recovered.")
    demo: 'Demo words',
  },
};
const t = pick(T);
const P = await loadPlates('desktop');
const s = new Scene({ duration: 10 });
const sh = tutorialShell(s, document.getElementById('stage'), { P, step: 2, total: 8, title: t.title, sub: t.sub });

// ---- plates --------------------------------------------------------------------------------------------
const hidden = sh.plate('create-seed-hidden'), revealed = sh.plate('create-seed-revealed'), checked = sh.plate('create-seed-checked');
const verify = sh.plate('create-verify'); // the next screen: s08 starts on it
const T_REVEAL = 1.35, T_TICK = 5.6, T_NEXT = 7.0, T_BLUR = 3.7;
s.swap([hidden, revealed, checked], [0, T_REVEAL + 0.1, T_TICK + 0.1], { fade: 0.3 });
verify.style.zIndex = '6';
s.track(verify, { opacity: [[T_NEXT + 0.1, 0], [T_NEXT + 0.45, 1, 'inOut']] });

// ---- the blur over the words: a small box holding the revealed plate, blurred and clipped to the grid ----
const grid = sh.rect('create-seed-revealed', 'grid');
const PAD = 40, INSET = 4;
const BW = grid.w + 2 * PAD, BH = grid.h + 2 * PAD;
const box = document.createElement('div');
box.style.cssText = `position:absolute;left:${grid.x - PAD}px;top:${grid.y - PAD}px;width:${BW}px;height:${BH}px;overflow:hidden;z-index:5`;
const bimg = plateEl(P, 'create-seed-revealed');
bimg.style.cssText += `;position:absolute;left:${-(grid.x - PAD)}px;top:${-(grid.y - PAD)}px`;
box.append(bimg);
sh.screen.insertBefore(box, sh.cursorEl);
const cl = (PAD + INSET) / BW * 100, ct = (PAD + INSET) / BH * 100;
s.track(box, {
  opacity: [[T_BLUR, 0], [T_BLUR + 0.3, 1]],
  blur: [[T_BLUR, 0], [T_BLUR + 0.5, 12]],
  clipL: [[0, cl]], clipR: [[0, cl]], clipT: [[0, ct]], clipB: [[0, ct]],
});
// the verify plate (z 6) covers it once the next screen takes over

// ---- cursor: starts exactly where s06 ended (its click on "create") ------------------------------------
const create = sh.rect('welcome', 'create');
const rev = sh.rect('create-seed-hidden', 'reveal');
const chk = sh.rect('create-seed-revealed', 'check');
const nxt = sh.rect('create-seed-checked', 'next');
const mid = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
sh.cursor(
  [
    { t: 0.1, x: create.x + create.w / 2, y: create.y + create.h / 2 },
    { t: T_REVEAL, ...mid(rev), click: true, from: 0.5 }, // rests (as in s06's last frame) until the s06 -> s07 dissolve is over, then moves
    { t: 2.4, x: 890, y: 872 }, // out of the way while the words are being read
    { t: T_TICK, ...mid(chk), click: true, from: 4.5 },
    { t: T_NEXT, ...mid(nxt), click: true, from: 6.2 },
  ],
  { appear: 0.1 }
);

// ---- camera: onto the grid, the tick and the button; back to the full window on the next screen ---------
const frame = { x: 320, y: 530, w: 640, h: 542 }; // fill 1 = 2.0x: the grid, the tick and the button; no half-cut text above
sh.camera([
  { t: 0, rect: null },
  { t: 1.7, rect: null },
  { t: 2.9, rect: frame, fill: 1 },
  { t: T_NEXT, rect: frame, fill: 1 },
  { t: T_NEXT + 1.3, rect: null, ease: 'out' }, // quick at first: the new screen's card is already in view when it fades in
]);

// ---- rings and the "demo words" chip (overlays live in the camera's space) ---------------------------------
sh.ring(chk, 5.0, T_TICK + 0.5, { pad: 7 });
sh.ring(nxt, 6.3, T_NEXT + 0.35, { pad: 8 });
const gz = sh.toZoom(grid);
const chip = document.createElement('div');
chip.className = 'abs';
chip.style.cssText = `left:${gz.x + gz.w / 2}px;top:${gz.y + gz.h / 2}px;translate:-50% -50%;z-index:45`;
chip.innerHTML = `<span class="chip gold" style="font-size:15px;padding:7px 16px;gap:9px;background:rgba(22,21,18,.96)"><span style="display:flex">${iconSVG('eyeOff', 20)}</span>${t.demo}</span>`;
sh.overlays.append(chip);
s.track(chip, { opacity: [[T_BLUR + 0.35, 0], [T_BLUR + 0.8, 1], [T_NEXT - 0.1, 1], [T_NEXT + 0.2, 0]], y: [[T_BLUR + 0.35, 10], [T_BLUR + 0.9, 0, 'out']] });

// ---- panel notes, one by one --------------------------------------------------------------------------------
const bal = (n) => (n.lastElementChild.style.textWrap = 'balance', n); // two even lines, never a one-word last line
bal(sh.note(t.n1, 2.2, { icon: 'lock' }));
bal(sh.note(t.n2, 3.5, { icon: 'eyeOff' }));
const n3 = bal(sh.note(t.n3, 4.8, { icon: 'alert' }));
n3.firstElementChild.style.color = 'var(--warn)';

await s.start();
