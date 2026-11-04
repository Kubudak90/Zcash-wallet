// s13-history-settings (step 8 of 8): hide balances, read the privacy labels in History, look at Settings, lock.
// Plates: home-final (where s12 ends) -> home-hidden -> history -> settings -> (settings-privacy: the scrolled page) -> unlock (all desktop).
// Claims: README (Features: Privacy in plain sight, Use your own server), landing/build.py (features: Honest labels, Locks itself),
// src/i18n/en.ts + tr.ts (home.hideBalances, history.privacy.*, settings.*, unlock.title), src/screens/Settings.tsx (PasswordGate).
import { Scene, lang, pick, loadPlates, ease } from '/lib/stage.js';
import { tutorialShell } from '/lib/layout.js';

const T = {
  tr: {
    title: 'Geçmiş, ayarlar, kilit',
    sub: 'Gizliliğini görmek ve yönetmek için.',
    n1: 'Tek tıkla ekrandaki bakiyeler ve tutarlar gizlenir', // README Features "Privacy in plain sight" (the eye button hides balances and amounts on screen, not a guarantee); home.hideBalances
    n2: 'Her ödeme gizli mi, kısmen gizli mi, herkese açık mı, nedenini de söyler', // landing features[3] "Dürüst etiketler" (same claim; the site's "nedeniyle söyler" reworded)
    n3: 'Kilitle’ye bas ya da bekle: kilit kendiliğinden kapanır', // nav.lock; settings.autoLockHelp; landing features "Kendini kilitler"
    shielding: 'Gizliye aktarıldı · tutar herkese açık', // history.privacy.shielding
    shielded: 'Gizli', // history.privacy.shielded
    autoLock: 'Boşta kalınca kendini kilitler', // settings.autoLock + settings.autoLockHelp
    viewingKey: 'Görüntüleme anahtarı: harcayamaz ama tüm işlemlerini görür', // settings.viewingKeyHelp ("harcama yapamaz", sees all past and future transactions)
    seed: 'Kurtarma kelimeleri şifreyle açılır', // Settings.tsx PasswordGate (settings.showSeed asks for the password)
    server: 'İstersen kendi sunucunu kullan', // README Features "Use your own server"; settings.serverHelp ("You can run your own")
  },
  en: {
    title: 'History, settings, lock',
    sub: 'To see and manage your privacy.',
    n1: 'One click hides balances and amounts on screen', // README Features "Privacy in plain sight" (an on-screen toggle, not a guarantee); home.hideBalances
    n2: 'Each payment says whether it is shielded, partly shielded or public, and why', // landing features[3] "Honest labels"
    n3: 'Press Lock, or just wait: it locks itself', // nav.lock; settings.autoLockHelp; landing features "Locks itself"
    shielding: 'Shielded · amount public', // history.privacy.shielding
    shielded: 'Shielded', // history.privacy.shielded
    autoLock: 'Locks itself when idle', // settings.autoLock + settings.autoLockHelp
    viewingKey: 'Viewing key: cannot spend, but sees all your transactions', // settings.viewingKeyHelp
    seed: 'The recovery phrase needs your password', // Settings.tsx PasswordGate
    server: 'Use your own server', // README Features "Use your own server"; settings.serverHelp ("You can run your own")
  },
};
const t = pick(T);

const P = await loadPlates('desktop');
const s = new Scene({ duration: 16.3 });
const sh = tutorialShell(s, document.getElementById('stage'), { P, step: 8, total: 8, title: t.title, sub: t.sub });
const R = (name, key) => sh.rect(name, key);
const mid = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const K = sh.WIN.scale; // plate px -> window px

// ---- timeline (seconds) ----------------------------------------------------------------------------
const T_EYE = 1.45; // click the "hide balances" switch
const T_HIST = 3.1; // click History
const T_SET = 6.75; // click Settings
const SC0 = 10.3, SC1 = 11.1; // the page scrolls from the top of Settings to Privacy / Server
const T_LOCK = 13.75; // click Lock
const SCROLL = 560; // px the settings page is scrolled in the `settings-privacy` plate (plates.json: scrollY)

