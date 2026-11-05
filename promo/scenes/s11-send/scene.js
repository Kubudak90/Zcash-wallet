// s11-send (step 6 of 8): the Send screen. Address, amount, memo, review, confirm with the password,
// the four stages (building, signing, proving, broadcasting), success.
// Plates: send-empty, send-filled, send-confirm, send-confirm-filled, send-proving, send-success
// (+ receive-second as the first frame: the previous step ends there, so the two scenes dissolve cleanly).
// Claims: en.ts / tr.ts (send.*) and landing/build.py (flow: Prove, in your browser); sources next to the strings.
// The plates hold only the empty and the filled form, and the form reflows when the address goes in (the filled
// layout is 82 plate px taller below the address). So the address types in over the empty plate, and the whole
// form then cuts to the filled plate in one short fade right after the cursor clicks the amount: no crossfade of
// two different layouts. The camera is a pure pan at one zoom (1.33) for the whole scene, so no plate title is
// ever sliced mid-word: it only moves while a single plate is on screen.
import { Scene, lang, pick, loadPlates } from '/lib/stage.js';
import { tutorialShell } from '/lib/layout.js';
import { iconSVG } from '/lib/brand.js';

const T = {
  tr: {
    title: 'ZEC gönder', // send.title
    sub: 'Adresi ve tutarı gir, istersen şifreli\u00a0bir\u00a0not\u00a0ekle.', // storyboard (send.memo: "Not (isteğe bağlı)")
    n1: 'Adres yerine zcash:\u00a0bağlantısı da yapıştırabilirsin', // send.toPlaceholder ("u1…, zs1…, t1… veya zcash: bağlantısı"), send.uriFilled ("Tutar ödeme bağlantısından dolduruldu.")
    n2: 'Not şifrelidir: yalnızca sen ve alıcı\u00a0okuyabilir', // send.memoHelp
    n3: 'Şifrenle onaylayana kadar hiçbir şey\u00a0gönderilmez', // send.confirmNote
    n4: 'Sıfır bilgi kanıtı tarayıcında üretilir', // tr.ts send.stage.proving (the proof); landing tr: chips[1] 'Tarayıcında kanıtlanır', flow 'Kanıtla / Tarayıcında', flow_note
    stages: [
      'İşlem hazırlanıyor…', // send.stage.building
      'İmzalanıyor…', // send.stage.signing
      'Sıfır bilgi kanıtı üretiliyor (10–60 sn)…', // send.stage.proving
      'Ağa gönderiliyor…', // send.stage.broadcasting
    ],
  },
  en: {
    title: 'Send ZEC', // send.title
    sub: 'Enter an address and an amount, and add an encrypted memo if you like.',
    n1: 'You can paste a zcash:\u00a0payment\u00a0link instead', // send.toPlaceholder ("u1…, zs1…, t1… or a zcash: link"), send.uriFilled
    n2: 'The memo is encrypted: only you and the recipient can\u00a0read\u00a0it', // send.memoHelp
    n3: 'Nothing is sent until you confirm with your\u00a0password', // send.confirmNote
    n4: 'The zero-knowledge proof is generated in your browser', // en.ts send.stage.proving (the proof); landing en: chips[1] 'Proved in your browser', flow 'Prove / In your browser', flow_note
    stages: [
      'Building the transaction…', // send.stage.building
      'Signing…', // send.stage.signing
      'Generating zero-knowledge proofs (10–60 s)…', // send.stage.proving
      'Broadcasting…', // send.stage.broadcasting
    ],
  },
};
const t = pick(T);

const P = await loadPlates('desktop');
const s = new Scene({ duration: 16.8 });
const sh = tutorialShell(s, document.getElementById('stage'), { P, step: 6, total: 8, title: t.title, sub: t.sub });
const { WIN } = sh;
const mid = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const R = (name, key) => sh.rect(name, key);

