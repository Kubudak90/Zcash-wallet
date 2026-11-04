// s08-verify: step 3 of 8. Celari asks for three of the words again.
// Beats: starts on the exact last frame of s07 (cursor on the button position); the camera pushes onto the form; the
// three words are typed one after another (the filled plate is revealed over each empty field, char by char, with a
// caret); the whole filled plate takes over (the button turns gold); a ring on Continue, a click, and the password screen
// (s09's first frame) fades in while the camera pulls back.
import { Scene, pick, loadPlates, hash01 } from '/lib/stage.js';
import { tutorialShell } from '/lib/layout.js';

const T = {
  tr: {
    title: 'Yedeğini doğrula',
    sub: 'Celari kağıttan üç kelimeyi tekrar ister.', // paraphrase of tr.ts create.verifyIntro ("Yazdığın kağıda bakarak şu kelimeleri gir:"); three fields: CreateWallet.tsx pickVerificationPositions(3)
    n1: 'Yanlışsa devam edemezsin: kağıdına bak', // create.verifyError "Kelimeler eşleşmedi. Kağıdını kontrol et."; CreateWallet.tsx: only a match goes on
  },
  en: {
    title: 'Verify the backup',
    sub: 'Celari asks for three of the words again.', // paraphrase of en.ts create.verifyIntro ("Looking at your paper, enter these words:"); three fields: CreateWallet.tsx pickVerificationPositions(3)
    n1: 'A wrong word stops you: check your paper',
  },
};
const t = pick(T);
const P = await loadPlates('desktop');
const s = new Scene({ duration: 9 });
const sh = tutorialShell(s, document.getElementById('stage'), { P, step: 3, total: 8, title: t.title, sub: t.sub });
const K = sh.WIN.scale;

// ---- plate layers (DOM order = stacking order; the cursor sits above them all) ---------------------------------
const E = sh.plate('create-verify');                 // empty, first field focused
const F1 = sh.plate('create-verify-filled');          // typing field 1
const F2 = sh.plate('create-verify-filled');          // typing field 2
const F3 = sh.plate('create-verify-filled');          // typing field 3
const Fo = sh.plate('create-verify-filled');          // field 1 once typed, without E's focus ring
const FF = sh.plate('create-verify-filled');          // everything typed: focus ring on field 3, Continue enabled
const NEXT = sh.plate('password');                    // the next screen (s09 starts on it)
const W = parseFloat(E.style.width), H = parseFloat(E.style.height);

// field boxes (plate px): three equal inputs under the form's labels; ink extents of the typed words measured on the plates
const form = sh.rect('create-verify', 'form');
const GAP = 14.1, FW = (form.w - 2 * GAP) / 3, FY = 318.1, FH = 48.6;
const field = (i) => ({ x: form.x + i * (FW + GAP), y: FY, w: FW, h: FH });
const WORDS = {
  tr: [[387, 439, 6], [571, 605, 4], [754.5, 825, 8]], // rubber · fire · accident (the plate's words 7, 15, 18)
  en: [[387, 439, 6], [570.5, 641, 8], [755, 807, 6]], // saddle · daughter · office (the plate's words 2, 5, 13)
};
const words = pick(WORDS);

const inset = (r, d) => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });
const clipRect = (img, r) => ({ clipT: [[0, (r.y / H) * 100]], clipB: [[0, ((H - r.y - r.h) / H) * 100]], clipL: [[0, (r.x / W) * 100]], clipR: [[0, 100 - ((r.x + r.w) / W) * 100]] });

