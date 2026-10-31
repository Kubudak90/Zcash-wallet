import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EngineStoppedError, SpendRefusedError, type SpendRefusal } from '../../src/engine/types';
import { buildError, sendError } from '../../src/engine/webzjs-errors';
import { translate, type Lang } from '../../src/i18n';
import { fittingAmount, refusalText } from '../../src/lib/spendRefusal';

// What the vendored engine threw in Chromium (final review E2E-2, the production wasm with the
// form's own balance check switched off, final-e2e/logs/send-probe-2.log): plain Errors.
const MEASURED = {
  // pczt_create to u1… (the exact text of the review's finding).
  create:
    'An generic error occurred: Failed to propose the transfer (possibly insufficient balance): InsufficientFunds { available: Zatoshis(0), required: Zatoshis(50010000) }',
  // pczt_create to a TEX address of 0.001 ZEC: ZIP 317 asks 20,000 there, not the typical 10,000.
  tex: 'An generic error occurred: Failed to propose the transfer (possibly insufficient balance): InsufficientFunds { available: Zatoshis(0), required: Zatoshis(120000) }',
  shield:
    'An generic error occurred: Error when shielding: Change(InsufficientFunds { available: Zatoshis(0), required: Zatoshis(10000) })',
  // 21M ZEC: not a balance question, so no line of Celari's own.
  overflow:
    'An generic error occurred: Failed to propose the transfer (possibly insufficient balance): Change(StrategyError(Balance(Overflow)))',
};

// The send refusals as webzjs-wallet's From<Error> for JsValue builds them (round 6; MEASURED in
// Chromium by the engine round's smoke test for the last two): message, `code` and numbers.
const refusal = (message: string, props: Record<string, unknown>) => Object.assign(new Error(message), props);
const UPGRADE_PENDING = refusal(
  "UpgradePending: Network upgrade at height 3543405 in 4 blocks: no transaction is built or sent from 10 blocks before an upgrade until the upgrade's first block is mined, so that none is made for a consensus branch (0x37a5165b) it could then never be mined in. Try again after the upgrade.",
  { code: 'UpgradePending', activation_height: 3_543_405, blocks_left: 4, branch: 0x37a5165b },
);
const WRONG_BRANCH = refusal(
  'PcztWrongBranch: Refusing to send: the transaction was built for consensus branch 0x77190ad9, but the next block (3534578) is in branch 0x37a5165b (a network upgrade activated). Create the transaction again.',
  { code: 'PcztWrongBranch', pczt_branch: 0x77190ad9, network_branch: 0x37a5165b, next_height: 3_534_578 },
);
const EXPIRED = refusal(
  'PcztExpired: Refusing to send: the transaction expires at height 3000000 and the network is at 3534577, too late for it to be mined. Create the transaction again.',
  { code: 'PcztExpired', expiry_height: 3_000_000, network_tip: 3_534_577 },
);

const refusalOf = (e: unknown): SpendRefusal => {
  expect(e).toBeInstanceOf(SpendRefusedError);
  return (e as SpendRefusedError).refusal;
};

describe('buildError (pczt_create, pczt_shield)', () => {
  it('reads InsufficientFunds as the amounts in zatoshis, fee included', () => {
    const cause = new Error(MEASURED.create);
    const e = buildError(cause);
    expect(refusalOf(e)).toEqual({ reason: 'insufficientFunds', availableZats: 0n, requiredZats: 50_010_000n });
    expect((e as Error).cause).toBe(cause);
    expect(refusalOf(buildError(new Error(MEASURED.tex)))).toMatchObject({ requiredZats: 120_000n });
    expect(refusalOf(buildError(new Error(MEASURED.shield)))).toEqual({
      reason: 'insufficientFunds',
      availableZats: 0n,
      requiredZats: 10_000n,
    });
  });

  it('reads UpgradePending by its code and numbers, and by its text alone', () => {
    const upgrade = { reason: 'upgradePending', activationHeight: 3_543_405, blocksLeft: 4, upgrade: 'NU7' };
    expect(refusalOf(buildError(UPGRADE_PENDING))).toEqual(upgrade);
    // Stringified on the way (e.g. through a worker): the message keeps the code and the numbers.
    expect(refusalOf(buildError(new Error(UPGRADE_PENDING.message)))).toEqual(upgrade);
    expect(refusalOf(buildError(UPGRADE_PENDING.message))).toEqual(upgrade);
  });

  it('leaves every other error as it is', () => {
    for (const e of [
      new Error(MEASURED.overflow),
      new Error('Insufficient balance'),
      new Error('InsufficientFunds'),
      new EngineStoppedError(),
      null,
      42,
    ]) {
      expect(buildError(e)).toBe(e);
    }
  });
});