// ---- timeline (seconds) ------------------------------------------------------------------------------------
const T_EMPTY = 1.15; // click "Gönder" in the sidebar
const T_ROWS = 2.3; // the address is pasted in, line by line (over the empty plate)
const T_CLICK_AMOUNT = 3.55; // the cursor clicks the (empty) amount box
const T_FILL = 3.7; // the form reflows: one short cut to the filled plate (amount, summary, memo)
const T_CONF = 7.4; // click "Gözden geçir"
const T_PW = 9.0, T_PWFULL = 10.0; // password dots, then the Send button turns gold
const T_PROVE = 11.0; // click "Gönder": the panel list starts, the confirm screen stays while stages 1-2 tick
const T_P3 = 11.85; // stage 3 (proof) becomes active: the proving plate (stage 3 active) cuts in, list and plate agree
const T_OK = 14.35; // success (the camera is already back at the whole window)

// ---- plate layers (explicit z: the whole-plate crossfades and the typing layers interleave) --------------------
function layer(img, z, tShow, fade = 0.3) {
  img.style.zIndex = String(z);
  s.track(img, { opacity: tShow <= 0 ? [[0, 1]] : [[tShow, 0], [tShow + fade, 1, 'inOut']] });
}
const prev = sh.plate('receive-second'), empty = sh.plate('send-empty');
layer(prev, 1, 0);
layer(empty, 2, T_EMPTY, 0.14); // a click motivates a fast cut: two layouts must not sit blended on screen

const fTo = R('send-filled', 'to'), fAmount = R('send-filled', 'amount'), fMemo = R('send-filled', 'memo');
const fReview = R('send-filled', 'review'), fForm = R('send-filled', 'form');
const eAmount = R('send-empty', 'amount'); // the amount box before the form reflows

// the address: five lines of the filled plate, each revealed left to right inside the address box (z 3..7)
const lineY = fTo.y + 24.3, pitch = 23.04; // first text line centre and line pitch inside the address box (plate px)
const cuts = [fTo.y, lineY + pitch * 0.5, lineY + pitch * 1.5, lineY + pitch * 2.5, lineY + pitch * 3.5, fTo.y + fTo.h];
for (let r = 0; r < 5; r++) {
  const img = sh.plate('send-filled');
  img.style.zIndex = String(3 + r);
  const t0 = T_ROWS + r * 0.2; // about 1 s for the whole address (2.3 .. 3.34 s), done before the click on the amount (3.55 s)
  s.reveal(img, { x: fTo.x - 2, y: cuts[r], w: fTo.w + 4, h: cuts[r + 1] - cuts[r] }, t0, t0 + 0.24);
}
// the form reflows: ONE short cut to the whole filled plate (z 8). The old two-column fade blended two layouts
// of different height (chip over the amount box, doubled fee paragraph).
const filledAll = sh.plate('send-filled');
layer(filledAll, 8, T_FILL, 0.12);

// confirm -> password dots -> send button -> proving -> success (z 10..14)
const confirm = sh.plate('send-confirm'), pw = sh.plate('send-confirm-filled'), pwFull = sh.plate('send-confirm-filled');
const proving = sh.plate('send-proving'), ok = sh.plate('send-success');
layer(confirm, 10, T_CONF, 0.14);
pw.style.zIndex = '11';
const cPw = R('send-confirm', 'password');
s.reveal(pw, { x: cPw.x - 3, y: cPw.y - 3, w: cPw.w + 6, h: cPw.h + 6 }, T_PW, T_PW + 0.9);
layer(pwFull, 12, T_PWFULL, 0.25);
layer(proving, 13, T_P3, 0.12);
layer(ok, 14, T_OK, 0.12);

// ---- boxes (plate px, from plates.json) ---------------------------------------------------------------------
const navSend = R('receive-second', 'navSend');
const amountField = { x: fTo.x, y: fAmount.y, w: fTo.w, h: fAmount.h }; // the whole amount box (the target is its input)
const cAmount = R('send-confirm', 'amount'), cMemo = R('send-confirm', 'memo'), cSend = R('send-confirm', 'send');
const stages = R('send-proving', 'stages'), okTitle = R('send-success', 'title');

