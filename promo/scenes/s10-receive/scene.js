// s10-receive (step 5 of 8): the Receive screen. Home -> Receive -> transparent address -> back -> away and
// back again: the address is a new one. Plates: home, receive, receive-transparent, receive-second.
// "Away and back" goes through Balance (home), not History: the History plate was captured after the send and
// shows a payment that has not been made yet at this point of the story.
// Every claim comes from en.ts / tr.ts (sources next to the strings) and README ("Receive shows a new,
// shielded-only address every time you open it").
import { Scene, lang, pick, loadPlates } from '/lib/stage.js';
import { tutorialShell } from '/lib/layout.js';
import { iconSVG } from '/lib/brand.js';

const T = {
  tr: {
    title: 'ZEC al', // receive.title
    sub: 'Al ekranı varsayılan olarak yeni, yalnızca gizli bir adres gösterir.', // README Features ("Receive shows a new shielded-only unified address every time it opens"); the transparent one is shown separately, on request (button)
    safe: 'Güvenle paylaşabilirsin: kimse bununla paranı\u00a0harcayamaz', // receive.safeToShare
    exch: 'Bu adrese gelen para herkese\u00a0açıktır', // receive.transparentHelp, sentence 2 (the plate's paragraph already says who it is for)
    fresh: 'Her açışta yeni adres. Eskileri de çalışır.', // receive.freshNote (shortened)
    verify: 'Yapıştırdığın adresin ilk ve son karakterlerinin buradakilerle aynı olduğunu kontrol\u00a0et.', // receive.verifyHint
    prev: 'Önceki', // earlier address
    now: 'Yeni', // new address
    // first characters of the two shielded addresses in the plates (receive / receive-second)
    a1: 'u174 dxv8', a2: 'u109 vmuc',
  },
  en: {
    title: 'Receive ZEC', // receive.title
    sub: 'Receive shows a new, shielded-only address by default.', // README Features; the transparent one is shown separately, on request (button)
    safe: 'Safe to share: nobody can spend your funds with\u00a0it', // receive.safeToShare
    exch: 'Funds sent here are\u00a0public', // receive.transparentHelp, sentence 2 (the plate's paragraph already says who it is for)
    fresh: 'A new address every time. Earlier ones keep working.', // receive.freshNote (shortened)
    verify: 'Wherever you paste it, check that its first and last characters match the ones shown\u00a0here.', // receive.verifyHint
    prev: 'Earlier',
    now: 'New',
    a1: 'u19q 9kwc', a2: 'u1rj mlu7',
  },
};
const t = pick(T);

const P = await loadPlates('desktop');
const s = new Scene({ duration: 13.2 });
const sh = tutorialShell(s, document.getElementById('stage'), { P, step: 5, total: 8, title: t.title, sub: t.sub });
const { WIN } = sh;
const mid = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// ---- timeline (seconds) ---------------------------------------------------------------------------------
const T_REC = 1.2, T_TRN = 6.05, T_BACK = 9.35, T_HOME = 10.0, T_SECOND = 10.75;

// ---- plates: home -> receive -> receive-transparent -> receive (unified again) -> home -> receive-second ----
const home = sh.plate('home'), rcv = sh.plate('receive'), trn = sh.plate('receive-transparent');
const rcv2 = sh.plate('receive'), home2 = sh.plate('home'), second = sh.plate('receive-second');
// every plate change is a click on a screen with a different layout: a 0.12 s cut, never a long blend of two layouts
s.swap([home, rcv, trn, rcv2, home2, second], [0, T_REC, T_TRN, T_BACK, T_HOME, T_SECOND], { fade: 0.12 });

// ---- boxes (plate px, from plates.json) ---------------------------------------------------------------------
const navReceive = sh.rect('home', 'navReceive');
const navHome = sh.rect('receive', 'navHome');
const qr = sh.rect('receive', 'qr'), addr = sh.rect('receive', 'address'), card = sh.rect('receive', 'card');
const showT = sh.rect('receive', 'showTransparent'), showU = sh.rect('receive-transparent', 'showUnified');
const qrT = sh.rect('receive-transparent', 'qr'), addrT = sh.rect('receive-transparent', 'address');
const addr2 = sh.rect('receive-second', 'address');
// the first line of the address (its first characters are what you compare): derived from the address box
const firstLine = (a) => ({ x: a.x + 13, y: a.y + 16, w: 140, h: 29 });
// the last line (15 lines of 27.07 plate px): its last characters are the other end you compare
const lastLine = (a) => ({ x: a.x + 13, y: a.y + 16 + 14 * 27.07, w: 118, h: 29 });
// right column of the screen (next to the main card): x from card right + 24 to the content edge (home.notice right)
const notice = sh.rect('home', 'notice');
const colR = { x: card.x + card.w + 24, w: notice.x + notice.w - (card.x + card.w + 24) };