// ---- plate layers (explicit z: the cursor is 50, overlays are above everything) ------------------------
function layer(img, z, tShow, fade = 0.3) {
  img.style.zIndex = String(z);
  s.track(img, { opacity: tShow <= 0 ? [[0, 1]] : [[tShow, 0], [tShow + fade, 1, 'inOut']] });
}
// the scene opens on the plate s12 ends on (home-final, same camera frame), so the dissolve between the two scenes shows one and the same screen;
// the eye click then dissolves into home-hidden (the only hidden-balance capture; it was taken before the shielding, see the report)
const home = sh.plate('home-final'), hidden = sh.plate('home-hidden'), hist = sh.plate('history');
const set = sh.plate('settings'), setMainA = sh.plate('settings'), setMainB = sh.plate('settings-privacy');
const setLeftA = sh.plate('settings'), setLeftB = sh.plate('settings-privacy');
const lock = sh.plate('unlock');
layer(home, 1, 0);
layer(hidden, 2, T_EYE + 0.05, 0.14); // a quick dissolve: the two captures differ a little (see above)
layer(hist, 3, T_HIST + 0.05);
layer(set, 4, T_SET + 0.05);
lock.style.zIndex = '10';
s.track(lock, { opacity: [[T_LOCK + 0.05, 0], [T_LOCK + 0.4, 1, 'inOut']] });

// The scroll: the page content (right of x = 515) of `settings` and of `settings-privacy` slides up together, exactly as one
// document (the plates are the same page at scroll 0 and 560); the left column (sub-menu, sticky in the real page) stays put.
const MAIN_L = (515 / 1280) * 100, LEFT_L = (252 / 1280) * 100, LEFT_R = 100 - MAIN_L;
const settled = T_SET + 0.4; // the crossfade into Settings is over: the identical layers can appear without a visible change
for (const [img, z] of [[setMainA, 5], [setMainB, 6]]) img.style.zIndex = String(z);
s.track(setMainA, { clipL: [[0, MAIN_L]], opacity: [[settled, 0], [settled + 0.01, 1]], y: [[0, 0], [SC0, 0], [SC1, -SCROLL, 'inOut']] });
s.track(setMainB, { clipL: [[0, MAIN_L]], opacity: [[settled, 0], [settled + 0.01, 1]], y: [[0, SCROLL], [SC0, SCROLL], [SC1, 0, 'inOut']] });
// the heading "Ayarlar" (the band above the sub-menu, y < 98) is part of the page: it scrolls away with it; the sub-menu is sticky in the
// real page: it rises 59.5 px (its y in `settings` minus its y in `settings-privacy`) and stays; only its marker changes
// (the band y 94..98 is blank: the heading ends at y 80, the first item starts at y 112; the two pieces overlap by 4 px so no seam shows)
const STICK = 59.5;
let lo = 0, hi = 1; // the sub-menu moves with the page (same easing) until it has risen STICK px, then it stays
for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (SCROLL * ease.inOut(m) < STICK) lo = m; else hi = m; }
const pStick = hi, tStick = SC0 + pStick * (SC1 - SC0);
const stickEase = (q) => (SCROLL * ease.inOut(q * pStick)) / STICK;
const setHead = sh.plate('settings');
setHead.style.zIndex = '8';
s.track(setHead, { clipL: [[0, LEFT_L]], clipR: [[0, LEFT_R]], clipB: [[0, (1 - 98 / 1040) * 100]], opacity: [[settled, 0], [settled + 0.01, 1]], y: [[0, 0], [SC0, 0], [SC1, -SCROLL, 'inOut']] });
setLeftA.style.zIndex = '5';
s.track(setLeftA, { clipT: [[0, (94 / 1040) * 100]], clipL: [[0, LEFT_L]], clipR: [[0, LEFT_R]], opacity: [[settled, 0], [settled + 0.01, 1]], y: [[0, 0], [SC0, 0], [tStick, -STICK, stickEase]] });
setLeftB.style.zIndex = '7';
s.track(setLeftB, { clipL: [[0, LEFT_L]], clipR: [[0, LEFT_R]], opacity: [[tStick + 0.1, 0], [tStick + 0.4, 1, 'inOut']] });