// ---- camera ------------------------------------------------------------------------------------------------------
// One zoom (1.33: the 963 plate px of the form + summary fill the window width) for the whole scene, so every
// move is a pan. Frames are chosen so that no plate text is sliced and no card is cut mid-sentence:
const RA = { x: 290, y: 40, w: 963, h: 816 }; // page title + address + empty form (empty plate ends at 676)
const RB = { x: 290, y: 128, w: 963, h: 816 }; // below the page title; the whole filled form incl. the warning card (to 934)
const RC = { x: 290, y: -44, w: 963, h: 816 }; // window top flush: confirm AND proving screens (back link, title, both cards whole)
sh.camera([
  { t: 0, rect: null },
  { t: 1.35, rect: null },
  { t: 2.3, rect: RA, fill: 0.96 },
  { t: 3.0, rect: RA, fill: 1.0 },
  { t: 3.65, rect: RB, fill: 1.0 }, // pan down while the cursor travels to the amount, just before the cut
  { t: 7.6, rect: RB, fill: 1.0 }, // the confirm plate has fully faded in (7.4 + 0.2) before the camera moves
  { t: 8.5, rect: RC, fill: 1.0 },
  { t: 13.5, rect: RC, fill: 1.0 }, // same frame through the proving screen: the plates swap in place
  { t: 14.3, rect: null }, // back to the whole window BEFORE the success plate fades in (T_OK)
]);

// ---- rings ----------------------------------------------------------------------------------------------------------
sh.ring(navSend, 0.5, 1.3, { pad: 6 });
sh.ring(amountField, 3.85, 5.25, { pad: 8 });
sh.ring(fMemo, 5.45, 6.95, { pad: 7 }); // clear of the label above and the hint below
sh.ring(fReview, 6.85, 7.55, { pad: 8 });
sh.ring(cAmount, 8.3, 9.5, { pad: 12 });
sh.ring(cMemo, 8.4, 9.5, { pad: 10 });
sh.ring(cSend, 10.25, 11.0, { pad: 8 });
sh.ring(okTitle, 14.85, 18, { pad: 7 });

// ---- panel: notes (the first three leave when the stage list comes in) ---------------------------------------------
const notes = document.getElementById('notes');
notes.style.position = 'relative';
function note(text, tAt, opts, tOut) {
  const el = sh.note(text, tAt, opts);
  el.style.fontSize = '28px'; // body text >= 28 px (the lib default is 26)
  el.lastElementChild.style.textWrap = 'balance';
  const w = document.createElement('div'); // a wrapper carries the exit, so it never fights the entrance track
  el.replaceWith(w);
  w.append(el);
  s.track(w, { opacity: [[tOut - 0.45, 1], [tOut, 0]] });
  return el;
}
note(t.n1, 2.5, { icon: 'external', tone: 'gold' }, T_PROVE);
note(t.n2, 5.75, { icon: 'lock', tone: 'sage' }, T_PROVE);
note(t.n3, 6.8, { icon: 'key', tone: 'gold' }, T_PROVE); // 6.8 (was 8.1): 4.2 s on screen before the stage list takes the panel (EN: 9 words = 4.2 s)

