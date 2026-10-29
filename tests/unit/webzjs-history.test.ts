import { describe, expect, it } from 'vitest';

import { historyFrom, type RawHistoryEntry } from '../../src/engine/webzjs-history';

// Entries as webzjs-wallet's get_transaction_history hands them over: TransactionHistoryEntry
// through serde_wasm_bindgen, where an Option that is None arrives as undefined (its default;
// null is handled the same). The cases are those of the engine's native tests
// (webzjs-wallet tests::history, tests::data_requests): a payment of 300,000 zats with fee
// 10,000 and a memo, after a rebuild and rescan from the seed (review findings R0 and R4).
const entry = (patch: Partial<Record<keyof RawHistoryEntry, unknown>>) =>
  ({
    txid: 'ab'.repeat(32),
    tx_type: 'Sent',
    value: -300_000,
    fee: undefined,
    block_height: 3_533_700,
    confirmations: 101,
    status: 'Confirmed',
    memo: undefined,
    timestamp: 1_793_000_000,
    pool: 'ironwood',
    ...patch,
  }) as unknown as RawHistoryEntry;

describe('historyFrom', () => {
  it('shows a rescanned payment seen only in compact blocks as sent, amount and fee together', () => {
    // R0: before the engine fix this came back as ('Shielded', +690000).
    const [tx] = historyFrom([entry({ value: -310_000 })]);
    expect(tx).toMatchObject({ type: 'sent', valueZats: -310_000n, feeZats: null, memo: null });
  });

  it('shows the payment with its fee and memo once the full transaction was fetched', () => {
    // R4: the pass's GetTransaction gives back what compact blocks lack.
    const [tx] = historyFrom([entry({ fee: 10_000, memo: 'thanks for the coffee' })]);
    expect(tx).toEqual({
      txid: 'ab'.repeat(32),
      type: 'sent',
      valueZats: -300_000n,
      feeZats: 10_000n,
      height: 3_533_700,
      confirmations: 101,
      status: 'confirmed',
      memo: 'thanks for the coffee',
      timestamp: 1_793_000_000,
      pool: 'ironwood',
    });
  });

  it('gives null, never undefined, for what the engine does not know', () => {
    const [tx] = historyFrom([entry({ tx_type: 'Received', value: 1_000, block_height: undefined, timestamp: undefined, status: 'Pending', confirmations: 0 })]);
    expect(tx).toMatchObject({ type: 'received', height: null, timestamp: null, memo: null, feeZats: null, status: 'pending' });
    const [nulls] = historyFrom([entry({ fee: null, memo: null, block_height: null, timestamp: null })]);
    expect(nulls).toMatchObject({ feeZats: null, memo: null, height: null, timestamp: null });
  });

  it('reads amounts handed over as BigInt too', () => {
    const [tx] = historyFrom([entry({ value: -300_000n, fee: 10_000n, timestamp: 1_793_000_000n })]);
    expect(tx).toMatchObject({ valueZats: -300_000n, feeZats: 10_000n, timestamp: 1_793_000_000 });
  });
});
