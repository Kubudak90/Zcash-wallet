// The Celari logo: the faceted, folded-ribbon "C" and the wordmark set in
// Outfit 500 (outlined, so no font is loaded for it; credit in
// public/FONT_LICENSES.txt). Inline SVG, so it takes the theme: the body is
// currentColor (the text colour) and the facet is var(--brand-facet), gold on
// the dark theme and the body's own ink on the light one (styles.css).
// Always decorative: the name is text next to it, or visually hidden text.

/**
 * One drawing per size range, each in a 64 x 64 box: the full mark with its
 * two folds from 48 px, one wide fold from 24 to 40 px (finer folds blur into
 * grey hairlines there) and the bare silhouette at 16 to 20 px.
 */
export type MarkMaster = 'full' | 'small' | '16';

interface MasterPaths {
  body: string;
  facet: string;
  /** The drawing's own bounds in the 64 box: what a lockup lines up with the name. */
  crop: string;
}

export const MASTERS: Record<MarkMaster, MasterPaths> = {
  full: {
    body: 'M43.471 27.99L31.09 20.253A18.129 18.129 0 0 0 25.23 17.89A81.33 81.33 0 0 0 15.508 16.443L27.354 9.041C32.507 5.821 35.083 5.821 40.236 9.041L52.965 16.995A2.205 2.205 0 0 1 53.243 20.529L44.779 27.887A1.103 1.103 0 0 1 43.471 27.99ZM11 39.995L11 22.137A4.41 4.41 0 0 1 15.818 17.746A80.06 80.06 0 0 1 24.968 19.133A16.859 16.859 0 0 1 30.417 21.33L30.659 21.481L30.236 21.778A91.651 91.651 0 0 0 12.28 38.32A26.205 26.205 0 0 0 11 39.995ZM11 42.295L11.533 41.475A24.935 24.935 0 0 1 13.258 39.131A90.381 90.381 0 0 1 18.259 33.588A35.295 35.295 0 0 0 32.397 48.918A90.817 90.817 0 0 0 42.096 53.797L40.236 54.959C35.083 58.179 32.507 58.179 27.354 54.959L13.073 46.035A4.41 4.41 0 0 1 11 42.295ZM31.424 43.538L43.471 36.01A1.103 1.103 0 0 1 44.779 36.113L53.243 43.471A2.205 2.205 0 0 1 52.965 47.005L43.409 52.976L43 52.802A89.547 89.547 0 0 1 33.75 48.23A31.362 31.362 0 0 1 31.424 43.538Z',
    facet: 'M28.868 24.331A32.632 32.632 0 0 0 31.561 46.913A34.025 34.025 0 0 1 19.213 32.629A90.381 90.381 0 0 1 28.868 24.331Z',
    crop: '11 6.626 42.242 50.747',
  },
  small: {
    body: 'M8 38.084L8 20.639A4.866 4.866 0 0 1 10.288 16.512L26.047 6.665C31.733 3.112 34.576 3.112 40.262 6.665L54.308 15.442A2.433 2.433 0 0 1 54.615 19.342L45.275 27.461A1.217 1.217 0 0 1 43.832 27.575L30.204 19.059L28.768 20.065A134.491 134.491 0 0 0 8.827 37.159A17.848 17.848 0 0 0 8 38.084ZM8 43.361L9.258 41.424A14.848 14.848 0 0 1 10.993 39.235A131.491 131.491 0 0 1 27.454 24.713A36.009 36.009 0 0 0 29.33 45.487L43.832 36.425A1.217 1.217 0 0 1 45.275 36.539L54.615 44.658A2.433 2.433 0 0 1 54.308 48.558L40.262 57.335C34.576 60.888 31.733 60.888 26.047 57.335L10.288 47.488A4.866 4.866 0 0 1 8 43.361Z',
    facet: 'M27.454 24.713A36.009 36.009 0 0 0 31.501 49.949A37.509 37.509 0 0 1 16.342 33.965A131.491 131.491 0 0 1 27.454 24.713Z',
    crop: '8 4 46.615 56',
  },
  '16': {
    body: 'M8 43.361L8 20.639A4.866 4.866 0 0 1 10.288 16.512L26.047 6.665C31.733 3.112 34.576 3.112 40.262 6.665L54.308 15.442A2.433 2.433 0 0 1 54.615 19.342L44.225 28.373A1.217 1.217 0 0 1 42.782 28.487L28.846 19.779A36.009 36.009 0 0 0 28.846 44.221L42.782 35.513A1.217 1.217 0 0 1 44.225 35.627L54.615 44.658A2.433 2.433 0 0 1 54.308 48.558L40.262 57.335C34.576 60.888 31.733 60.888 26.047 57.335L10.288 47.488A4.866 4.866 0 0 1 8 43.361Z',
    // The favicon's facet (public/favicon.svg) in this box: colour only, it lies on the body.
    facet: 'M27.994 22.463A36.009 36.009 0 0 0 31.352 49.687A38.304 38.304 0 0 1 16.264 32.541A98.604 98.604 0 0 1 27.994 22.463Z',
    crop: '8 4 46.615 56',
  },
};