// the four stages, ticking one after another (the plate holds only one frame of them)
const proof = document.createElement('div');
proof.style.cssText = 'position:absolute;left:0;right:0;top:0;display:flex;flex-direction:column;gap:16px';
notes.append(proof);
const list = document.createElement('div');
list.className = 'card';
list.style.cssText = 'padding:22px 20px 24px 22px;border-radius:24px;display:flex;flex-direction:column;gap:18px';
const CHECK = '<path d="M10.5 19.8l5.6 5.6L27.6 12.8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';
const rows = t.stages.map((label, i) => {
  const row = document.createElement('div');
  row.className = 'row';
  row.style.cssText = 'align-items:center;gap:18px';
  row.innerHTML = `
    <div style="position:relative;width:40px;height:40px;flex:none">
      <div class="p" style="position:absolute;inset:0;border-radius:50%;border:2px solid var(--border-2)"></div>
      <svg class="a" viewBox="0 0 40 40" width="40" height="40" style="position:absolute;inset:0"><circle cx="20" cy="20" r="18" fill="none" stroke="var(--border-2)" stroke-width="2"/><circle class="arc" cx="20" cy="20" r="18" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-dasharray="30 84" style="transform-origin:20px 20px"/></svg>
      <svg class="d" viewBox="0 0 40 40" width="40" height="40" style="position:absolute;inset:0;color:var(--shielded)"><circle cx="20" cy="20" r="19" fill="rgba(143,195,161,.10)" stroke="rgba(143,195,161,.55)" stroke-width="2"/><g transform="translate(0 0.4)">${CHECK.replace('<path', '<path class="chk"')}</g></svg>
    </div>
    <div style="display:grid;font-size:28px;line-height:1.26;text-wrap:balance">
      <span class="lp" style="grid-area:1/1;color:var(--subtle)">${label}</span>
      <span class="la" style="grid-area:1/1;color:var(--text)">${label}</span>
      <span class="ld" style="grid-area:1/1;color:var(--muted)">${label}</span>
    </div>`;
  list.append(row);
  return row;
});
proof.append(list);
s.track(list, { opacity: [[T_PROVE - 0.05, 0], [T_PROVE + 0.5, 1]], y: [[T_PROVE - 0.05, 18], [T_PROVE + 0.65, 0, 'out']] });
// activation / completion times of the four stages. The plate shows stage 3 active, so stage 3 is active exactly while
// the proving plate is on screen (T_P3 .. T_OK): list and plate never contradict each other. Stage 4 ticks as the
// success plate arrives.
const ACT = [T_PROVE + 0.1, T_PROVE + 0.45, T_P3, T_OK];
const DONE = [T_PROVE + 0.45, T_P3, T_OK, T_OK + 0.3];
rows.forEach((row, i) => {
  const ta = ACT[i], td = DONE[i], q = (sel) => row.querySelector(sel);
  s.track(q('.p'), { opacity: [[ta, 1], [ta + 0.2, 0]] });
  s.track(q('.a'), { opacity: [[ta, 0], [ta + 0.2, 1], [td, 1], [td + 0.2, 0]] });
  s.track(q('.arc'), { rotate: [[ta, 0], [td, (td - ta) * 330, 'linear']] });
  s.track(q('.d'), { opacity: [[td, 0], [td + 0.2, 1]] });
  s.track(q('.chk'), { draw: [[td, 0], [td + 0.4, 1, 'out']] });
  s.track(q('.lp'), { opacity: [[ta, 1], [ta + 0.2, 0]] });
  s.track(q('.la'), { opacity: [[ta, 0], [ta + 0.2, 1], [td, 1], [td + 0.2, 0]] });
  s.track(q('.ld'), { opacity: [[td, 0], [td + 0.2, 1]] });
});
{
  const el = sh.note(t.n4, T_P3 + 0.45, { icon: 'shield', tone: 'sage' });
  el.style.fontSize = '28px';
  el.lastElementChild.style.textWrap = 'balance';
  proof.append(el);
}

// ---- cursor (plate px) ---------------------------------------------------------------------------------------
const cNav = mid(navSend);
sh.cursor([
  { t: 0.4, x: 700, y: 640 },
  { t: 1.1, x: cNav.x, y: cNav.y, click: true },
  { t: 2.1, x: fTo.x + 150, y: fTo.y + 34, click: true, from: 1.5 },
  // the amount box of the EMPTY form (the form has not reflowed yet); the filled plate cuts in right after the click
  { t: T_CLICK_AMOUNT, x: eAmount.x + 120, y: eAmount.y + 28, click: true, from: 2.95 },
  // the form reflowed (+82 plate px): the cursor follows the amount box down
  { t: 4.3, x: fAmount.x + 120, y: fAmount.y + 28, from: 3.85 },
  // the memo is already in the filled plate, so the cursor only points at it (no click on a filled field)
  { t: 5.6, x: fMemo.x + 170, y: fMemo.y + 34, from: 4.85 },
  { t: 7.3, x: mid(fReview).x, y: mid(fReview).y, click: true, from: 6.45 },
  { t: 8.9, x: cPw.x + 110, y: cPw.y + 26, click: true, from: 8.1 },
  { t: 10.9, x: mid(cSend).x, y: mid(cSend).y, click: true, from: 10.15 },
], { leave: 11.5 });

await s.start();
