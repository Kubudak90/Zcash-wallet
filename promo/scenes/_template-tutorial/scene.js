// TUTORIAL scene template (act 2): the shared layout from /lib/layout.js, real plates, cursor, ring, callout, camera.
// Copy to promo/scenes/<id>/ and edit. Render stills:  node promo/render.mjs scenes/<id> --lang tr --stills 1,3,6 --outdir DIR
import { Scene, pick, loadPlates } from '/lib/stage.js';
import { tutorialShell } from '/lib/layout.js';

const T = {
  tr: { title: 'Yeni cüzdan oluştur', sub: 'Karşılama ekranında “Yeni cüzdan oluştur”u seç.', n1: 'Kelimeleri sırasıyla kağıda yaz', call: 'Buradan başla' },
  en: { title: 'Create a new wallet', sub: 'On the welcome screen choose “Create a new wallet”.', n1: 'Write the words down in order', call: 'Start here' },
};
const t = pick(T);
const P = await loadPlates('desktop');
const s = new Scene({ duration: 10 });
const sh = tutorialShell(s, document.getElementById('stage'), { P, step: 1, total: 8, title: t.title, sub: t.sub, first: true });

const welcome = sh.plate('welcome'), seed = sh.plate('create-seed-hidden');
s.swap([welcome, seed], [0, 4.6], { fade: 0.4 });

const create = sh.rect('welcome', 'create');
sh.ring(create, 1.2, 3.6);
sh.callout(create, t.call, 1.4, 3.6, { side: 'left', n: 1 });
sh.cursor([
  { t: 1.6, x: 700, y: 760 },
  { t: 3.0, x: create.x + create.w * 0.5, y: create.y + create.h * 0.5, click: true },
  { t: 6.5, x: 900, y: 500, from: 5.2 },
], { leave: 9 });
sh.note(t.n1, 5.2, { icon: 'key' });
sh.camera([
  { t: 0, rect: null },
  { t: 5.4, rect: null },
  { t: 6.4, rect: sh.rect('create-seed-hidden', 'grid'), fill: 0.55 },
  { t: 9.2, rect: null },
]);
await s.start();
