// s09-password: step 4 of 8. Set a password; the wallet opens on Home.
// Beats: starts on the last frame of s08 (cursor where "Continue" was clicked); the camera pushes onto the form; the first
// password is typed (dots, char by char, with a caret), the cursor moves to the second field and the same password is typed
// again; then the filled plate takes over in ONE frame (a hard cut: the form re-flows, the strength bar says "Strong", the
// button turns gold); rings on the strength bar and on the button; click; Home fades in while the camera pulls back; the scene
// ends on Home with a ring around the total balance (s10 starts on the same Home plate).
import { Scene, pick, loadPlates, hash01 } from '/lib/stage.js';
import { tutorialShell } from '/lib/layout.js';

const T = {
  tr: {
    title: 'Şifre belirle',
    sub: 'Şifre cüzdanını bu tarayıcıda kilitler.', // tr.ts password.intro
    n1: 'Unutursan kurtarma kelimelerinle yeniden yüklersin', // password.intro, 2nd sentence
    n2: 'Her harcamada şifren sorulur', // landing tr: features[1] ("her harcamada şifren sorulur"); README "Password on every spend"
  },
  en: {
    title: 'Set a password',
    sub: 'The password locks the wallet in this browser.', // en.ts password.intro
    n1: 'If you forget it, restore from your recovery phrase',
    n2: 'Your password is asked on every spend', // landing en: features[1] ("asked for with your password on every spend")
  },
};
const t = pick(T);
const P = await loadPlates('desktop');
const s = new Scene({ duration: 11 });
const sh = tutorialShell(s, document.getElementById('stage'), { P, step: 4, total: 8, title: t.title, sub: t.sub });
const K = sh.WIN.scale;

// ---- plate layers (DOM order = stacking order; the cursor sits above them all) -----------------------------------
const E = sh.plate('password');            // empty, first field focused
const F1 = sh.plate('password-filled');     // typing the first password (revealed inside pw1)
const Fo = sh.plate('password-filled');     // pw1 once typed, without E's focus ring (focus has moved to pw2)
const F2 = sh.plate('password-filled');     // typing the second password (revealed inside pw2, shifted up to the empty layout)
const FF = sh.plate('password-filled');     // both fields filled, strength bar "Strong", Create wallet enabled (the form re-flows)
const HOME = sh.plate('home');              // the wallet, opened
const W = parseFloat(E.style.width), H = parseFloat(E.style.height);

// ---- typing the dots: the filled plate revealed inside a field, one dot at a time -----------------------------------
const pw1 = sh.rect('password', 'pw1'), pw2 = sh.rect('password', 'pw2');        // the empty layout (what is on screen while typing)
const pw2f = sh.rect('password-filled', 'pw2');                                    // the same field in the re-flowed layout (28 px lower)
const DOTS = [386.5, 465, 17]; // ink extent and count of the dots measured on the plate (the same in both fields)
// T_PW1/T_PW2: the clicks into the fields; T_FULL: the one-frame cut to the re-flowed filled form (after pw2's last dot)
const T_PW1 = 1.2, T_PW2 = 3.3, T_FULL = 5.1, T_SUBMIT = 6.7, T_HOME = T_SUBMIT + 0.1;
/** `field` is the field's box in the plate that `img` shows; `dy` moves it onto the empty layout; the caret is gone from `cut` on. Returns the time of the last dot. */
function typeDots(img, field, dy, t0, cps, seedA, seedB, cut = Infinity) {
  const [x0, x1, n] = DOTS;
  const inner = { x: field.x + 5, y: field.y + 5, w: field.w - 10, h: field.h - 10 };
  const pitch = (x1 - x0 + 1.7) / n;
  const stamps = [];
  let acc = t0;
  for (let i = 0; i < n; i++) {
    stamps.push(acc);
    acc += (1 / cps) * (0.6 + 0.8 * hash01(i * seedA + seedB));
  }
  const R = (x) => 100 - (x / W) * 100;
  const kfs = [[0, R(inner.x)]];
  stamps.forEach((st, i) => kfs.push([st, R(x0 + (i + 1) * pitch + 0.2), 'hold']));
  s.track(img, { y: [[0, dy]], clipT: [[0, (inner.y / H) * 100]], clipB: [[0, ((H - inner.y - inner.h) / H) * 100]], clipL: [[0, (inner.x / W) * 100]], clipR: kfs });
  const caret = document.createElement('div');
  caret.className = 'abs';
  caret.style.cssText = `width:2px;height:${22 * K}px;border-radius:1px;background:var(--accent);z-index:44;top:${(44 + field.y + dy + field.h / 2 - 11) * K}px`;
  sh.overlays.append(caret);
  s.on((tt) => {
    const k = stamps.filter((st) => st <= tt).length;
    caret.style.left = `${(x0 + k * pitch + 2.2) * K}px`;
    caret.style.opacity = tt < t0 - 0.28 || tt > acc + 0.4 || tt >= cut ? 0 : tt < acc + 0.1 ? 1 : 1 - (tt - acc - 0.1) / 0.3;
  });
  return acc;
}
typeDots(F1, pw1, 0, T_PW1 + 0.25, 11, 5, 3);                           // pw1: 1.45 s .. 3.05 s
typeDots(F2, pw2f, pw2.y - pw2f.y, T_PW2 + 0.25, 12, 3, 5, T_FULL);             // pw2: 3.55 s .. 4.9 s
// focus moves to pw2 with the click: pw1 loses E's focus ring (the filled plate's pw1 has none), pw2 gets one (a ring, below)
const out1 = { x: pw1.x - 5, y: pw1.y - 5, w: pw1.w + 10, h: pw1.h + 10 };
s.track(Fo, { clipT: [[0, (out1.y / H) * 100]], clipB: [[0, ((H - out1.y - out1.h) / H) * 100]], clipL: [[0, (out1.x / W) * 100]], clipR: [[0, 100 - ((out1.x + out1.w) / W) * 100]], opacity: [[T_PW2 - 0.05, 0], [T_PW2 + 0.15, 1]] });
// the form re-flows (strength bar appears, pw2 / button move down): a hard one-frame cut, never a dissolve (two layouts would ghost)
s.track(FF, { opacity: [[0, 0], [T_FULL, 1, 'hold']] });
s.track(HOME, { opacity: [[T_HOME, 0], [T_HOME + 0.45, 1, 'inOut']] });

