#!/usr/bin/env node
// Renders every scene to a clip, then joins the clips with cross-dissolves into the three cuts.
//
//   node promo/assemble.mjs --lang tr [--cut full|promo|tutorial|all] [--force] [--only s01-open,s02-default] [--workers 3]
//   node promo/assemble.mjs --lang tr --sheets          (only QA contact sheets of the finished cuts)
//
// Clips:  promo/out/clips/<scene>.<lang>.mp4 (re-rendered when the scene, lib/ or plates/ are newer, or --force)
// Cuts:   promo/out/celari-<cut>.<lang>.mp4 + .vo.srt (the narration script laid on the timeline, one cue per scene)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderScene } from './render.mjs';

const PROMO = dirname(fileURLToPath(import.meta.url));
const SB = JSON.parse(readFileSync(join(PROMO, 'storyboard.json'), 'utf8'));
const argv = process.argv.slice(2);
const opt = { lang: 'tr', cut: 'all', force: false, only: null, workers: 3, sheets: false };
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (k === '--force') opt.force = true;
  else if (k === '--sheets') opt.sheets = true;
  else if (k === '--lang') opt.lang = argv[++i];
  else if (k === '--cut') opt.cut = argv[++i];
  else if (k === '--only') opt.only = argv[++i].split(',');
  else if (k === '--workers') opt.workers = Number(argv[++i]);
  else throw new Error(`unknown option ${k}`);
}
const OUT = join(PROMO, 'out');
const CLIPS = join(OUT, 'clips');
mkdirSync(CLIPS, { recursive: true });
const sceneById = Object.fromEntries(SB.scenes.map((s) => [s.id, s]));
const cuts = opt.cut === 'all' ? Object.keys(SB.cuts) : [opt.cut];

const newest = (dir) => {
  let m = 0;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    m = Math.max(m, f.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return m;
};
const probe = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]).stdout.toString().trim());
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status})`);
};
const srtTime = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

async function ensureClip(id) {
  const clip = join(CLIPS, `${id}.${opt.lang}.mp4`);
  const stale = !existsSync(clip) || statSync(clip).mtimeMs < Math.max(newest(join(PROMO, 'scenes', id)), newest(join(PROMO, 'lib')), newest(join(PROMO, 'plates')));
  if (opt.force || stale || (opt.only && opt.only.includes(id))) {
    console.log(`\n== render ${id} (${opt.lang})`);
    const code = await renderScene({ scene: `scenes/${id}`, lang: opt.lang, fps: SB.fps, workers: opt.workers, out: clip, crf: 10, tmp: process.env.PROMO_TMP ?? join(OUT, '.frames'), keep: false, duration: null, stills: null });
    if (code !== 0) throw new Error(`scene ${id} rendered with problems (see above)`);
  }
  return clip;
}

function join_(ids, clips, name) {
  const durs = ids.map((id) => probe(clips[id]));
  const ov = ids.map((id, i) => (i === 0 ? 0 : sceneById[id].overlapIn ?? SB.defaultOverlap));
  const starts = [];
  let acc = 0;
  ids.forEach((_, i) => {
    acc = i === 0 ? 0 : acc + durs[i - 1] - ov[i];
    starts.push(acc);
  });
  const total = starts[ids.length - 1] + durs[ids.length - 1];
  const inputs = ids.flatMap((id) => ['-i', clips[id]]);
  const parts = [];
  let last = '[0:v]';
  for (let i = 1; i < ids.length; i++) {
    const fadeIn = SB.fadeIn?.[name];
    const out = i === ids.length - 1 ? (fadeIn ? '[vj]' : '[v]') : `[x${i}]`;
    // a join can name its own xfade transition in storyboard.json "transitions": { "<from>><to>": "fadeblack" }
    const kind = SB.transitions?.[`${ids[i - 1]}>${ids[i]}`] ?? 'fade';
    parts.push(`${last}[${i}:v]xfade=transition=${kind}:duration=${ov[i]}:offset=${starts[i].toFixed(3)}${out}`);
    last = out;
  }
  const file = join(OUT, `celari-${name}.${opt.lang}.mp4`);
  // optional fade-in from black on the first frame of a cut (storyboard.json "fadeIn": { "<cut>": seconds }), for cuts that open on a composed scene
  const fin = SB.fadeIn?.[name];
  const filter = ids.length === 1 ? (fin ? `[0:v]fade=t=in:st=0:d=${fin}[v]` : '[0:v]null[v]') : parts.join(';') + (fin ? `;[vj]fade=t=in:st=0:d=${fin}[v]` : '');
  run('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
    '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-x264-params', 'aq-mode=3:aq-strength=0.9:keyint=60:min-keyint=30', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-r', String(SB.fps), '-movflags', '+faststart', file]);
  // narration script on the timeline: one cue per scene, inside its own (non-overlapped) part
  const cues = ids.map((id, i) => {
    const a = starts[i] + (i === 0 ? 0.3 : ov[i]);
    const b = starts[i] + durs[i] - (i === ids.length - 1 ? 0.2 : ov[i + 1]);
    return `${i + 1}\n${srtTime(a)} --> ${srtTime(b)}\n${sceneById[id].vo[opt.lang]}\n`;
  });
  writeFileSync(join(OUT, `celari-${name}.${opt.lang}.vo.srt`), cues.join('\n'));
  // poster frame (JPEG decoders assume BT.601, so convert the bt709 tv-range frame accordingly; a settled moment; storyboard.json "posters": { "<cut>": seconds }) for players and uploads that need a thumbnail
  const pt = SB.posters?.[name];
  if (pt != null) run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(pt), '-i', file, '-frames:v', '1', '-vf', 'scale=in_range=tv:in_color_matrix=bt709:out_range=pc:out_color_matrix=bt601,format=yuvj420p', '-q:v', '2', join(OUT, `celari-${name}.${opt.lang}.poster.jpg`)]);
  console.log(`\n${name}.${opt.lang}: ${total.toFixed(1)} s, ${ids.length} scenes -> ${file}`);
  return { file, total, starts, durs };
}

function sheets(file, name) {
  const dir = join(OUT, 'qa');
  mkdirSync(dir, { recursive: true });
  const dur = probe(file);
  const step = dur / 24;
  const frames = [];
  for (let i = 0; i < 24; i++) {
    const t = Math.min(dur - 0.1, 0.4 + i * step);
    const f = join(dir, `${name}.${opt.lang}.t${t.toFixed(2).padStart(6, '0')}.png`);
    run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', f]);
    frames.push(f);
  }
  for (let k = 0; k < 24; k += 8) run('python3', ['-I', join(PROMO, 'lib', 'sheet.py'), join(dir, `${name}.${opt.lang}.sheet${k / 8 + 1}.png`), ...frames.slice(k, k + 8)]);
  console.log(`QA sheets: ${dir}/${name}.${opt.lang}.sheet{1,2,3}.png`);
}

if (!opt.sheets) {
  const needed = [...new Set(cuts.flatMap((c) => SB.cuts[c]))];
  const clips = {};
  for (const id of needed) clips[id] = await ensureClip(id);
  for (const c of cuts) join_(SB.cuts[c], clips, c);
}
for (const c of cuts) {
  const f = join(OUT, `celari-${c}.${opt.lang}.mp4`);
  if (existsSync(f)) sheets(f, c);
}
