// Scripted stand-in for WebZjs, used only by UI tests in dev builds
// (VITE_FAKE_ENGINE=1). It never touches the network or real keys: addresses
// are random-looking strings with valid checksums so the UI's own address
// checks accept them. Production builds do not include this file.

import { base58check, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';

import { acceptsMemo } from '../lib/address';
import type {
  Addresses,
  Balances,
  HistoryItem,
  SendStage,
  SpendAuthority,
  Summary,
  SyncProgress,
  ZcashEngine,
} from './types';
import { MEMO_MAX_BYTES, TYPICAL_FEE_ZATS } from './types';

const TIP = 3_100_000;
// Send amounts that fail at a given stage, so UI tests can reach the error views.
const FAIL_AT = new Map<bigint, SendStage>([
  [3_330_000n, 'proving'], // 0.0333 ZEC
  [6_660_000n, 'broadcasting'], // 0.0666 ZEC
]);
const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Set by UI tests (page.addInitScript) to reach behaviour WebZjs does not show today. */
interface FakeKnobs {
  /** Report scan progress mid-pass. */
  midPassProgress?: boolean;
  /**
   * Report pass counters through syncProgress() while summary() still waits
   * for the pass, like WebZjs with patches/webzjs/0001-sync-progress.patch.
   */
  passCounters?: boolean;
  /** Answer latestHeight() this many blocks above where sync() stops, like one lightwalletd server ahead of another. */
  tipAhead?: number;
  /** Keep a pass running until this is cleared, to look at the UI mid-pass. */
  holdPass?: boolean;
  /** Blocks mined since the wallet last synced: the tip and where sync() stops both move up. */
  chainGrowth?: number;
  /** Fail every pass before it learns the tip, like a server that drops the stream; latestHeight() still answers. */
  failPass?: boolean;
  /** Keep a spend at this stage until this is cleared, to look at the UI mid-spend. */
  holdStage?: SendStage;
}
const knobs = (): FakeKnobs => (globalThis as { __fakeEngine?: FakeKnobs }).__fakeEngine ?? {};
const chainTip = () => TIP + (knobs().chainGrowth ?? 0);

interface FakeAccount {
  id: number;
  kind: 'seed' | 'view';
  keyHash: string;
  birthday: number;
  /** Chain tip as the account's database knows it; set by the first sync. */
  tip: number;
  scanned: number;
  funded: boolean;
  balances: Record<keyof Balances, string>;
  history: (Omit<HistoryItem, 'valueZats' | 'feeZats'> & { valueZats: string; feeZats: string | null })[];
}

const hash = (s: string) => sha256(encoder.encode(s));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function fakeUnified(seed: string, hrp = 'u'): string {
  const bytes = new Uint8Array([...hash(seed + hrp), ...hash(seed + hrp + '2'), ...hash(seed + hrp + '3')]);
  return bech32m.encode(hrp, bech32m.toWords(bytes), false);
}

function fakeTransparent(seed: string): string {
  return base58check(sha256).encode(new Uint8Array([0x1c, 0xb8, ...hash(seed + 't').slice(0, 20)]));
}

export class FakeEngine implements ZcashEngine {
  private accounts: FakeAccount[] = [];
  private opened = false;
  /** The running pass; summary() waits for it, as WebZjs waits for its database lock. */
  private pass: Promise<void> | null = null;
  /** Counters of the running (or last) pass, for syncProgress(). */
  private counters: SyncProgress = { running: false, visited: 0, scanned: 0 };

  async init(): Promise<void> {
    await sleep(50);
  }

  async latestHeight(): Promise<number> {
    return chainTip() + (knobs().tipAhead ?? 0);
  }

  async detectBirthday(): Promise<number | null> {
    return null;
  }

  async isValidViewingKey(ufvk: string): Promise<boolean> {
    const decoded = bech32m.decodeUnsafe(ufvk.trim(), false);
    return decoded?.prefix === 'uview';
  }

  async viewingKey(phrase: string): Promise<string> {
    return fakeUnified(phrase, 'uview');
  }

  async open(db: Uint8Array | null): Promise<number | null> {
    this.accounts = db ? (JSON.parse(new TextDecoder().decode(db)) as FakeAccount[]) : [];
    this.opened = true;
    return this.accounts[0]?.id ?? null;
  }

  private add(kind: FakeAccount['kind'], key: string, birthday: number): number {
    if (!this.opened) throw new Error('wallet not open');
    const id = this.accounts.length;
    this.accounts.push({
      id,
      kind,
      keyHash: hex(hash(kind === 'seed' ? key : fakeKeyFromUfvk(key))),
      birthday,
      // Like WebZjs before its first pass: only the birthday is known.
      tip: birthday - 1,
      scanned: birthday - 1,
      funded: false,
      balances: { orchard: '0', sapling: '0', transparent: '0', pending: '0' },
      history: [],
    });
    return id;
  }

  async addSeedAccount(phrase: string, birthday: number): Promise<number> {
    return this.add('seed', phrase, birthday);
  }

  async addViewAccount(ufvk: string, birthday: number): Promise<number> {
    return this.add('view', ufvk, birthday);
  }

  async exportDb(): Promise<Uint8Array> {
    return encoder.encode(JSON.stringify(this.accounts));
  }

  async sync(): Promise<void> {
    if (knobs().failPass) {
      await sleep(100);
      throw new Error('fake pass failure');
    }
    const pass = this.runPass();
    // WebZjs holds its database lock for the whole pass, so nothing can watch it move.
    if (!knobs().midPassProgress) this.pass = pass;
    try {
      await pass;
    } finally {
      this.pass = null;
    }
  }

  async syncProgress(): Promise<SyncProgress | null> {
    return knobs().passCounters ? { ...this.counters } : null;
  }

  private async runPass(): Promise<void> {
    const start = new Map(this.accounts.map((a) => [a, a.scanned]));
    const tip = chainTip();
    const behind = Math.max(0, ...this.accounts.map((a) => tip - a.scanned));
    this.counters = { running: true, visited: 0, scanned: 0 };
    for (const a of this.accounts) a.tip = tip;
    while (knobs().holdPass) await sleep(50);
    for (const step of knobs().midPassProgress || knobs().passCounters ? [0.25, 0.5, 0.75, 1] : [1]) {
      // Long enough for UI tests to see a restore scan; quick near the tip.
      await sleep(behind > 1000 ? 2500 : 250);
      for (const [a, from] of start) a.scanned = Math.round(from + (tip - from) * step);
      // Like WebZjs, the scanner reaches a batch before that batch is committed.
      this.counters = { running: true, visited: Math.round(behind * step), scanned: Math.round(behind * (step - 0.25)) };
    }
    for (const a of this.accounts) {
      if (a.funded) continue;
      a.funded = true;
      a.balances.orchard = '125000000';
      a.balances.transparent = '50000000';
      a.history.unshift({
        txid: hex(hash(a.keyHash + 'rx')),
        type: 'received',
        valueZats: '125000000',
        feeZats: null,
        height: TIP - 120,
        confirmations: 121,
        status: 'confirmed',
        memo: 'Hoş geldin!',
        timestamp: Math.floor(Date.now() / 1000) - 9000,
        pool: 'orchard',
      });
    }
    this.counters = { ...this.counters, running: false };
  }

  private account(id: number): FakeAccount {
    const a = this.accounts.find((x) => x.id === id);
    if (!a) throw new Error(`account ${id} not found`);
    return a;
  }

  async summary(id: number): Promise<Summary | null> {
    await this.pass;
    const a = this.accounts.find((x) => x.id === id);
    if (!a) return null;
    return {
      tipHeight: a.tip,
      scannedHeight: a.scanned,
      balances: {
        orchard: BigInt(a.balances.orchard),
        sapling: BigInt(a.balances.sapling),
        transparent: BigInt(a.balances.transparent),
        pending: BigInt(a.balances.pending),
      },
    };
  }

  async addresses(id: number): Promise<Addresses> {
    const a = this.account(id);
    return { unified: fakeUnified(a.keyHash), transparent: fakeTransparent(a.keyHash) };
  }

  async history(id: number, limit: number): Promise<HistoryItem[]> {
    return this.account(id)
      .history.slice(0, limit)
      .map((h) => ({ ...h, valueZats: BigInt(h.valueZats), feeZats: h.feeZats == null ? null : BigInt(h.feeZats) }));
  }

  private authorize(a: FakeAccount, auth: SpendAuthority) {
    if (a.kind !== 'seed') throw new Error('view-only account cannot spend');
    if (hex(hash(auth.phrase)) !== a.keyHash) throw new Error('seed does not match account');
  }

  /**
   * Walks the spend stages. `check` runs while building, where WebZjs rejects
   * a bad request. Like WebZjs's pczt_send, `store` records the transaction
   * just before it is broadcast, so a failed broadcast leaves it in the wallet.
   */
  private async stages(
    auth: SpendAuthority,
    { store, check, failAt }: { store: () => void; check?: () => void; failAt?: SendStage },
  ) {
    for (const stage of ['building', 'signing', 'proving', 'broadcasting'] as const) {
      auth.onStage?.(stage);
      while (knobs().holdStage === stage) await sleep(50);
      if (stage === 'building') check?.();
      if (stage === 'broadcasting') store();
      await sleep(stage === 'proving' ? 600 : 150);
      if (stage === failAt) throw new Error(`fake ${stage} failure`);
    }
  }

  async send(id: number, to: string, zats: bigint, auth: SpendAuthority, memo?: string): Promise<void> {
    const a = this.account(id);
    this.authorize(a, auth);
    const spendable = BigInt(a.balances.orchard);
    if (zats + TYPICAL_FEE_ZATS > spendable) throw new Error('Insufficient balance');
    // The errors WebZjs (patches/webzjs/0002-memo.patch) and the adapter give.
    const check = () => {
      if (!memo) return;
      if (memo.includes('\u0000')) throw new Error('a memo cannot contain NUL characters');
      const length = encoder.encode(memo).length;
      if (length > MEMO_MAX_BYTES) throw new Error(`Memo is ${length} bytes long; a memo holds at most 512 bytes of UTF-8 text`);
      if (!acceptsMemo(to)) {
        throw new Error(
          'Attempted to create a transaction with a memo to an unsupported recipient. Only shielded addresses are supported.',
        );
      }
    };
    const store = () => {
      a.balances.orchard = (spendable - zats - TYPICAL_FEE_ZATS).toString();
      a.history.unshift({
        txid: hex(hash(a.keyHash + to + zats + Date.now())),
        type: 'sent',
        valueZats: (-(zats + TYPICAL_FEE_ZATS)).toString(),
        feeZats: TYPICAL_FEE_ZATS.toString(),
        height: null,
        confirmations: 0,
        status: 'pending',
        // WebZjs's history reads the memo back from the sent note.
        memo: memo || null,
        timestamp: null,
        pool: 'orchard',
      });
    };
    await this.stages(auth, { store, check, failAt: FAIL_AT.get(zats) });
  }

  async shield(id: number, auth: SpendAuthority): Promise<void> {
    const a = this.account(id);
    this.authorize(a, auth);
    const transparent = BigInt(a.balances.transparent);
    const store = () => {
      a.balances.transparent = '0';
      a.balances.pending = (transparent - TYPICAL_FEE_ZATS).toString();
      a.history.unshift({
        txid: hex(hash(a.keyHash + 'shield' + Date.now())),
        type: 'shielded',
        valueZats: (-TYPICAL_FEE_ZATS).toString(),
        feeZats: TYPICAL_FEE_ZATS.toString(),
        height: null,
        confirmations: 0,
        status: 'pending',
        memo: null,
        timestamp: null,
        pool: 'mixed',
      });
    };
    await this.stages(auth, { store });
  }
}

function fakeKeyFromUfvk(ufvk: string): string {
  return `ufvk:${ufvk.trim()}`;
}