describe('sendError (pczt_send)', () => {
  it('reads the three refusals raised before anything is stored or broadcast', () => {
    expect(refusalOf(sendError(WRONG_BRANCH))).toEqual({ reason: 'wrongBranch' });
    expect(refusalOf(sendError(EXPIRED))).toEqual({ reason: 'expired' });
    expect(refusalOf(sendError(new Error(EXPIRED.message)))).toEqual({ reason: 'expired' });
    expect(refusalOf(sendError(UPGRADE_PENDING))).toMatchObject({ reason: 'upgradePending', blocksLeft: 4 });
  });

  it('never reads another error as "nothing was sent", whatever it says', () => {
    // After these the transaction may be out (stored, then a broadcast that failed).
    for (const e of [
      new Error(MEASURED.create),
      new Error('Error: transport error'),
      new Error('Failed to send transaction: code=-26 PcztExpired'),
      new EngineStoppedError(),
    ]) {
      expect(sendError(e)).toBe(e);
    }
  });
});

describe('refusalText', () => {
  const text = (r: SpendRefusal, lang: Lang) => refusalText(r, (key, vars) => translate(lang, key, vars), lang);

  it('says what the payment needs and what is spendable, in ZEC (E2E-2)', () => {
    const r = refusalOf(buildError(new Error(MEASURED.create)));
    expect(text(r, 'en')).toBe(
      'Nothing was sent: the spendable balance does not cover this payment. It needs 0.5001 ZEC including the network fee; 0.00 ZEC is spendable.',
    );
    expect(text(r, 'tr')).toBe(
      'Hiçbir şey gönderilmedi: harcanabilir bakiye bu ödemeyi karşılamıyor. Gereken (ağ ücreti dahil) 0,5001 ZEC, harcanabilir 0,00 ZEC.',
    );
    const rich = { reason: 'insufficientFunds', availableZats: 123_456_789_000n, requiredZats: 123_456_799_000n } as const;
    expect(text(rich, 'tr')).toContain('Gereken (ağ ücreti dahil) 1.234,56799 ZEC, harcanabilir 1.234,56789 ZEC.');
  });

  it('says that sending pauses around an upgrade, for about 14 minutes before NU7', () => {
    // blocks_left 4: the refused transaction targeted the wallet's tip + 1 = 3,543,401, so the
    // tip is 3,543,400 and the activation block is the fifth from now (final review V2-2).
    const r = refusalOf(buildError(UPGRADE_PENDING));
    expect(text(r, 'en')).toBe(
      'Nothing was sent. Sending pauses for about 14 minutes around a network upgrade: NU7 activates at block 3,543,405, 5 blocks from now. Try again once it is active.',
    );
    expect(text(r, 'tr')).toBe(
      'Hiçbir şey gönderilmedi. Bir ağ yükseltmesi sırasında gönderim yaklaşık 14 dakika duraklar: NU7 3.543.405 numaralı blokta, 5 blok sonra etkinleşiyor. Etkinleşince tekrar dene.',
    );
    // Tip 3,543,403 (blocks_left 1): two blocks to go, then one (blocks_left 0: the next block).
    const two = { reason: 'upgradePending', activationHeight: 3_543_405, blocksLeft: 1, upgrade: 'NU7' } as const;
    expect(text(two, 'en')).toContain('NU7 activates at block 3,543,405, 2 blocks from now.');
    expect(text(two, 'tr')).toContain('NU7 3.543.405 numaralı blokta, 2 blok sonra etkinleşiyor.');
    const next = { reason: 'upgradePending', activationHeight: 3_543_405, blocksLeft: 0, upgrade: 'NU7' } as const;
    expect(text(next, 'en')).toContain('NU7 activates with the next block (3,543,405)');
    // An upgrade after NU7: 25 s blocks.
    const later = { reason: 'upgradePending', activationHeight: 3_700_000, blocksLeft: 6, upgrade: null } as const;
    expect(text(later, 'en')).toContain('about 5 minutes around a network upgrade: the upgrade activates at block 3,700,000');
    expect(text({ ...later, activationHeight: null, blocksLeft: null }, 'tr')).toBe(
      'Hiçbir şey gönderilmedi. Bir ağ yükseltmesi sırasında gönderim yaklaşık 14 dakika duraklar. Birkaç dakika sonra tekrar dene.',
    );
  });

  it('says that nothing was sent after a refusal in pczt_send, never that it may be out', () => {
    for (const lang of ['en', 'tr'] as const) {
      for (const e of [WRONG_BRANCH, EXPIRED]) {
        const line = text(refusalOf(sendError(e)), lang);
        expect(line).toMatch(lang === 'en' ? /^Nothing was sent: / : /^Hiçbir şey gönderilmedi: /);
        expect(line).not.toMatch(/may have reached|ulaşmış olabilir/);
      }
    }
  });
});

