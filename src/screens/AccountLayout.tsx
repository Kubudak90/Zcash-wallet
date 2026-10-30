import type { ReactNode } from 'react';

import { useI18n } from '../i18n';

/**
 * The pieces the screens outside the wallet share: Welcome, Create and Restore,
 * the password step, the lock screen and boot. Styles: src/styles/account.css.
 */

/** The logo and the wordmark. Decorative logo: the name is the text beside it. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={className ? `brand-mark ${className}` : 'brand-mark'}>
      <img src="/celari.svg" alt="" width={32} height={32} />
      <span>Celari</span>
    </div>
  );
}

// The engraved "C": the logo's letter drawn as a band of fine concentric arcs,
// opening to the right like the logo (±50°), with fainter echoes around it and
// the gold dot in its mouth. Coordinates in a 1200 x 1200 box around (600, 600).
const CX = 600;
const CY = 600;
const OPEN = (50 * Math.PI) / 180;

function arc(r: number): string {
  const x = (CX + r * Math.cos(OPEN)).toFixed(1);
  const y1 = (CY - r * Math.sin(OPEN)).toFixed(1);
  const y2 = (CY + r * Math.sin(OPEN)).toFixed(1);
  // From the upper end, the long way round (large arc, counter-clockwise) to the lower end.
  return `M${x} ${y1}A${r} ${r} 0 1 0 ${x} ${y2}`;
}

/** The letter itself: six lines close together read as one stroke. */
const BAND = [72, 78, 84, 90, 96, 102].map((r, i) => ({ r, o: 0.62 - i * 0.035 }));
/** The echoes: wider apart, fading out. */
const ECHOES = Array.from({ length: 20 }, (_, i) => ({ r: 128 + i * 24 + i * i * 0.6, o: 0.24 * Math.pow(0.86, i) }));
const DOT_X = CX + 87 * Math.cos(OPEN);

export function EngravedC({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `engraved-c ${className}` : 'engraved-c'}
      viewBox="0 0 1200 1200"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round" vectorEffect="non-scaling-stroke">
        {BAND.map(({ r, o }) => (
          <path key={r} d={arc(r)} strokeOpacity={o} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        ))}
        {ECHOES.map(({ r, o }) => (
          <path key={r} d={arc(r)} strokeOpacity={o} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <circle className="engraved-dot" cx={DOT_X} cy={CY} r={11} />
    </svg>
  );
}

/**
 * One step of Create or Restore: the brand and a quiet "Step n of 3" above a
 * centred card that holds the step's <Screen>.
 */
export function Flow({ step, total = 3, children }: { step: number; total?: number; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flow">
      <EngravedC className="flow-motif" />
      <header className="flow-top">
        <BrandMark />
        <p className="flow-step">
          <span>{t('flow.step', { n: step, total })}</span>
          <span className="flow-rule" aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={i < step ? 'on' : undefined} />
            ))}
          </span>
        </p>
      </header>
      <div className="flow-card">{children}</div>
    </div>
  );
}