// ---- boxes (plate px, from plates.json) -------------------------------------------------------------
const eye = R('home-final', 'eye'), hero = R('home-final', 'hero');
const nav = { hist: R('home-hidden', 'navHistory'), set: R('history', 'navSettings') };
const list = R('history', 'list');
const lockBtn = R('settings', 'lock');
const autoLock = R('settings', 'autoLock'), viewingKey = R('settings', 'viewingKey'), seed = R('settings', 'seed');
const server = R('settings-privacy', 'server');
// the privacy cell of the three History rows (measured on the plates: the label sits in the column that starts at x = 776;
// the Turkish "shielding" label wraps to two lines, the English one is a single line)
const row = [R('history', 'firstRow'), R('history', 'secondRow'), R('history', 'thirdRow')];
const cell = pick({
  tr: { w1: 212, h1: 46, w2: 56 },
  en: { w1: 176, h1: 30, w2: 80 },
});
const cellRect = (i) => {
  const cy = [300.4, 388.5, 512][i];
  const w = i === 0 ? cell.w1 : cell.w2, h = i === 0 ? cell.h1 : 34;
  return { x: 776, y: cy - h / 2, w, h };
};

// ---- numbered pins on the three privacy cells + the legend under the table ---------------------------------------
function pin(n, rect, t0, t1) {
  const z = sh.toZoom(rect), pad = 6;
  const el = document.createElement('i');
  el.className = 'pin';
  el.textContent = String(n);
  el.style.left = `${z.x - pad - 17 + 3}px`;
  el.style.top = `${z.y - pad - 17 + 3}px`;
  sh.overlays.append(el);
  s.track(el, { opacity: [[t0, 0], [t0 + 0.35, 1], [t1 - 0.35, 1], [t1, 0]], scale: [[t0, 0.6], [t0 + 0.5, 1, 'outBack']] });
}
const H = { t0: 3.95, t1: 6.65 };
[0, 1, 2].forEach((i) => {
  const t0 = H.t0 + i * 0.2;
  sh.ring(cellRect(i), t0, H.t1, { pad: 6 });
  pin(i + 1, cellRect(i), t0, H.t1);
});
const dotFull = '<svg width="18" height="18" viewBox="0 0 18 18" style="flex:none"><circle cx="9" cy="9" r="6.5" fill="currentColor"/></svg>';
const dotHalf = '<svg width="18" height="18" viewBox="0 0 18 18" style="flex:none"><circle cx="9" cy="9" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 2.8a6.2 6.2 0 0 0 0 12.4z" fill="currentColor"/></svg>';
const pinHTML = (n) => `<i class="pin">${n}</i>`;
const legend = `<span style="display:flex;flex-direction:column;gap:16px">
  <span class="lg">${pinHTML(1)}<span class="sage">${dotHalf}</span>${t.shielding}</span>
  <span class="lg">${pinHTML(2)}${pinHTML(3)}<span class="sage">${dotFull}</span>${t.shielded}</span>
</span>`;
// an absolutely placed card would otherwise shrink to the space right of its anchor; and the plate text must not shine through it
const wide = (el) => ((el.style.width = 'max-content'), (el.style.background = 'var(--surface-2)'), el);
wide(sh.callout(list, legend, H.t0, H.t1, { side: 'below', dy: 26, maxWidth: 760 }));