/** The drawing for a mark shown `size` px square (its 64 box). */
export function masterFor(size: number): MarkMaster {
  if (size >= 48) return 'full';
  if (size <= 20) return '16';
  return 'small';
}

type Variant = 'auto' | MarkMaster;

function MarkSvg({
  master,
  cropped,
  width,
  height,
  className,
}: {
  master: MarkMaster;
  cropped: boolean;
  width: number;
  height: number;
  className: string;
}) {
  const m = MASTERS[master];
  return (
    <svg
      className={className}
      viewBox={cropped ? m.crop : '0 0 64 64'}
      width={width}
      height={height}
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={m.body} />
      <path className="brand-facet" fill="currentColor" d={m.facet} />
    </svg>
  );
}

/** The mark alone, in its 64 box: `size` px square, the drawing picked by size unless `variant` says. */
export function BrandMark({
  size = 32,
  variant = 'auto',
  className,
}: {
  size?: number;
  variant?: Variant;
  className?: string;
}) {
  const master = variant === 'auto' ? masterFor(size) : variant;
  return (
    <MarkSvg
      master={master}
      cropped={false}
      width={size}
      height={size}
      className={className ? `brand-mark ${className}` : 'brand-mark'}
    />
  );
}

const WORDMARK =
  'M50.43 104.29L50.43 104.29Q39.57 104.29 30.36 100.36Q21.14 96.43 14.29 89.36Q7.43 82.29 3.71 72.93Q0 63.57 0 52.86L0 52.86Q0 42.14 3.71 32.79Q7.43 23.43 14.29 16.43Q21.14 9.43 30.36 5.43Q39.57 1.43 50.43 1.43L50.43 1.43Q62.57 1.43 71.43 5.43Q80.29 9.43 87.14 16.29L87.14 16.29L76 27.43Q71.57 22.57 65.21 19.86Q58.86 17.14 50.43 17.14L50.43 17.14Q43 17.14 36.86 19.71Q30.71 22.29 26.21 27.07Q21.71 31.86 19.29 38.43Q16.86 45 16.86 52.86L16.86 52.86Q16.86 60.71 19.29 67.29Q21.71 73.86 26.21 78.64Q30.71 83.43 36.86 86Q43 88.57 50.43 88.57L50.43 88.57Q59.57 88.57 65.93 85.79Q72.29 83 76.71 78.14L76.71 78.14L87.86 89.29Q81 96.29 71.71 100.29Q62.43 104.29 50.43 104.29ZM128 104.29L128 104.29Q117.71 104.29 109.5 99.64Q101.29 95 96.5 86.86Q91.71 78.71 91.71 68.57Q91.71 58.43 96.43 50.36Q101.14 42.29 109.21 37.57Q117.29 32.86 127.14 32.86L127.14 32.86Q136.71 32.86 144.07 37.29Q151.43 41.71 155.64 49.43Q159.86 57.14 159.86 67L159.86 67Q159.86 68.71 159.64 70.5Q159.43 72.29 159 74.43L159 74.43L107.86 74.43Q108.43 77.14 109.71 79.43L109.71 79.43Q112.29 84.29 117 86.93Q121.71 89.57 127.86 89.57L127.86 89.57Q133.14 89.57 137.64 87.71Q142.14 85.86 145.29 82.29L145.29 82.29L155.29 92.43Q150.29 98.29 143.14 101.29Q136 104.29 128 104.29ZM107.86 61.57L107.86 61.57L144.43 61.57Q143.71 58.57 142.57 56.14L142.57 56.14Q140.43 51.86 136.5 49.57Q132.57 47.29 126.86 47.29L126.86 47.29Q120.86 47.29 116.43 49.86Q112 52.43 109.57 57L109.57 57Q108.43 59.14 107.86 61.57ZM187 102.86L171.29 102.86L171.29 0L187 0L187 102.86ZM232 104.29L232 104.29Q222.71 104.29 215.21 99.57Q207.71 94.86 203.36 86.79Q199 78.71 199 68.71L199 68.71Q199 58.57 203.36 50.5Q207.71 42.43 215.21 37.64Q222.71 32.86 232 32.86L232 32.86Q239.86 32.86 246 36.14L246 36.14Q250 38.43 253 41.86L253 41.86L253 34.29L268.71 34.29L268.71 102.86L253 102.86L253 95.43Q250.14 98.71 246 100.86L246 100.86Q239.86 104.29 232 104.29ZM234.57 89.43L234.57 89.43Q243.29 89.43 248.64 83.57Q254 77.71 254 68.57L254 68.57Q254 62.43 251.57 57.71Q249.14 53 244.79 50.36Q240.43 47.71 234.57 47.71L234.57 47.71Q228.86 47.71 224.5 50.36Q220.14 53 217.64 57.71Q215.14 62.43 215.14 68.57Q215.14 74.71 217.64 79.43Q220.14 84.14 224.5 86.79Q228.86 89.43 234.57 89.43ZM300.71 102.86L285 102.86L285 34.29L300.71 34.29L300.71 41.43Q300.86 41.14 301.14 40.86L301.14 40.86Q306.86 32.86 318.57 32.86L318.57 32.86Q323.71 32.86 327.86 34.71Q332 36.57 335.57 40.71L335.57 40.71L325.29 51.29Q323.43 49.29 321.14 48.43Q318.86 47.57 315.86 47.57L315.86 47.57Q309.29 47.57 305 51.71Q300.71 55.86 300.71 64.71L300.71 64.71L300.71 102.86ZM357.86 102.86L342.14 102.86L342.14 34.29L357.86 34.29L357.86 102.86ZM340.89 10.54C340.89 5.51 344.97 1.43 350 1.43C355.03 1.43 359.11 5.51 359.11 10.54C359.11 15.58 355.03 19.66 350 19.66C344.97 19.66 340.89 15.58 340.89 10.54Z';

