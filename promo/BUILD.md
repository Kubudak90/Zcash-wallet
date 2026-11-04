# Celari video: how scenes are built

A scene is `promo/scenes/<id>/index.html` + `scene.js`. It is a **pure function of time**: the renderer
(`render.mjs`) calls `window.__seek(t)` for every frame and screenshots the page at 1920x1080. Nothing may
run on its own clock.

```
promo/
  lib/stage.js     Scene, tracks, cursor, camera, typing, counters, plates   (read its header comment)
  lib/layout.js    tutorialShell(): the shared usage layout (window + step panel)
  lib/brand.js     markSVG, wordmarkSVG, lockupHTML, iconSVG(name), engravedCSVG
  lib/stage.css    the wallet's tokens, fonts, .chip .card .callout .caption .browser .phone ...
  plates/          real UI screenshots (retina PNG) + plates.json (element boxes), tr/en x desktop/phone
  scenes/_template-promo/      free-form scene (brand, ideas, diagrams, closing)
  scenes/_template-tutorial/   usage scene on the shared layout
  STORYBOARD.md    what each scene must say and show   <- your brief
  render.mjs       stills / video renderer
```

## Workflow for one scene

1. `cp -r promo/scenes/_template-promo promo/scenes/<id>` (or `_template-tutorial`), edit `scene.js`.
2. Look at the plates you need: open the PNGs under `promo/plates/tr/desktop/` with the Read tool, and read
   their boxes in `promo/plates/plates.json` (`"tr.desktop" -> name -> targets -> {x,y,w,h}` in plate px).
   Cursor positions, rings, callouts and camera moves must use these boxes, never guessed numbers.
3. Render stills and LOOK at them (this is your only feedback loop, you cannot watch the video):
   `node promo/render.mjs scenes/<id> --lang tr --stills 0.5,1.5,3,4.5,6,8,9.5 --outdir <scratchpad>/<id>`
   then Read the printed `*.sheet.png` (2 columns, timestamps on each cell). Pick timestamps that sit on the
   moments that matter: just after something appears, mid-move, the settled hold, the last second.
   Zoom in on a single still (Read the full PNG) when text or an alignment looks doubtful.
4. Do the same with `--lang en`. Both languages must be complete and clean.
5. The render must print no `PROBLEMS:` (a 404, a console error, a missing plate or target is a bug).

Do not run a full video render (`--out`); stills only. Do not run `capture/`. Do not edit `lib/*`, `plates/*`
or other scenes: if you find a bug in `lib/`, work around it in your scene and report it in your final message.

## Recipes

**Typing into a field** (the plates only hold the empty and the filled state):
```js
const empty = sh.plate('send-empty'), filled = sh.plate('send-filled');   // filled is inserted after, so it is above
s.track(filled, { opacity: [[2.0, 0], [2.01, 1]] });                      // visible from 2.0 s (not via s.swap)
s.reveal(filled, sh.rect('send-filled', 'to'), 2.0, 3.2);                 // only inside the field, left to right
// when everything is typed, show the whole filled plate: load it again as a third layer and fade it in
const full = sh.plate('send-filled'); s.track(full, { opacity: [[5.0, 0], [5.3, 1]] });
sh.cursor([...]);                                                          // the cursor sits above all plates
```
Several sequential screens: ONE `s.swap([a, b, c], [0, t1, t2])` per scene for the whole-plate changes; extra layers you
add by hand need their own `zIndex` (the swap uses 1..n; the cursor is 50, overlays are above everything).
Camera: `sh.camera([{ t: 0, rect: null }, { t: 4, rect: sh.rect(plate, key), fill: 0.6 }, { t: 8, rect: null }])`
(boxes are plate px; `fill` is the share of the window the box fills). Zoom in no further than ~2x.
Blurring a region (the recovery words): add the same plate once more as a layer, clip it to the box with `clipT/R/B/L`
(percent of the plate: x/W*100 etc.), give it `blur: [[t, 0], [t + 0.4, 14]]` and fade it in above the sharp layer.
(`backdrop-filter` is not allowed.)
Free-form scenes: build the DOM as in `_template-promo`; `engravedCSVG(size)` gives a ready C whose lines you draw with
`{ draw: [[t0, 0], [t1, 1]] }` (classes `.ec-sil .ec-band .ec-echo .ec-facet`).

## Hard rules (a scene that breaks them is rejected)

