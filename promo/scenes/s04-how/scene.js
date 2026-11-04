// s04-how (15 s) · free-form · act 1, "Blocks are scanned in your browser."
// A diagram (lightwalletd -> compact blocks -> your browser), then it steps up and becomes the legend of two honest
// columns: what stays with you (sage, under the browser) and what the server sees (copper, under the server), equally
// legible. The last seconds swap the diagram for the life of a payment (Create > Sign > Prove > Broadcast).
// Starts from the C + echo field s03-promises ends on. Every string is backed by landing/build.py (TEXT).
import { Scene, lang, pick } from '/lib/stage.js';
import { engravedCSVG, iconSVG, markSVG } from '/lib/brand.js';

document.documentElement.lang = lang;

const T = {
  tr: {
    eyebrow: 'Nasıl çalışır',                                              // landing tr: how_h
    head: 'Bloklar *tarayıcında* taranır.',                                // landing tr: how_p
    lwSub: 'Kompakt blokları gönderir',                                    // landing tr: diagram[0]
    blocks: 'kompakt bloklar',                                             // landing tr: diagram[1]
    brName: 'Senin tarayıcın', brSub: 'WebAssembly ile tarar',             // landing tr: diagram[2]
    staysH: 'Sende kalanlar',                                              // landing tr: stays_h
    stays: [                                                               // landing tr: stays
      'Gizli bakiyen ve sana gizli havuzda ödeme yapanlar',
      'Kurtarma kelimelerin ve harcama anahtarların',
      'Notların (memo): yalnızca sen ve alıcı okuyabilirsiniz',
    ],
    seesH: 'Sunucunun gördükleri',                                         // landing tr: sees_h
    sees: [                                                                // landing tr: sees
      'IP adresin, şeffaf adreslerin ve yayınladığın işlemler',
      'Geçmiş işlemlerin tamamını getirdiği sürece hangi işlemlerin senin olduğu <span class="m">(bunu kapatabilirsin)</span>',
      'Hangi blokları göreceğine o karar verir: güvendiğin sunucuyu kullan',
    ],
    flowLead: 'Her ödeme <em>tarayıcında</em> kanıtlanan bir PCZT’dir.',     // landing tr: flow_note ('Her ödeme tarayıcında kanıtlanan bir PCZT’dir.'); README.md:67
    flow: [['Oluştur', 'Notlarından bir PCZT'], ['İmzala', 'Şifrenle'], ['Kanıtla', 'Tarayıcında'], ['Yayınla', 'Sunucun üzerinden']], // landing tr: flow (the server only appears at step 4, and in the copper column)
  },
  en: {
    eyebrow: 'How it works',                                               // landing en: how_h
    head: 'Blocks are scanned *in your browser*.',                         // landing en: how_p
    lwSub: 'Sends compact blocks',                                         // landing en: diagram[0]
    blocks: 'compact blocks',                                              // landing en: diagram[1]
    brName: 'Your browser', brSub: 'Scans them in WebAssembly',            // landing en: diagram[2]
    staysH: 'What stays with you',                                         // landing en: stays_h
    stays: [                                                               // landing en: stays
      'Your shielded balance, and who pays you in the shielded pool',
      'Your recovery phrase and spending keys',
      'Your memos: only you and the recipient can read them',
    ],
    seesH: 'What the server sees',                                         // landing en: sees_h
    sees: [                                                                // landing en: sees
      'Your IP address, your transparent addresses and the transactions you broadcast',
      'Which transactions are yours, while History fetches them in full <span class="m">(you can turn that off)</span>',
      'It decides which blocks Celari sees: use a server you trust',
    ],
    flowLead: 'Every payment is a PCZT, proved in <em>your browser</em>.',     // landing en: flow_note ('Every payment is a PCZT, proved in your browser.'); README.md:67
    flow: [['Create', 'A PCZT from your notes'], ['Sign', 'With your password'], ['Prove', 'In your browser'], ['Broadcast', 'Through your server']], // landing en: flow
  },
};
const t = pick(T);

/** "a *b c* d." -> inline-block word spans (the emphasised words in <em>; punctuation after the closing * stays attached). */
function words(line) {
  let em = false;
  return line.split(' ').filter(Boolean).map((tok) => {
    if (tok.startsWith('*')) { em = true; tok = tok.slice(1); }
    if (em && tok.includes('*')) { const [inner, tail] = tok.split('*'); em = false; return `<span class="w"><em>${inner}</em>${tail}</span>`; }
    return `<span class="w">${em ? `<em>${tok}</em>` : tok}</span>`;
  }).join(' ');
}