/** The word "Celari" as drawn letters, `height` px tall (ascender to the bowls' overshoot). */
export function Wordmark({ height = 15, className }: { height?: number; className?: string }) {
  return (
    <svg
      className={className ? `brand-wordmark ${className}` : 'brand-wordmark'}
      viewBox="0 0 359.11 104.29"
      width={+((height * 359.11) / 104.29).toFixed(2)}
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={WORDMARK} />
    </svg>
  );
}

/**
 * Mark and name side by side, in the proportions of the logo files: the name's
 * capitals 0.52 of the mark's height and centred on it, 0.31 of that height
 * between them (styles.css, .brand-lockup, from --brand-h). `size` is the
 * mark's height in px where it is shown and picks its drawing; CSS may set it
 * otherwise per layout. The name is drawn, so its text is there for screen
 * readers (and for anything that reads the brand's text) in a hidden span.
 */
export function BrandLockup({ size = 28, className }: { size?: number; className?: string }) {
  // The cropped drawing fills `size`; in its 64 box it would be shown 64/56 larger.
  const master = masterFor(Math.round((size * 64) / 56));
  return (
    <span className={className ? `brand-lockup ${className}` : 'brand-lockup'}>
      <MarkSvg
        master={master}
        cropped
        width={+(size * 0.8324).toFixed(2)}
        height={size}
        className="brand-lockup-mark"
      />
      <Wordmark height={+(size * 0.5423).toFixed(2)} className="brand-lockup-name" />
      <span className="visually-hidden">Celari</span>
    </span>
  );
}