// typing: the filled plate is revealed inside the field, one character at a time (human rhythm), with a gold caret
function typeInto(img, inner, [x0, x1, n], t0, cps) {
  const pitch = (x1 - x0 + 1.2) / n;
  const stamps = [];
  let acc = t0;
  for (let i = 0; i < n; i++) {
    stamps.push(acc);
    acc += (1 / cps) * (0.6 + 0.8 * hash01(i * 3 + n + Math.round(t0 * 10)));
  }
  const R = (x) => 100 - (x / W) * 100;
  const kfs = [[0, R(inner.x)]];
  stamps.forEach((st, i) => kfs.push([st, R(x0 + (i + 1) * pitch + 0.2), 'hold']));
  s.track(img, { clipT: [[0, (inner.y / H) * 100]], clipB: [[0, ((H - inner.y - inner.h) / H) * 100]], clipL: [[0, (inner.x / W) * 100]], clipR: kfs });
  const caret = document.createElement('div');
  caret.className = 'abs';
  caret.style.cssText = `width:2px;height:${22 * K}px;border-radius:1px;background:var(--accent);z-index:44;top:${(44 + FY + FH / 2 - 11) * K}px`;
  sh.overlays.append(caret);
  const end = acc;
  s.on((t) => {
    const k = stamps.filter((st) => st <= t).length;
    caret.style.left = `${(x0 + k * pitch + 1.4) * K}px`;
    caret.style.opacity = t < t0 - 0.28 || t > end + 0.35 ? 0 : t < end + 0.05 ? 1 : 1 - (t - end - 0.05) / 0.3;
  });
  return end;
}

// ---- timeline -----------------------------------------------------------------------------------------------
const T_F1 = 1.2, T_F2 = 2.5, T_F3 = 3.6, T_FULL = 4.9, T_NEXT = 5.9;
const f = [field(0), field(1), field(2)];
typeInto(F1, inset(f[0], 5), words[0], T_F1 + 0.25, 9);
typeInto(F2, inset(f[1], 5), words[1], T_F2 + 0.25, 9);
typeInto(F3, inset(f[2], 5), words[2], T_F3 + 0.25, 9);
// field 1 loses E's focus ring when the cursor moves on
const out = { x: f[0].x - 5, y: f[0].y - 5, w: f[0].w + 10, h: f[0].h + 10 };
s.track(Fo, { ...clipRect(Fo, out), opacity: [[T_F2 - 0.05, 0], [T_F2 + 0.15, 1]] });
s.track(FF, { opacity: [[T_FULL, 0], [T_FULL + 0.3, 1, 'inOut']] });
s.track(NEXT, { opacity: [[T_NEXT + 0.1, 0], [T_NEXT + 0.45, 1, 'inOut']] });

// focus follows the cursor: a ring on field 2, then field 3 (field 1 and the last state carry the plate's own ring)
sh.ring(f[1], T_F2, T_F3 + 0.25, { pad: 2.5 });
sh.ring(f[2], T_F3, T_FULL + 0.3, { pad: 2.5 });

// ---- cursor: begins where s07 ended (the position of its "Continue" click) -------------------------------------
const prev = sh.rect('create-seed-checked', 'next');
const at = (i, dx = 0.3) => ({ x: f[i].x + f[i].w * dx, y: FY + FH / 2 });
const nx = sh.rect('create-verify-filled', 'next');
sh.cursor(
  [
    { t: 0.1, x: prev.x + prev.w / 2, y: prev.y + prev.h / 2 },
    { t: T_F1, ...at(0, 0.62), click: true },
    { t: T_F2, ...at(1, 0.7), click: true, from: 2.12 },
    { t: T_F3, ...at(2, 0.7), click: true, from: 3.3 },
    { t: T_NEXT, x: nx.x + nx.w / 2, y: nx.y + nx.h / 2, click: true, from: 4.95 },
  ],
  { appear: 0.1 }
);

// ---- ring on Continue, camera, note ---------------------------------------------------------------------------------
sh.ring(nx, 5.1, T_NEXT + 0.4, { pad: 7 });
sh.camera([
  { t: 0, rect: null },
  { t: 0.5, rect: null },
  { t: 1.7, rect: form, fill: 0.8 },
  { t: 6.1, rect: form, fill: 0.8 },
  { t: 7.6, rect: null },
]);
const n1 = sh.note(t.n1, 3.3, { icon: 'alert' });
n1.lastElementChild.style.textWrap = 'balance'; // two even lines, never a one-word last line
n1.firstElementChild.style.color = 'var(--warn)';

await s.start();
