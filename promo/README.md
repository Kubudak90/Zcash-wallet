# Celari promo and how-to video

Animated, programmatic video of the wallet: 15 scenes, Turkish (primary) and English, 1920x1080 at 30 fps.
Every frame is rendered from HTML (`scenes/<id>/`), the UI you see in the usage scenes is the **real wallet**
(captured from the dev build with its scripted fake engine, so the balances, addresses and recovery words are demo data).

```
node promo/assemble.mjs --lang tr --cut all     # render every scene, join, write promo/out/celari-{full,promo,tutorial}.tr.mp4
node promo/assemble.mjs --lang en --cut all     # the same in English
node promo/assemble.mjs --lang tr --sheets      # QA contact sheets of the finished cuts (promo/out/qa/)
```

| file | what |
| --- | --- |
| `storyboard.json` | scene order, cuts, overlaps, narration script per scene (TR/EN) |
| `STORYBOARD.md` | the brief for each scene: copy with its source, beats, plates |
| `BUILD.md` | how a scene is built: the rules (determinism, accuracy, brand, legibility) and recipes |
| `scenes/<id>/` | `index.html` + `scene.js`; a scene is a pure function of time (`window.__seek(t)`) |
| `lib/` | `stage.js` (timeline), `layout.js` (usage layout), `brand.js` (logo, icons), `stage.css` (tokens) |
| `plates/` | real UI screenshots + `plates.json` (element boxes); regenerate with `capture/capture.mjs` |
| `render.mjs` | stills (`--stills 1,2.5 --outdir DIR`) or one scene to MP4 |
| `assemble.mjs` | clips -> cuts with cross-dissolves, plus `.vo.srt` (narration on the timeline) |

Refresh the plates (after the wallet's UI changes):

```
VITE_FAKE_ENGINE=1 npx vite --port 5199 --strictPort &
node promo/capture/capture.mjs all all
node promo/lib/gen-brand.mjs          # logo / icons from src/components when they change
```

Silent by design: the narration lines in `storyboard.json` are there for a voice-over. `celari-<cut>.<lang>.vo.srt` is that
**voice-over script laid on the timeline (one cue per scene), not a caption track**: its cues are whole paragraphs.

Output (`promo/out/`, git-ignored; rebuild with `assemble.mjs`), 1920x1080, 30 fps, H.264 High@4.1 (crf 16, keyframe every 2 s), no audio:

| cut | length | scenes |
| --- | --- | --- |
| `celari-full.<lang>.mp4` | about 2:41 | s01-s15 |
| `celari-promo.<lang>.mp4` | about 1:02 | s01-s04, s14, s15 |
| `celari-tutorial.<lang>.mp4` | about 1:49 | s05-s13, s15 (0.4 s fade-in from black) |

`celari-<cut>.<lang>.poster.jpg` is a settled frame to use as the player poster / thumbnail (times in `storyboard.json` `posters`).
`storyboard.json` also holds per-join transitions (`transitions`, e.g. the promo cut dips through black between s04 and s14)
and the first-frame fade-in (`fadeIn`). Facts on screen
come from `README.md`, `landing/build.py` and `src/i18n/*.ts`; when those change, change the scenes with them.