**Determinism.** No `setTimeout`, `setInterval`, `requestAnimationFrame`, CSS `animation`/`transition`/
`animation-delay`, `Date.now()` or `Math.random()` in a scene. Everything moves through `s.track`, `s.on`,
`s.cursor`, `s.camera`, `s.type`, `s.count`, `s.swap`, `s.reveal` (use `hash01(i)` for repeatable randomness).
`await s.start()` must be the last line of `scene.js`; top-level `await loadPlates()` before building the DOM.

**Language.** Every visible string goes through `pick({ tr: '…', en: '…' })`. Turkish is the primary language
and is typically 10-20% longer: lay out for the longer one. Turkish needs proper characters (ç ğ ı İ ö ş ü) and
typographic quotes/apostrophes (’ “ ”). Use the app's own words for UI things (below).

**Accuracy.** Every claim on screen must be backed by `README.md`, `landing/build.py` (the website's approved
copy, TR and EN), or `src/i18n/en.ts` / `tr.ts`. Put the source next to the string in a comment
(`// landing tr: features[1]`, `// en.ts: home.serverSees`). Never claim or imply: audited, anonymous,
untraceable, "nobody can see", guaranteed, "safe to hold large amounts", NU7 readiness, prices, returns,
partnerships. Shielded means amounts and parties are not visible on chain (except value crossing between pools,
and the transparent leg of a shielding). The server DOES see your IP address, your transparent addresses and
the transactions you broadcast. The site is "early software, not independently audited". When unsure, leave it out.

**Vocabulary (TR / EN).** Gizli / Shielded · Şeffaf · herkese açık / Transparent · public · Kısmen gizli /
Partly shielded · Gizliye aktar / Shield funds · kurtarma kelimeleri / recovery phrase · Bakiye / Al / Gönder /
Geçmiş / Ayarlar / Kilitle = Balance / Receive / Send / History / Settings / Lock · görüntüleme anahtarı /
viewing key · not (memo) / memo. Write "gizli (shielded)" the first time Turkish viewers meet the word.

**Brand.** Obsidian & gold. Colours only through the CSS variables in `stage.css`. Gold is for the one primary
thing on screen (primary action, active marker, the facet, one emphasised word); sage = shielded, copper =
transparent, and each always comes with words and a shape (dot / hollow dot), never colour alone. Display type
Fraunces (optical-size serif, italic for the one emphasised phrase), UI type Geist, addresses Geist Mono.
No emoji, no stock icons: use `iconSVG(name)` (the wallet's own icon set). No drop shadows on text.

**Legibility.** At 1920x1080: body text >= 28 px, labels >= 22 px, panel titles 56-64 px, headlines 80-120 px.
Keep an 80 px safe margin. One idea per statement, <= 12 words; show a statement for at least
`words/3 + 1.2` seconds. Never put text over busy imagery without a solid card behind it.

**Motion.** Default easing is the wallet's `out`; stagger siblings by 0.08-0.15 s; entrances 0.5-0.9 s; use
the camera for emphasis, not decoration. Every scene needs visible motion in every 2 s window, and a calm
hold of >= 1.2 s at the end: the assembler cross-dissolves 0.5 s over the last 0.5 s of this scene and the
first 0.5 s of the next, so both must be composed (not empty, not mid-move) at those moments.
Tutorial scenes start with the window already in place (only `first: true` brings it in), so neighbouring
steps dissolve into each other.

**Performance.** Every frame is a software render. No `backdrop-filter`, no `filter: blur` above ~12 px on
large layers (small elements are fine), no extra `mix-blend-mode`, no box-shadow blur above ~80 px on more than
a couple of elements, at most ~600 animated DOM nodes (the engraved C's 29 lines are fine).

**Plates are the real UI.** Never redraw, crop-and-fake or alter a plate's content. You may scale (<= 2x so it
stays sharp), crossfade between plates, clip-reveal (`s.reveal`) a filled plate over an empty one to imitate
typing, put a cursor, ring, callout or blur on top. A plate shows demo data (the app ran with its scripted fake
engine); the shell says so. The 24 recovery words are a throwaway demo phrase: show them readable for at most
~2 s, then blur them, and say they are demo words.

## Reporting back

Final message: the scene ids, the final durations, anything you could not do and why, lib bugs found, and the
list of on-screen claims with their sources. Keep it short.
