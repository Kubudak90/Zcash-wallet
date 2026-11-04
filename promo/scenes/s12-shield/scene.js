// s12-shield (step 7 of 8): move the transparent balance into the shielded pool, in one click.
// Plates: home-after-send -> shield-confirm -> shield-confirm-filled -> shield-success -> home-final (all desktop).
// (home-after-send is where step 6 leaves the wallet: 0,50 ZEC sits in the transparent balance.)
// Claims: README (Features: One-click shielding), src/i18n/en.ts + tr.ts (shield.*, home.transparentHelp); sources next to the strings.
import { Scene, lang, pick, loadPlates } from '/lib/stage.js';
import { tutorialShell } from '/lib/layout.js';

const T = {
  tr: {
    title: 'Gizliye aktar', // shield.title
    sub: 'Şeffaf bakiye herkese açıktır. Tek tıkla gizli havuza taşı.', // home.transparentHelp ("Zincirde herkese açık"), landing features[0]
    n1: 'Hepsi tek işlemde, Ironwood havuzuna', // README Features: One-click shielding ("all of it, in one transaction", in Ironwood); shield.toIronwood
    n2: 'Ücret bu tutardan düşülür', // shield.intro ("Ağ ücreti bu tutardan düşülür"), shield.fee
    n3: 'Bu işlemde tutar ve şeffaf adres zincirde görünür', // shield.intro ("Tutar ve şeffaf adresin zincirde görünür")
  },
  en: {
    title: 'Shield funds', // shield.title
    sub: 'A transparent balance is public. Move it to the shielded pool in one click.', // home.transparentHelp ("Public on chain"), landing features[0]
    n1: 'All of it, in one transaction, into the Ironwood pool', // README Features: One-click shielding; shield.toIronwood
    n2: 'The fee comes out of that amount', // shield.intro ("The network fee is deducted"), shield.fee
    n3: 'In this transaction the amount and the transparent address are visible on chain', // shield.intro
  },
};
const t = pick(T);

const P = await loadPlates('desktop');
const s = new Scene({ duration: 11 });
const sh = tutorialShell(s, document.getElementById('stage'), { P, step: 7, total: 8, title: t.title, sub: t.sub });
const R = (name, key) => sh.rect(name, key);
const mid = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// ---- timeline (seconds) ----------------------------------------------------------------------------
const T_CLICK1 = 3.1; // click "Gizliye aktar"
const T_CONF = 3.2; // the confirm screen
const T_PWCLICK = 5.4; // the cursor reaches the password field
const T_TYPE0 = 5.55, T_TYPE1 = 6.45; // password dots
const T_FULL = 6.55; // the Shield button turns gold
const T_CLICK2 = 7.0; // click "Aktar"
const T_OK = 7.15; // success (a quick 0.12 s dissolve: the camera holds still on the password card until it is over, then pans)
const T_FIN = 9.55; // home again (the camera is already back on the hero, so the crossfade happens on a still frame)

// ---- plate layers (explicit z: the cursor is 50, overlays are above everything) ------------------------
function layer(img, z, tShow, fade = 0.3) {
  img.style.zIndex = String(z);
  s.track(img, { opacity: tShow <= 0 ? [[0, 1]] : [[tShow, 0], [tShow + fade, 1, 'inOut']] });
}
const home = sh.plate('home-after-send'), conf = sh.plate('shield-confirm'), typed = sh.plate('shield-confirm-filled');
const full = sh.plate('shield-confirm-filled'), ok = sh.plate('shield-success'), fin = sh.plate('home-final');
layer(home, 1, 0);
layer(conf, 2, T_CONF, 0.25);
typed.style.zIndex = '3'; // only the dots inside the field, revealed left to right
const pw = R('shield-confirm', 'password');
s.reveal(typed, { x: pw.x, y: pw.y, w: 100, h: pw.h }, T_TYPE0, T_TYPE1);
layer(full, 4, T_FULL, 0.25);
layer(ok, 5, T_OK, 0.12);
layer(fin, 6, T_FIN, 0.3);