// ---- geometry (canvas px) ---------------------------------------------------------------------------
const X = 96, W = 1728;
const CL = 96, CR = 984, CWID = 840;       // the two columns; their centres (516 / 1404) are the nodes' centres
const NY = 246, NH = 168, NYC = NY + NH / 2; // node band (phase B): 246 - 414, line at 330
const NLX = 516 - 220, NRX = 1404 - 220;   // node left edges (440 wide): 296 / 1184
const CY = 482, CH = 474;                  // columns
const SIZE = 2400;

const colHTML = (id, kind, x, head, rows) => {
  const d = kind === 'copper' ? ' hollow' : '';
  return `
  <div id="${id}" class="col ${kind}" style="left:${x}px;top:${CY}px;width:${CWID}px;height:${CH}px">
    <div class="edge"></div>
    <div class="hd"><span class="dot${d}"></span><span class="ht">${head}</span></div>
    <div class="rule"></div>
    <div class="rows">${rows.map((r) => `<div class="row3"><span class="b dot${d}"></span><span>${r}</span></div>`).join('')}</div>
  </div>`;
};

const ARROW_SVG = (i) => `<svg id="ar${i}" class="abs" style="left:${i * 443 + 399 + 4}px;top:${66 + 36}px;overflow:visible" width="36" height="36" viewBox="0 0 36 36" fill="none" stroke-linecap="round" stroke-linejoin="round"><path class="base" d="M4 18h26M22 9l9 9-9 9" stroke="var(--muted)" stroke-opacity="0.65" stroke-width="2.4"/><path class="gold" d="M4 18h26M22 9l9 9-9 9" stroke="var(--text)" stroke-opacity="0.8" stroke-width="2.8"/></svg>`;

const stepHTML = (s, i) => `
  <div id="st${i}" class="step" style="left:${i * 443}px;top:66px">
    <div class="dn"></div><div class="lit"></div>
    <div class="n"><span class="fl"></span><b class="b1">${i + 1}</b><b class="b2" style="position:absolute;color:var(--accent-text);opacity:0">${i + 1}</b></div>
    <div><div class="nm">${s[0]}</div><div class="sb">${s[1]}</div></div>
  </div>`;

const NBLK = 13, BT0 = 2.55, BDT = 0.5, BTRAVEL = 2.0, BX0 = 680, BDX = 550, BW = 42;   // blocks: start behind the server, end behind the browser
const blocks = Array.from({ length: NBLK }, (_, k) => `<svg class="blk" id="bk${k}" style="left:${BX0}px;top:${NYC - BW / 2}px" viewBox="0 0 36 36" fill="none"><rect x="1.5" y="1.5" width="33" height="33" rx="8" fill="var(--surface-2)" stroke="var(--accent)" stroke-width="2.5"/><path d="M9 13h18M9 18.5h18M9 24h11" stroke="var(--accent)" stroke-opacity="0.6" stroke-width="2" stroke-linecap="round"/></svg>`).join('');