// ---- camera: whole window -> the receive card (slow push) -> back to the whole window for the nav clicks ----
// frame from the page title to just below the card (the English card is taller): the zoom follows
// (starts at plate y 16, so the page title at ~48 keeps ~40 px of air under the window top; the push starts at
// fill 0.975 so the frame never reaches the browser bar above plate y 0)
// The English card is taller, so its zoom is lower and the frame gets wider: shift it right so the sidebar's edge
// (plate x ~248) stays out of the frame in both languages.
const camRect = { x: 290 + (lang === 'en' ? 18 : 0), y: 16, w: 963, h: card.y + card.h + 28 - 16 };
const zFull = Math.min(WIN.w / sh.toZoom(camRect).w, WIN.h / sh.toZoom(camRect).h);
const zc = zFull * 0.98; // typical zoom while the card is framed (overlay text is sized for it)
sh.camera([
  { t: 0, rect: null },
  { t: 1.25, rect: null },
  { t: 2.4, rect: camRect, fill: 0.975 },
  { t: 9.3, rect: camRect, fill: 1.0 },
  { t: 10.0, rect: null },
]);

// ---- overlay helpers (sizes are in screen px: divided by the zoom the camera has while they are shown) -----
const TONE = {
  sage: ['var(--shielded)', 'rgba(143,195,161,.5)'],
  copper: ['var(--transparent)', 'rgba(229,155,110,.5)'],
  gold: ['var(--accent-fg)', 'var(--accent-line)'],
};
/** A callout card at plate-px (x, y) of its top-left corner, `w` plate px wide. */
function callout({ x, y, w, text, icon, tone, t0, t1, z = zc, fs = 29.5 }) { // fs 29.5 / zc -> >= 28 px on screen at the settled camera
  const f = 1 / z, [col, line] = TONE[tone], p = sh.toZoom({ x, y, w, h: 0 });
  const el = document.createElement('div');
  el.className = 'callout';
  el.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;font-size:${fs * f}px;line-height:1.32;padding:${16 * f}px ${22 * f}px ${18 * f}px ${18 * f}px;gap:${14 * f}px;border-radius:${20 * f}px;border-color:${line}`;
  el.innerHTML = `<span style="color:${col};flex:none;margin-top:${2 * f}px">${iconSVG(icon, 34 * f)}</span><span style="text-wrap:balance">${text}</span>`;
  sh.overlays.append(el);
  s.track(el, { opacity: [[t0, 0], [t0 + 0.4, 1], [t1 - 0.4, 1], [t1, 0]], y: [[t0, 14 * f], [t0 + 0.55, 0, 'out']] });
  return el;
}
/** A thin gold outline over a plate rect (no fill, no glow, so it stays quiet next to the real UI): the first characters of an address. */
function marker(rect, t0, t1, z = 1) {
  const p = sh.toZoom(rect), f = 1 / z, pad = 5 * f;
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;left:${p.x - pad}px;top:${p.y - pad * 0.6}px;width:${p.w + 2 * pad}px;height:${p.h + 1.2 * pad}px;border-radius:${9 * f}px;background:transparent;border:${2.5 * f}px solid var(--accent);pointer-events:none;z-index:41`;
  sh.overlays.append(el);
  s.track(el, { opacity: [[t0, 0], [t0 + 0.3, 1], [t1 - 0.3, 1], [t1, 0]], scaleX: [[t0, 0.6], [t0 + 0.5, 1, 'out']] }, { origin: '0 50%' });
  return el;
}

/** A card in the step panel, body text 28 px and balanced (the lib default is 26). */
function panelNote(text, t, opts) {
  const el = sh.note(text, t, opts);
  el.style.fontSize = '28px';
  el.lastElementChild.style.textWrap = 'balance';
  return el;
}

// ---- 1. home -> click "Al" ----------------------------------------------------------------------------------
sh.ring(navReceive, 0.35, 1.45, { pad: 6 });

