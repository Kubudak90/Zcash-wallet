// Which History entries the controller sends to the network again (rebroadcastPending).

import type { HistoryItem } from '../engine/types';

/**
 * The wallet's own unmined transactions: pending, and funded by this wallet ('sent' and
 * 'shielded'; WebZjs calls a transaction 'received' only when the wallet spent nothing in it).
 * Chosen by type, not by the sign of the value (review round 8, F-02): WebZjs gives a
 * shielding, a transfer between the wallet's own pools and a ZIP 318 canonical crossing the
 * value that arrived in its shielded pools, which is above 0, so a sign test left exactly the
 * crossings round 7's resend was for out.
 */
export function resendable(history: readonly HistoryItem[]): HistoryItem[] {
  return history.filter((tx) => tx.status === 'pending' && tx.type !== 'received');
}