const stage = document.getElementById('stage');
stage.innerHTML = `
  <div class="glow"></div>
  <div id="motif" class="abs" style="left:${960 - SIZE / 2}px;top:${540 - SIZE / 2}px;width:${SIZE}px;height:${SIZE}px;color:var(--text)">${engravedCSVG(SIZE)}</div>
  <div id="content" class="abs" style="left:0;top:0;width:1920px;height:1080px">
    <div id="eyebrow" class="eyebrow abs" style="left:${X}px;top:62px">${t.eyebrow}</div>
    <div id="head" class="abs display" style="left:${X}px;top:102px;font-size:86px;line-height:1.08;white-space:nowrap">${words(t.head)}</div>

    <div id="diagram" class="abs" style="left:0;top:0;width:1920px;height:1080px">
      <svg class="abs" style="left:0;top:0;overflow:visible" width="1920" height="1080" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path id="ln" d="M${NLX + 440 + 8} ${NYC}H${NRX - 14}" stroke="var(--muted)" stroke-opacity="0.5" stroke-width="2.5"/>
        <path id="ah" d="M${NRX - 26} ${NYC - 10}L${NRX - 14} ${NYC}L${NRX - 26} ${NYC + 10}" stroke="var(--muted)" stroke-opacity="0.5" stroke-width="2.5"/>
      </svg>
      <div id="lbl" class="abs" style="left:${NLX + 440}px;width:${NRX - NLX - 440}px;top:${NYC - 62}px;text-align:center;font-size:26px;letter-spacing:.01em;color:var(--muted);white-space:nowrap">${t.blocks}</div>
      ${blocks}
      <div id="nL" class="node" style="left:${NLX}px;top:${NY}px">
        <div class="icw">${iconSVG('server', 38)}</div>
        <div class="tx"><div class="nm mono">lightwalletd</div><div class="sb">${t.lwSub}</div></div>
      </div>
      <div id="nR" class="node" style="left:${NRX}px;top:${NY}px">
        <div class="sweep" id="sweep"></div>
        <div class="icw">${markSVG(40)}</div>
        <div class="tx"><div class="nm">${t.brName}</div><div class="sb">${t.brSub}</div></div>
      </div>
      <div id="rL" class="ring" style="left:${NLX - 8}px;top:${NY - 8}px;border-color:var(--transparent);box-shadow:0 0 34px color-mix(in srgb, var(--transparent) 30%, transparent)"></div>
      <div id="rR" class="ring" style="left:${NRX - 8}px;top:${NY - 8}px;border-color:var(--shielded);box-shadow:0 0 34px color-mix(in srgb, var(--shielded) 30%, transparent)"></div>
      <div id="kL" class="abs" style="left:515px;top:${NY + NH + 12}px;width:2px;height:${CY - NY - NH - 12}px;background:linear-gradient(var(--transparent),color-mix(in srgb, var(--transparent) 25%, transparent));transform-origin:50% 0"></div>
      <div id="kR" class="abs" style="left:1403px;top:${NY + NH + 12}px;width:2px;height:${CY - NY - NH - 12}px;background:linear-gradient(var(--shielded),color-mix(in srgb, var(--shielded) 25%, transparent));transform-origin:50% 0"></div>
    </div>

    ${colHTML('colL', 'copper', CL, t.seesH, t.sees)}
    ${colHTML('colR', 'sage', CR, t.staysH, t.stays)}

    <div id="pipe" class="abs" style="left:${X}px;top:${NY}px;width:${W}px;height:176px">
      <div id="plead" class="abs" style="left:0;top:0;width:${W}px;font-size:36px;font-weight:500;line-height:1.25;color:var(--text);white-space:nowrap">${t.flowLead.replace('<em>', '<em style="font-style:normal">')}</div>
      ${t.flow.map(stepHTML).join('')}
      ${[0, 1, 2].map(ARROW_SVG).join('')}
    </div>
  </div>
  <div class="vignette"></div><div class="grain" id="grain"></div>`;
const $ = (id) => document.getElementById(id);
const DUR = 15.3;
const s = new Scene({ duration: DUR });

// ---- the field: starts where s03-promises ends (C in the upper-right corner, scale .4, echoes 1.2), then only drifts
const fill = document.querySelector('.ec-facet-fill');
fill.setAttribute('fill-opacity', '1');
s.track(fill, { opacity: [[0, 0.1], [DUR, 0.1]] });
s.track(document.querySelector('.ec-echoes'), { scale: [[0, 1.2], [DUR, 1.27, 'linear']] }, { origin: '600px 600px' });
s.track($('motif'), { x: [[0, 740], [DUR, 740]], y: [[0, -422], [DUR, -422]], scale: [[0, 0.4], [DUR, 0.4]], opacity: [[0, 0.85], [DUR, 0.85]] });
s.track($('content'), { scale: [[0, 1], [DUR, 1.012, 'linear']] }, { origin: '960px 540px' });

// ---- eyebrow + title (after the 0.5 s dissolve). Deliberately NOT composed from t=0: the previous scene's headline sits at the
// same spot, and a cross-dissolve of two headlines at 50 % each is unreadable; the dissolve instead lands on the faint C + echo field.
s.track($('eyebrow'), { opacity: [[0.4, 0], [1.0, 1]], x: [[0.4, -14], [1.1, 0, 'out']] });
[...document.querySelectorAll('#head .w')].forEach((w, i) => {
  const a = 0.5 + i * 0.13;
  s.track(w, { opacity: [[a, 0], [a + 0.7, 1, 'out']], y: [[a, 24], [a + 0.85, 0, 'out']], blur: [[a, 7], [a + 0.6, 0, 'out']] });
});

// ---- the diagram: big and centred first (x1.3, 250 px lower), then it steps up and becomes the columns' legend
const MOVE = [3.7, 4.9];
s.track($('diagram'), {
  scale: [[0, 1.3], [MOVE[0], 1.3], [MOVE[1], 1, 'inOut']],
  y: [[0, 250], [MOVE[0], 250], [MOVE[1], 0, 'inOut']],
  opacity: [[0, 1], [10.0, 1], [10.5, 0, 'inOut']],       // fully gone at 10.5: the lead line (10.7) never meets the fading diagram
}, { origin: `960px ${NYC}px` });
s.track($('nL'), { opacity: [[1.0, 0], [1.6, 1, 'out']], y: [[1.0, 28], [1.8, 0, 'out']] });
s.track($('nR'), { opacity: [[1.25, 0], [1.85, 1, 'out']], y: [[1.25, 28], [2.05, 0, 'out']] });
s.track($('ln'), { draw: [[1.9, 0], [2.7, 1, 'inOut']] });
s.track($('ah'), { draw: [[2.55, 0], [2.85, 1, 'out']] });
s.track($('lbl'), { opacity: [[2.2, 0], [2.8, 1, 'out']], y: [[2.2, 10], [2.9, 0, 'out']] });