// ---- 2. the shielded address: rings on the QR and the address, "safe to share", first characters ---------
// One gold element per beat: the QR ring is sage (shielded), the address ring hands over to the gold outlines
// of the first/last characters at 3.3 s.
const ringQr = sh.ring(qr, 1.9, 5.7, { pad: 10 });
ringQr.style.borderColor = 'rgba(143,195,161,.75)';
ringQr.style.boxShadow = '0 0 36px rgba(143,195,161,.28)';
sh.ring(addr, 2.0, 3.45, { pad: 10 });
callout({ x: qr.x - 22, y: qr.y + qr.h + 26, w: 312, text: t.safe, icon: 'shield', tone: 'sage', t0: 2.4, t1: 5.85 });
marker(firstLine(addr), 3.3, 5.1, zc);
marker(lastLine(addr), 3.7, 5.1, zc);
panelNote(t.verify, 3.4, { icon: 'info', tone: 'sage' });

// ---- 3. "Show transparent address": the button, then the transparent screen says who sees what ------------------
sh.ring(showT, 5.1, 6.3, { pad: 8 });
// under the QR on the transparent screen, where the "safe" callout stood (sage -> copper): only the part the plate
// does not already shout, and only once the transparent plate is fully in (6.05 + 0.12)
callout({ x: qr.x - 22, y: qrT.y + qrT.h + 26, w: 312, text: t.exch, icon: 'eye', tone: 'copper', t0: 6.2, t1: 9.4 }); // 3.2 s on screen: reading time of the statement
// a calm beat on the transparent address itself (it fills the 6.4-9 s stretch that was only a cursor drift)
sh.ring(addrT, 7.0, 8.6, { pad: 10 });

// ---- 4. away and back: a new address ------------------------------------------------------------------------
const f1 = firstLine(addr2);
marker(f1, 11.15, 14, 1);
marker(lastLine(addr2), 11.45, 14, 1);
// the two first-character groups side by side, as a card where the callouts stood
{
  const p = sh.toZoom({ x: qr.x - 22, y: qr.y + qr.h + 26, w: 322, h: 0 });
  const el = document.createElement('div');
  el.className = 'card';
  el.style.cssText = `position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;padding:18px 16px 20px 18px;border-radius:20px;display:flex;flex-direction:column;gap:14px`;
  // camera is at the whole window here (zoom 1), so these are screen px: code 28 px, labels 24 px
  const row = (label, code, cur) => `<div class="row" style="align-items:center;gap:10px">
      <span class="${cur ? 'dot' : 'dot hollow'}" style="color:${cur ? 'var(--accent)' : 'var(--subtle)'};width:12px;height:12px;flex:none"></span>
      <span style="font-size:24px;color:${cur ? 'var(--text)' : 'var(--subtle)'};width:84px;flex:none">${label}</span>
      <span class="mono" style="font-size:28px;color:${cur ? 'var(--text)' : 'var(--muted)'};font-weight:${cur ? 600 : 500};white-space:nowrap">${code}</span></div>`;
  el.innerHTML = row(t.prev, t.a1, false) + row(t.now, t.a2, true);
  sh.overlays.append(el);
  s.track(el, { opacity: [[11.0, 0], [11.45, 1]], y: [[11.0, 14], [11.6, 0, 'out']] });
}
panelNote(t.fresh, 11.0, { icon: 'sync', tone: 'sage' });

// ---- cursor (plate px) ---------------------------------------------------------------------------------------
const cAl = mid(navReceive), cHome = mid(navHome);
const aPt = { x: addr.x + 150, y: addr.y + 120 };
const bPt = mid(showT), uPt = mid(showU);
sh.cursor([
  { t: 0.3, x: 760, y: 560 },
  { t: 1.1, x: cAl.x, y: cAl.y, click: true },
  { t: 2.7, x: aPt.x, y: aPt.y, from: 1.9 },
  { t: 3.5, x: addr.x + 120, y: addr.y + 36 },
  { t: 5.95, x: bPt.x, y: bPt.y, click: true, from: 4.6 },
  { t: 7.7, x: addr.x + 140, y: addr.y + 70, from: 6.7 },
  { t: 9.3, x: uPt.x, y: uPt.y, click: true, from: 8.4 },
  { t: 9.95, x: cHome.x, y: cHome.y, click: true, from: 9.5 },
  { t: 10.65, x: cAl.x, y: cAl.y, click: true, from: 10.2 },
], { leave: 11.2 });

await s.start();
