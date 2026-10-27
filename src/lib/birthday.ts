// The "birthday" is the block height a wallet was created at. Sync starts
// there, so a good estimate turns hours of scanning into minutes.

export const SAPLING_ACTIVATION_HEIGHT = 419_200;
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
  const daysAgo = Math.max(0, (now.getTime() - date.getTime()) / 86_400_000) + marginDays;
  const estimate = Math.floor(tipHeight - daysAgo * BLOCKS_PER_DAY);
  return Math.min(tipHeight, Math.max(SAPLING_ACTIVATION_HEIGHT, estimate));
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
