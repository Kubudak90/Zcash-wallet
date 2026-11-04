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

Silent by design: the narration lines in `storyboard.json` are there for a voice-over or subtitles. Facts on screen
come from `README.md`, `landing/build.py` and `src/i18n/*.ts`; when those change, change the scenes with them.
