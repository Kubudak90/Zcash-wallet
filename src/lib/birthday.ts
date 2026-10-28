// The "birthday" is the block height a wallet was created at. Sync starts
// there, so a good estimate turns hours of scanning into minutes.

export const SAPLING_ACTIVATION_HEIGHT = 419_200;
/** Month of Sapling activation; shielded wallets cannot be older. */
export const SAPLING_MONTH = '2018-10';
/** Target block spacing since the Blossom upgrade (December 2019). */
export const BLOCK_TIME_SECONDS = 75;
/** Scan this many days before the estimate to absorb block-time drift. */
export const SAFETY_MARGIN_DAYS = 14;

const BLOCKS_PER_DAY = (24 * 60 * 60) / BLOCK_TIME_SECONDS;

/**
 * Estimates the height at `date` by counting back from the current tip.
 * Works because block spacing has been a steady 75s since Blossom; dates before
 * Sapling activation clamp to it, since shielded wallets cannot be older.
 */
export function estimateBirthday(
  date: Date,
  tipHeight: number,
  now: Date = new Date(),
  marginDays = SAFETY_MARGIN_DAYS,
): number {
  // NaN would survive the clamps below and end up as the wallet's birthday.
  if (Number.isNaN(date.getTime())) throw new RangeError('invalid birthday date');
  const daysAgo = Math.max(0, (now.getTime() - date.getTime()) / 86_400_000) + marginDays;
  const estimate = Math.floor(tipHeight - daysAgo * BLOCKS_PER_DAY);
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

/** Birthday for a brand-new wallet: a few blocks under the tip to tolerate reorgs. */
export function newWalletBirthday(tipHeight: number): number {
  return Math.max(SAPLING_ACTIVATION_HEIGHT, tipHeight - 10);
}

/** Scan progress between the birthday and the chain tip, 0..1. */
export function syncProgress(birthday: number, scannedHeight: number, tipHeight: number): number {
  const span = tipHeight - birthday;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (scannedHeight - birthday) / span));
}