// ---- boxes (plate px, from plates.json) -------------------------------------------------------------
const tr = R('home-after-send', 'transparent'), notice = R('home-after-send', 'notice'), btn = R('home-after-send', 'shieldButton');
// the label ("Şeffaf") + the amount of the transparent column, one ring
const trBox = { x: tr.x - 8, y: tr.y - 32, w: tr.w + 16, h: 108 }; // label, amount and the "public on chain" line
const form = R('shield-confirm', 'form'), confirm = R('shield-confirm', 'confirm');
const okT = R('shield-success', 'title');
const okTitle = { x: okT.x - 12, y: okT.y, w: okT.w + 24, h: okT.h }; // the heading only: the line under it stays free
const finTr = R('home-final', 'transparent');
const finBox = { x: finTr.x - 8, y: finTr.y - 32, w: finTr.w + 16, h: 108 };
// Kaynak -> Hedef -> Ücret rows of the left card (no captured target: measured on the plate; the English card is one text line taller)
const dy = lang === 'en' ? 21.8 : 0;
const rows = { x: 330, y: 411 + dy, w: 464, h: 140 };

// ---- rings, spotlights, cursor, notes ----------------------------------------------------------------------
// A spotlight: the rest of the window dims (the .spot class of stage.css), used where the camera crops a neighbouring card.
function spot(rect, t0, t1, pad = 10) {
  const z = sh.toZoom(rect);
  const el = document.createElement('div');
  el.className = 'spot';
  el.style.cssText = `left:${z.x - pad}px;top:${z.y - pad}px;width:${z.w + 2 * pad}px;height:${z.h + 2 * pad}px;border-radius:${14 + pad}px`;
  sh.overlays.append(el);
  s.track(el, { opacity: [[t0, 0], [t0 + 0.45, 1], [t1 - 0.4, 1], [t1, 0]] });
}
sh.ring(trBox, 0.7, 2.7, { pad: 8 });
sh.ring(notice, 1.55, 3.2, { pad: 8 });
spot(rows, 3.8, 5.2, 12);
spot(form, 5.1, 7.4, 12); // stays on through the click, gone when the success card is opaque
sh.ring(okTitle, 7.85, 9.2, { pad: 6 }); // appears as the pan settles on the success card
sh.ring(finBox, 9.95, 11.6, { pad: 8 });

const cBtn = mid(btn), cPw = mid(pw), cConfirm = { x: confirm.x + confirm.w * 0.72, y: confirm.y + confirm.h * 0.5 };
sh.cursor([
  { t: 1.65, x: 1010, y: 640 },
  { t: T_CLICK1, x: cBtn.x, y: cBtn.y, click: true },
  { from: 3.45, t: 3.95, x: 700, y: 665 }, // steps aside, below the card, so the rows stay readable
  { from: 4.6, t: T_PWCLICK, x: cPw.x - 80, y: cPw.y, click: true },
  { from: 6.55, t: T_CLICK2, x: cConfirm.x, y: cConfirm.y, click: true },
], { leave: 7.5 });

const bal = (x) => `<span style="display:block;text-wrap:balance">${x}</span>`;
sh.note(bal(t.n1), 2.6, { icon: 'shieldIn', tone: 'sage' });
sh.note(bal(t.n2), 4.5, { icon: 'info', tone: 'gold' });
sh.note(bal(t.n3), 5.9, { icon: 'eye', tone: 'copper' });

// ---- camera ---------------------------------------------------------------------------------------------------
// EH: the hero card, the notice and the button (hero card of home-final as well, so s13 can start on the same frame)
// (the lower edge falls just under the second recent row, with a clear gap below its last text line)
const EH = { x: 300, y: 180, w: 930, h: 540 };
const RK = { x: 200, y: 315 + dy / 2, w: 650, h: 330 }; // the left card: amount, Kaynak / Hedef / Ücret
// the password card: the shot starts right of the neighbouring left card (its right edge is at x = 820), so no half words of it show
const RP = { x: 843, y: 120, w: 424, h: 340 };
const RO = { x: 305, y: 70, w: 640, h: 500 }; // the success card
sh.camera([
  { t: 0, rect: null },
  { t: 0.35, rect: null },
  { t: 1.25, rect: EH, fill: 0.934 },
  { t: 3.4, rect: EH, fill: 0.934 },
  { t: 4.3, rect: RK, fill: 0.95 },
  { t: 4.95, rect: RK, fill: 0.95 },
  { t: 5.6, rect: RP, fill: 0.78 },
  { t: 7.15, rect: RP, fill: 0.78 }, // still while the plates dissolve (7.15 to 7.27; the move eases in slowly), then the pan to the success card
  { t: 7.9, rect: RO, fill: 0.9, ease: 'soft' },
  { t: 9.0, rect: RO, fill: 0.9 },
  { t: 9.5, rect: EH, fill: 0.934 },
]);
await s.start();
