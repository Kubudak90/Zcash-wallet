// s06-open-wallet: step 1 of 8, the first tutorial scene (it comes after the bumper, which dissolves into it).
// Beats: the window and panel stand composed from the first frame (the first 0.5 s is cross-dissolved with s05); ring + callout
// on the real address in the URL bar; ring on the language switch (note 1); ring on the first pillar (note 2); the camera pushes
// onto the "Get started" cards, the cursor goes to "Create a new wallet", clicks, the recovery-phrase screen takes over, the camera
// pulls back and the cursor rests where it clicked (s07 starts from that exact frame, camera at rest).
import { Scene, pick, loadPlates } from '/lib/stage.js';
import { tutorialShell, WIN } from '/lib/layout.js';

const T = {
  tr: {
    title: 'Cüzdanı aç',
    // landing tr: lede ("açılacak bir hesap yoktur"); README: "Wallet: https://app.celariwallet.com"
    sub: 'app.celariwallet.com adresini aç. Hesap açmana gerek yok.',
    callLabel: 'Cüzdan',
    // plate welcome: the English / Türkçe switch top right (en.ts settings.language); target welcome.language
    n1: 'Dil sağ üstten değişir: <span style="white-space:nowrap">English / Türkçe</span>',
    // tr.ts welcome.pillar1 ("Anahtarların tarayıcından çıkmaz, şifreyle kilitlenir"); README Features
    n2: 'Anahtarların tarayıcından çıkmaz',
  },
  en: {
    title: 'Open the wallet',
    sub: 'Go to app.celariwallet.com. There is no account to make.',
    callLabel: 'Wallet',
    n1: 'Switch language top right: <span style="white-space:nowrap">English / Türkçe</span>',
    n2: 'Your keys never leave your browser',
  },
};
const t = pick(T);
const P = await loadPlates('desktop');
const s = new Scene({ duration: 10 });
const stage = document.getElementById('stage');
// first: false = the window is in place from t=0 (lib's `first: true` fades and lifts it in over the first 0.7-1.0 s, which would
// leave the s05 -> s06 dissolve half empty); the panel's entrance tracks are overridden below for the same reason
const sh = tutorialShell(s, stage, { P, step: 1, total: 8, title: t.title, sub: t.sub });
for (const id of ['badge', 'title', 'sub']) s.track(document.getElementById(id), { opacity: [[0, 1]], y: [[0, 0]] }); // composed at t=0
const K = WIN.scale;

// ---- plates: welcome -> create-seed-hidden ----------------------------------------------------------
const welcome = sh.plate('welcome'), seed = sh.plate('create-seed-hidden');
const TCLICK = 8.0; // the click on "Create a new wallet"
s.swap([welcome, seed], [0, TCLICK + 0.1], { fade: 0.4 });

// ---- the real address in the URL bar (shell chrome, outside the plate): its box in plate px --------------
const ob = sh.overlays.getBoundingClientRect(), ub = stage.querySelector('.url').getBoundingClientRect();
const urlRect = { x: (ub.x - ob.x) / K, y: (ub.y - ob.y) / K - WIN.bar, w: ub.width / K, h: ub.height / K };
sh.ring(urlRect, 1.0, 3.3, { pad: 7 });
sh.callout(urlRect, `<span style="display:flex;align-items:baseline;gap:16px"><span style="color:var(--muted);font-weight:500">${t.callLabel}</span><span class="mono" style="font-size:28px;letter-spacing:-.01em;color:var(--text)">app.celariwallet.com</span></span>`, 1.25, 3.3, { side: 'below', maxWidth: 640, dy: 6 });

const bal = (n) => (n.lastElementChild.style.textWrap = 'balance', n); // no one-word last lines in the panel

// ---- language switch (the plate's target is the Türkçe pill; the ring takes in the whole switch) ---------
const lang = sh.rect('welcome', 'language');
const langAll = { x: lang.x - 112, y: lang.y - 3, w: lang.w + 112 + 6, h: lang.h + 6 };
sh.ring(langAll, 3.4, 4.9, { pad: 7 });
bal(sh.note(t.n1, 3.5, { icon: 'globe' }));

// ---- first pillar: keys never leave the browser ---------------------------------------------------------
const pil = sh.rect('welcome', 'pillars');
const pil1 = { x: pil.x - 6, y: pil.y - 6, w: 184, h: pil.h + 12 }; // the first of the three columns
sh.ring(pil1, 4.9, 6.3, { pad: 6 });
bal(sh.note(t.n2, 5.0, { icon: 'lock' }));

// ---- the click on "create" -------------------------------------------------------------------------------
const create = sh.rect('welcome', 'create'), restore = sh.rect('welcome', 'restore');
const cx = create.x + create.w * 0.5, cy = create.y + create.h * 0.5;
// the create target is only the card's header row; the card runs on to y = 597.5 on both plates (measured: its list of three steps)
const card = { x: create.x, y: create.y, w: create.w, h: 597.5 - create.y };
sh.ring(card, 7.3, TCLICK + 0.6, { pad: 8 });
sh.cursor(
  [
    { t: 3.6, x: lang.x + lang.w - 36, y: lang.y + lang.h + 14 }, // points at the language switch while it is explained
    { t: TCLICK, x: cx, y: cy, from: 6.3 },
  ],
  { appear: 0.5 }
);
// the cursor is a tracked item of the shell; it holds its last point to the end of the scene (no `leave`): s07 starts there

// ---- camera: onto the "Get started" cards (heading + both cards), back to rest before the end (s07 starts at rest) ---------
// the frame is centred at plate x = 885 so the view stays inside the plate (it ends at x = 1270 of 1280 in English)
const top = create.y - 100, bottom = restore.y + restore.h;
const frame = { x: 885 - create.w / 2, y: top, w: create.w, h: bottom - top };
sh.camera([
  { t: 0, rect: null },
  { t: 6.25, rect: null },
  { t: 7.35, rect: frame, fill: 0.6 },
  { t: TCLICK + 0.6, rect: frame, fill: 0.6 },
  { t: 9.4, rect: null },
]);

await s.start();