// ---- Settings: three callouts on the top of the page (they travel with the scroll), one after it ----------------
const grp = document.createElement('div');
grp.className = 'abs';
sh.overlays.append(grp);
s.track(grp, { y: [[0, 0], [SC0, 0], [SC1, -SCROLL * K, 'inOut']] });
// Each callout sits in free space next to its ring, never on the setting's own title or help text (plate px, measured on the plates):
//  autoLock   above-left of the dropdown, in the empty middle of the "Dil" row (right edge left of the language switch)
//  viewingKey above the button, in the gap between the Genel and Güvenlik cards (two lines)
//  seed       below the button, in the gap under the Güvenlik card
const zx = (x) => x * K, zy = (y) => (sh.WIN.bar + y) * K;
function tag(rect, text, t0, t1, host, at) {
  const ring = sh.ring(rect, t0, t1, { pad: 8 });
  const call = wide(sh.callout(rect, text, t0 + 0.12, t1, { side: 'above', maxWidth: at.maxWidth ?? 560 }));
  call.style.padding = at.pad ?? '16px 24px 16px 22px';
  call.style.textWrap = 'balance';
  // anchored by its right edge and by its top or bottom edge, at the given plate position
  call.style.left = `${zx(at.right)}px`;
  call.style.top = `${zy(at.top ?? at.bottom)}px`;
  call.style.translate = `-100% ${at.bottom != null ? '-100%' : '0px'}`;
  // a quick fade-out (0.15 s) that is over before the page starts to scroll, so no half-transparent card travels over the text
  s.track(call, { opacity: [[t0 + 0.12, 0], [t0 + 0.5, 1], [t1 - 0.15, 1], [t1, 0]] });
  if (host) host.append(ring, call);
  return call;
}
const TAG_END = SC0; // all three leave just before the scroll
tag(autoLock, t.autoLock, 7.2, TAG_END, grp, { right: 1038, bottom: 226 });
tag(viewingKey, t.viewingKey, 7.35, TAG_END, grp, { right: 1207, bottom: 399, maxWidth: 500, pad: '12px 22px' });
tag(seed, t.seed, 7.5, TAG_END, grp, { right: 1207, top: 600 });
// server: after the scroll, on the `settings-privacy` page
sh.ring(server, 11.0, 13.8, { pad: 8 });
// (hangs under the field, right-aligned, over the "Reset / Save" buttons, in the free band above the long explanation)
const srvCall = wide(sh.callout({ x: server.x + server.w + 24, y: server.y + 92, w: 0, h: 0 }, t.server, 11.15, 13.8, { side: 'left', maxWidth: 700 }));
srvCall.style.padding = '10px 22px';
s.track(srvCall, { opacity: [[11.15, 0], [11.55, 1], [13.6, 1], [13.8, 0]] });

// ---- notes ------------------------------------------------------------------------------------------------------
const bal = (x) => `<span style="display:block;text-wrap:balance">${x}</span>`;
sh.note(bal(t.n1), 1.8, { icon: 'eyeOff', tone: 'gold' });
sh.note(bal(t.n2), 4.3, { icon: 'eye', tone: 'sage' });
sh.note(bal(t.n3), 12.3, { icon: 'lock', tone: 'gold' });

// ---- eye ring, lock ring and the cursor ------------------------------------------------------------------------------
sh.ring(eye, 0.6, 2.2, { pad: 8 });
sh.ring(lockBtn, 13.1, 14.0, { pad: 8 });
const cEye = mid(eye), cHist = mid(nav.hist), cSet = mid(nav.set), cLock = mid(lockBtn);
sh.cursor([
  { t: 0.8, x: 620, y: 340 },
  { t: T_EYE, x: cEye.x, y: cEye.y, click: true },
  { from: 2.5, t: T_HIST, x: cHist.x, y: cHist.y, click: true },
  { from: 6.2, t: T_SET, x: cSet.x, y: cSet.y, click: true },
  { from: 13.0, t: T_LOCK, x: cLock.x, y: cLock.y, click: true },
], { leave: 14.0 });

// ---- camera ---------------------------------------------------------------------------------------------------------------
const EH = { x: 300, y: 180, w: 930, h: 540 }; // the same frame (and fill) s12 ends on, on the same plate: the dissolve between the two scenes shows one screen
const HZ = { x: hero.x, y: hero.y + 11, w: hero.w + 1, h: 470 }; // the balance card (the neighbouring cards stay outside the frame)
const L = { x: 305, y: 40, w: 920, h: 800 }; // History: the table and the legend under it
const S = { x: 300, y: 110, w: 930, h: 600 }; // Settings
const U = { x: 380, y: 290, w: 520, h: 480 }; // the lock card
sh.camera([
  { t: 0, rect: EH, fill: 0.934 },
  { t: 0.25, rect: EH, fill: 0.934 },
  { t: 1.15, rect: HZ, fill: 0.96 },
  { t: 2.45, rect: HZ, fill: 0.96 },
  { t: 3.05, rect: null },
  { t: 3.55, rect: null },
  { t: 4.35, rect: L, fill: 0.98 },
  { t: 6.0, rect: L, fill: 0.98 },
  { t: 6.6, rect: null },
  { t: 7.0, rect: null },
  { t: 7.8, rect: S, fill: 0.97 },
  { t: 12.9, rect: S, fill: 0.97 },
  { t: 13.5, rect: null },
  { t: 14.1, rect: null },
  { t: 15.0, rect: U, fill: 0.8 },
]);
await s.start();
