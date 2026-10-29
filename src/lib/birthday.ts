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

/**
 * A restore that scans more blocks than this from its birthday gets a notice (RestoreWallet):
 * the first scan then takes hours and several GB of memory. About 14 months of 75 s blocks.
 */
export const LONG_SCAN_BLOCKS = 500_000;

/**
 * About how many blocks a restore from the start of `month` ('YYYY-MM') scans: the gap from the
 * birthday estimateBirthday() picks to `tipHeight`. Without a tip, the time since then at 75 s a
 * block (NU7's faster blocks make the real count only larger).
 */
export function blocksToScan(month: string, tipHeight: number | null, now: Date = new Date()): number {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (tipHeight !== null) return tipHeight - estimateBirthday(date, tipHeight, now);
  const seconds = Math.max(0, (now.getTime() - date.getTime()) / 1000) + SAFETY_MARGIN_DAYS * 86_400;
  return Math.floor(seconds / BLOCK_TIME_SECONDS);
}

/** Scan progress between the birthday and the chain tip, 0..1. */
export function syncProgress(birthday: number, scannedHeight: number, tipHeight: number): number {
  const span = tipHeight - birthday;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (scannedHeight - birthday) / span));
}