// The matchers depend on the engine's wording; it ships in this repository (patches/webzjs/0004,
// docs/engine-port.md Decision 23), so a change there fails here first.
describe('the engine source still says what buildError and sendError match', () => {
  const patch = readFileSync(new URL('../../patches/webzjs/0004-ironwood-nu7.patch', import.meta.url), 'utf8');

  it('starts each refusal with its code and the numbers buildError reads from the text', () => {
    expect(patch).toContain('#[error("UpgradePending: Network upgrade at height {activation_height} in {blocks_left} blocks:');
    expect(patch).toContain('#[error("PcztWrongBranch: Refusing to send:');
    expect(patch).toContain('#[error("PcztExpired: Refusing to send:');
    expect(patch).toMatch(/Error::UpgradePending \{ \.\. \} => Some\("UpgradePending"\)/);
    expect(patch).toMatch(/Error::PcztWrongBranch \{ \.\. \} => Some\("PcztWrongBranch"\)/);
    expect(patch).toMatch(/Error::PcztExpired \{ \.\. \} => Some\("PcztExpired"\)/);
  });

  it("puts the proposal's error, InsufficientFunds included, into the generic error in Debug form", () => {
    expect(patch).toContain('Error::Generic(format!("Failed to propose the transfer (possibly insufficient balance): {e:?}"))');
    expect(patch).toContain('#[error("An generic error occurred: {0}")]');
  });
});

describe('fittingAmount (review round 7, SPEND-3 and ES-4)', () => {
  const funds = (availableZats: bigint, requiredZats: bigint): SpendRefusal => ({
    reason: 'insufficientFunds',
    availableZats,
    requiredZats,
  });

  it('offers the spendable balance less the fee the engine asked for', () => {
    // Measured natively: 4 Ironwood notes after a send with split change; Max (available - 10,000)
    // is refused with required 399,985,000, and available - 20,000 builds.
    expect(fittingAmount(funds(399_975_000n, 399_985_000n), 399_965_000n)).toBe(399_955_000n);
    // One 1 ZEC Orchard note: Max needs 20,000 (2 + 2 actions).
    expect(fittingAmount(funds(100_000_000n, 100_010_000n), 99_990_000n)).toBe(99_980_000n);
  });

  it('offers nothing that is not below the payment, nor for another refusal', () => {
    expect(fittingAmount(funds(10_000n, 1_000_000n), 500_000n)).toBeNull();
    expect(fittingAmount(funds(1_000_000n, 900_000n), 890_000n)).toBeNull();
    expect(fittingAmount({ reason: 'expired' }, 1n)).toBeNull();
  });
});
