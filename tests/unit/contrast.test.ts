import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Reads the colour tokens straight from the stylesheet, so a tweaked token
// that drops below WCAG AA fails here before anyone sees it.
const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1]!, m[2]!]));
}

const dark = tokens(css.slice(css.indexOf(':root {'), css.indexOf('}')));
const lightStart = css.indexOf('@media (prefers-color-scheme: light)');
const light = { ...dark, ...tokens(css.slice(lightStart, css.indexOf('}', lightStart))) };

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// Every background that text sits on: the page, the desktop sidebar, cards,
// raised and hovered rows, and the wells of form fields.
const BACKGROUNDS = ['bg', 'side', 'surface', 'surface-2', 'raised', 'inset'];

describe.each([
  ['dark', dark],
  ['light', light],
])('%s theme tokens', (_name, theme) => {
  it.each(['text', 'muted', 'subtle', 'accent-fg', 'ok', 'warn', 'error'])('--%s is readable text (4.5:1) on every background', (fg) => {
    for (const bg of BACKGROUNDS) expect(contrast(theme[fg]!, theme[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('--input-border outlines fields at 3:1 on every background', () => {
    for (const bg of BACKGROUNDS) expect(contrast(theme['input-border']!, theme[bg]!), bg).toBeGreaterThanOrEqual(3);
  });

  it('--focus rings and the --accent-mark nav marker stand out at 3:1 on every background', () => {
    for (const bg of BACKGROUNDS) {
      expect(contrast(theme.focus!, theme[bg]!), `focus on ${bg}`).toBeGreaterThanOrEqual(3);
      expect(contrast(theme['accent-mark']!, theme[bg]!), `accent-mark on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('--accent-text is readable on the --accent fill', () => {
    expect(contrast(theme['accent-text']!, theme.accent!)).toBeGreaterThanOrEqual(4.5);
  });
});
