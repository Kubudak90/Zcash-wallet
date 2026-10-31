import { describe, expect, it } from 'vitest';

import { historyFrom, type RawHistoryEntry } from '../../src/engine/webzjs-history';
import { resendable } from '../../src/lib/resend';

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

// Review round 8, F-02: the rows the controller sends again, from rows in the shapes the engine's
// classify() gives (patches/webzjs/0004-ironwood-nu7.patch): a payment's value is below 0, a
// shielding's or a crossing between the wallet's own pools is what arrived, above 0.
describe('resendable', () => {
  const pending = { status: 'Pending', block_height: undefined, confirmations: 0, timestamp: undefined };
  const rows = historyFrom([
    entry({ ...pending, txid: '01'.repeat(32), tx_type: 'Sent', value: -10_000_000, fee: 10_000 }),
    // 50,000,000 transparent zats shielded, all of it back in the wallet but the fee.
    entry({ ...pending, txid: '02'.repeat(32), tx_type: 'Shielded', value: 49_990_000, fee: 10_000, pool: 'mixed' }),
    // A ZIP 318 canonical crossing: Orchard notes into the wallet's own Ironwood address.
    entry({ ...pending, txid: '03'.repeat(32), tx_type: 'Shielded', value: 20_000_000, fee: 15_000, pool: 'mixed' }),
    // Paid to this wallet and not mined yet: someone else's to send.
    entry({ ...pending, txid: '04'.repeat(32), tx_type: 'Received', value: 5_000_000 }),
    entry({ txid: '05'.repeat(32), tx_type: 'Sent', value: -1_000 }),
    entry({ ...pending, txid: '06'.repeat(32), tx_type: 'Shielded', value: 1_000, status: 'Expired' }),
  ]);

  it('sends again every unmined transaction the wallet funded, whatever the sign of its value', () => {
    expect(resendable(rows).map((tx) => tx.txid)).toEqual(['01'.repeat(32), '02'.repeat(32), '03'.repeat(32)]);
  });
});
