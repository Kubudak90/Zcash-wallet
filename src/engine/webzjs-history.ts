// How the WebZjs adapter (./webzjs.ts) reads the transaction history. Kept apart
// from the adapter, which loads the wasm packages, so the rules can be unit-tested.

import type { HistoryItem, TxStatus, TxType } from './types';

/**
 * One entry of TransactionHistoryResponse.transactions (webzjs-wallet
 * bindgen/transaction_history.rs TransactionHistoryEntry, through serde_wasm_bindgen).
 * An Option that is None arrives as undefined (serde_wasm_bindgen's default) or null;
 * integers as numbers, or BigInt if the serializer is set to.
 */
export interface RawHistoryEntry {
  txid: string;
  tx_type: 'Received' | 'Sent' | 'Shielded';
  value: number | bigint;
  fee?: number | bigint | null;
  block_height?: number | null;
  confirmations: number;
  status: 'Confirmed' | 'Pending' | 'Expired';
  memo?: string | null;
  timestamp?: number | bigint | null;
  pool: string;
}

const TX_TYPES: Record<RawHistoryEntry['tx_type'], TxType> = {
  Received: 'received',
  Sent: 'sent',
  Shielded: 'shielded',
};

const TX_STATUSES: Record<RawHistoryEntry['status'], TxStatus> = {
  Confirmed: 'confirmed',
  Pending: 'pending',
  Expired: 'expired',
};

export function historyFrom(entries: RawHistoryEntry[]): HistoryItem[] {
  return entries.map((e) => ({
    txid: e.txid,
    type: TX_TYPES[e.tx_type],
    valueZats: BigInt(e.value),
    feeZats: e.fee == null ? null : BigInt(e.fee),
    // HistoryItem says null for what is not known; the UI tells null from a value.
    height: e.block_height ?? null,
    confirmations: e.confirmations,
    status: TX_STATUSES[e.status],
    memo: e.memo ?? null,
    timestamp: e.timestamp == null ? null : Number(e.timestamp),
    pool: e.pool,
  }));
}