// blocks: each travels behind the server node out to behind the browser node; the browser "scans" as one arrives
const sweepKF = { x: [[0, -150]], opacity: [[0, 0]] };
const ARRIVE = (((NRX - BW) - BX0) / BDX) * BTRAVEL;   // when a block's right edge meets the browser node
for (let k = 0; k < NBLK; k++) {
  const a = BT0 + k * BDT;
  s.track($('bk' + k), { x: [[a, 0], [a + BTRAVEL, BDX, 'linear']], opacity: [[a - 0.01, 0], [a, 1, 'linear'], [a + BTRAVEL, 1], [a + BTRAVEL + 0.01, 0, 'linear']] });
  const b = a + ARRIVE;
  sweepKF.x.push([b, -150], [b + 0.55, 440, 'inOut']);
  sweepKF.opacity.push([b - 0.001, 0], [b, 0.0], [b + 0.1, 1, 'linear'], [b + 0.4, 1], [b + 0.55, 0, 'linear']);
}
s.track($('sweep'), sweepKF);

// ---- the two columns: sage (stays, under the browser) first, then copper (sees, under the server)
function column(id, ring, conn, t0) {
  const c = $(id);
  s.track(c, { opacity: [[t0, 0], [t0 + 0.6, 1, 'out']], y: [[t0, 40], [t0 + 0.85, 0, 'out']] });
  s.track(c.querySelector('.edge'), { scaleX: [[t0 + 0.1, 0], [t0 + 1.0, 1, 'out']], opacity: [[t0 + 0.1, 0], [t0 + 0.3, 1]] });
  s.track(c.querySelector('.hd'), { opacity: [[t0 + 0.2, 0], [t0 + 0.7, 1, 'out']], x: [[t0 + 0.2, 18], [t0 + 0.8, 0, 'out']] });
  s.track(c.querySelector('.rule'), { scaleX: [[t0 + 0.35, 0], [t0 + 1.0, 1, 'out']] });
  [...c.querySelectorAll('.row3')].forEach((r, i) => {
    const a = t0 + 0.6 + i * 0.55;
    s.track(r, { opacity: [[a, 0], [a + 0.55, 1, 'out']], x: [[a, 22], [a + 0.65, 0, 'out']] });
  });
  s.track($(conn), { scaleY: [[t0 - 0.1, 0], [t0 + 0.4, 1, 'out']], opacity: [[t0 - 0.1, 0], [t0, 1]] });
  const r0 = t0 - 0.1, r1 = t0 + 2.4;
  s.track($(ring), { opacity: [[r0, 0], [r0 + 0.4, 1], [r1, 1], [r1 + 0.5, 0, 'inOut']] });
}
column('colR', 'rR', 'kR', MOVE[1]);
column('colL', 'rL', 'kL', MOVE[1] + 1.4);   // copper follows 1.4 s after sage: both are complete well before the diagram leaves

// ---- the pipeline: the diagram steps aside, the life of a payment takes its place; the steps light up one by one
s.track($('plead'), { opacity: [[10.7, 0], [11.4, 1, 'out']], y: [[10.7, 16], [11.5, 0, 'out']] });
t.flow.forEach((_, i) => {
  const st = $('st' + i), a = 11.0 + i * 0.28, g = 11.9 + i * 0.5, gn = g + 0.5;   // gn: when the next step takes over
  s.track(st, { opacity: [[a, 0], [a + 0.5, 1, 'out']], y: [[a, 22], [a + 0.6, 0, 'out']] });
  s.track(st.querySelector('.dn'), { opacity: [[g, 0], [g + 0.35, 1, 'out']] });   // neutral outline: stays once the step has run
  const act = (el, on, off) => s.track(el, i < 3
    ? { opacity: [[g, off], [g + 0.35, on, 'out'], [gn, on], [gn + 0.35, off, 'out']] }
    : { opacity: [[g, off], [g + 0.35, on, 'out']] });   // gold = the active step only; the last one stays lit
  act(st.querySelector('.lit'), 1, 0);
  act(st.querySelector('.fl'), 1, 0);
  act(st.querySelector('.b2'), 1, 0);
  act(st.querySelector('.b1'), 0, 1);
  if (i < 3) {
    const ar = $('ar' + i);
    s.track(ar, { opacity: [[a + 0.15, 0], [a + 0.55, 1, 'out']] });
    s.track(ar.querySelector('.gold'), { draw: [[g + 0.2, 0], [g + 0.5, 1, 'out']] });
  }
});

s.grain($('grain'));
await s.start();