// ---- cursor: begins where s08 ended (the position of its "Continue" click) -------------------------------------------
const prev = sh.rect('create-verify-filled', 'next');
const sub = sh.rect('password-filled', 'submit');
sh.cursor(
  [
    { t: 0.1, x: prev.x + prev.w / 2, y: prev.y + prev.h / 2 },
    { t: T_PW1, x: pw1.x + 120, y: pw1.y + pw1.h / 2, click: true },
    { t: T_PW2, x: 700, y: 470, click: true, from: 3.0 }, // inside the second field both before (432-481) and after (460-509) the re-flow
    { t: T_SUBMIT, x: sub.x + sub.w / 2, y: sub.y + sub.h / 2, click: true, from: 6.0 },
  ],
  { appear: 0.1, leave: T_SUBMIT + 0.5 }
);

// ---- rings, camera, notes ---------------------------------------------------------------------------------------------
// focus ring on pw2 while it is typed; it stops on the very frame of the cut (the plate then carries its own ring, 28 px lower)
const focus2 = sh.ring(pw2, T_PW2, T_FULL + 0.4, { pad: 2.5 });
s.track(focus2, { opacity: [[T_PW2, 0], [T_PW2 + 0.3, 1], [T_FULL - 0.01, 1], [T_FULL, 0, 'linear']] });
// the strength bar and its word ("Güçlü" / "Strong"): ink x 371-907.5, y 402.5-414.5 on the plate; the frame leaves clear margin around the word
sh.ring({ x: 365, y: 400, w: 552, h: 14 }, T_FULL + 0.1, 6.4, { pad: 5 });
sh.ring(sub, 6.1, T_SUBMIT + 0.5, { pad: 7 });
sh.camera([
  { t: 0, rect: null },
  { t: 0.5, rect: null },
  { t: 1.6, rect: { x: 371, y: 100, w: 538, h: 570 }, fill: 1 },
  { t: T_SUBMIT, rect: { x: 371, y: 100, w: 538, h: 570 }, fill: 1 },
  { t: T_SUBMIT + 1.2, rect: null },
]);
const bal = (n) => (n.lastElementChild.style.textWrap = 'balance', n); // no one-word last lines in the panel
bal(sh.note(t.n1, 2.3, { icon: 'key' }));
bal(sh.note(t.n2, T_SUBMIT + 0.9, { icon: 'lock' }));

// ---- the end: Home, a ring around the total, two soft pings --------------------------------------------------------------
const total = sh.rect('home', 'total');
const totalInk = { x: total.x - 2, y: total.y - 1, w: 158, h: total.h + 2 }; // the number and "ZEC" (the target is the full-width block)
sh.ring(totalInk, 8.1, 99, { pad: 11 });
for (const tp of [8.6, 9.3]) {
  const z = sh.toZoom(totalInk), pad = 11;
  const ping = document.createElement('div');
  ping.className = 'hl';
  ping.style.cssText = `left:${z.x - pad}px;top:${z.y - pad}px;width:${z.w + 2 * pad}px;height:${z.h + 2 * pad}px;border-radius:${12 + pad}px;box-shadow:none;border-width:2px`;
  sh.overlays.append(ping);
  s.track(ping, { opacity: [[tp, 0], [tp + 0.04, 0.55], [tp + 0.8, 0, 'out']], scale: [[tp, 1], [tp + 0.8, 1.4, 'out']] });
}

await s.start();
