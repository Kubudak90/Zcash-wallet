// The "birthday" is the block height a wallet was created at. Sync starts
// there, so a good estimate turns hours of scanning into minutes.

export const SAPLING_ACTIVATION_HEIGHT = 419_200;
/** Month of Sapling activation; shielded wallets cannot be older. */
export const SAPLING_MONTH = '2018-10';
/** Target block spacing from the Blossom upgrade (December 2019) until NU7. */
export const BLOCK_TIME_SECONDS = 75;
/** NU7's mainnet activation height. From it on, blocks are 25 s apart (ZIP 218). */
export const NU7_ACTIVATION_HEIGHT = 3_543_405;
/** Target block spacing from NU7 on. */
export const NU7_BLOCK_TIME_SECONDS = 25;
/** Scan this many days before the estimate to absorb block-time drift. */
export const SAFETY_MARGIN_DAYS = 14;
/** How far under the tip a new wallet starts, in block time: 10 blocks before NU7, 30 after. */
const NEW_WALLET_MARGIN_SECONDS = 10 * BLOCK_TIME_SECONDS;

/**
 * The height `seconds` of block time below `height`. Blocks are 75 s apart
 * below NU7's activation height and 25 s apart from it on (as in ZIP 208, a
 * block follows the spacing in force at its own height), so a span across
 * the activation counts each side at its own rate.
 */
export function heightBefore(height: number, seconds: number): number {
  // Blocks at NU7's activation height and above, back down to `height`.
  const fastBlocks = Math.max(0, height - (NU7_ACTIVATION_HEIGHT - 1));
  const fastSeconds = fastBlocks * NU7_BLOCK_TIME_SECONDS;
  if (seconds <= fastSeconds) return Math.floor(height - seconds / NU7_BLOCK_TIME_SECONDS);
  return Math.floor(height - fastBlocks - (seconds - fastSeconds) / BLOCK_TIME_SECONDS);
}

/** The height `seconds` of block time above `height`, at the spacing heightBefore uses. */
export function heightAfter(height: number, seconds: number): number {
  // Blocks above `height` and below NU7's activation height.
  const slowBlocks = Math.max(0, NU7_ACTIVATION_HEIGHT - 1 - height);
  const slowSeconds = slowBlocks * BLOCK_TIME_SECONDS;
  if (seconds <= slowSeconds) return Math.floor(height + seconds / BLOCK_TIME_SECONDS);
  return Math.floor(height + slowBlocks + (seconds - slowSeconds) / NU7_BLOCK_TIME_SECONDS);
}

/** A mainnet height and a time it had been reached by (a server's answer, 2026-10-28 12:50:36 UTC). */
const HEIGHT_ANCHOR = { height: 3_533_575, time: Date.UTC(2026, 9, 28, 12, 50, 36) };

/**
 * The mainnet height at `date`, from the clock alone: counted from a known
 * height at the target spacing. Only as good as the device's clock.
 */
export function estimateHeightAt(date: Date): number {
  const seconds = (date.getTime() - HEIGHT_ANCHOR.time) / 1000;
  return seconds >= 0 ? heightAfter(HEIGHT_ANCHOR.height, seconds) : heightBefore(HEIGHT_ANCHOR.height, -seconds);
}

/**
 * Estimates the height at `date` by counting back from the current tip, at
 * the target spacing (see heightBefore), which blocks have kept steadily
 * since Blossom. Dates before Sapling activation clamp to it, since shielded
 * wallets cannot be older.
 */
export function estimateBirthday(
  date: Date,
  tipHeight: number,
  now: Date = new Date(),
  marginDays = SAFETY_MARGIN_DAYS,
): number {
  // NaN would survive the clamps below and end up as the wallet's birthday.
  if (Number.isNaN(date.getTime())) throw new RangeError('invalid birthday date');
  const seconds = Math.max(0, (now.getTime() - date.getTime()) / 1000) + marginDays * 86_400;
  const estimate = heightBefore(tipHeight, seconds);
  return Math.min(tipHeight, Math.max(SAPLING_ACTIVATION_HEIGHT, estimate));
}

/** The current month as 'YYYY-MM', in local time like the month picker. */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Reads a typed month: '2023-05' (what type="month" gives), and the forms people
 * type where browsers fall back to a text box, such as '05.2023', '5/2023' or
 * '05-2023'. Returns 'YYYY-MM' between Sapling activation and `now`, or null.
 */
export function parseBirthdayMonth(value: string, now: Date = new Date()): string | null {
  const s = value.trim();
  const m = /^(?<y>\d{4})[-./](?<m>\d{1,2})$/.exec(s) ?? /^(?<m>\d{1,2})[-./](?<y>\d{4})$/.exec(s);
  if (!m?.groups) return null;
  const month = Number(m.groups.m);
  if (month < 1 || month > 12) return null;
  const ym = `${m.groups.y}-${String(month).padStart(2, '0')}`;
  // Zero-padded 'YYYY-MM' strings compare in date order.
  return ym >= SAPLING_MONTH && ym <= currentMonth(now) ? ym : null;
}

/**
 * Birthday for a brand-new wallet: about 12 minutes of blocks under the tip,
 * to tolerate reorgs and a server a little behind (10 blocks before NU7, 30 after).
 */
export function newWalletBirthday(tipHeight: number): number {
  return Math.max(SAPLING_ACTIVATION_HEIGHT, heightBefore(tipHeight, NEW_WALLET_MARGIN_SECONDS));
}

/** Scan progress between the birthday and the chain tip, 0..1. */
export function syncProgress(birthday: number, scannedHeight: number, tipHeight: number): number {
  const span = tipHeight - birthday;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (scannedHeight - birthday) / span));
}
