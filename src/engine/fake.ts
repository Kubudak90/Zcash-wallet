// Scripted stand-in for WebZjs, used only by UI tests in dev builds
// (VITE_FAKE_ENGINE=1). It never touches the network or real keys: addresses
// are random-looking strings with valid checksums so the UI's own address
// checks accept them. Production builds do not include this file.

import { base58check, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';

import type {
  Addresses,
  Balances,
  HistoryItem,
  SpendAuthority,
  Summary,
  ZcashEngine,
} from './types';
import { TYPICAL_FEE_ZATS } from './types';

const TIP = 3_100_000;
const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FakeAccount {
  id: number;
  kind: 'seed' | 'view';
  keyHash: string;
  birthday: number;
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

  async init(): Promise<void> {
    await sleep(50);
  }

  async latestHeight(): Promise<number> {
    return TIP;
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
      scanned: birthday,
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
    for (const step of [0.25, 0.5, 0.75, 1]) {
      await sleep(250);
      for (const a of this.accounts) a.scanned = Math.round(a.birthday + (TIP - a.birthday) * step);
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
  }

  private account(id: number): FakeAccount {
    const a = this.accounts.find((x) => x.id === id);
    if (!a) throw new Error(`account ${id} not found`);
    return a;
  }

  async summary(id: number): Promise<Summary | null> {
    const a = this.accounts.find((x) => x.id === id);
    if (!a) return null;
    return {
      tipHeight: TIP,
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

  private async stages(auth: SpendAuthority) {
    for (const stage of ['building', 'signing', 'proving', 'broadcasting'] as const) {
      auth.onStage?.(stage);
      await sleep(stage === 'proving' ? 600 : 150);
    }
  }

  async send(id: number, to: string, zats: bigint, auth: SpendAuthority): Promise<void> {
    const a = this.account(id);
    this.authorize(a, auth);
    const spendable = BigInt(a.balances.orchard);
    if (zats + TYPICAL_FEE_ZATS > spendable) throw new Error('Insufficient balance');
    await this.stages(auth);
    a.balances.orchard = (spendable - zats - TYPICAL_FEE_ZATS).toString();
    a.history.unshift({
      txid: hex(hash(a.keyHash + to + zats + Date.now())),
      type: 'sent',
      valueZats: (-(zats + TYPICAL_FEE_ZATS)).toString(),
      feeZats: TYPICAL_FEE_ZATS.toString(),
      height: null,
      confirmations: 0,
      status: 'pending',
      memo: null,
      timestamp: null,
      pool: 'orchard',
    });
  }

  async shield(id: number, auth: SpendAuthority): Promise<void> {
    const a = this.account(id);
    this.authorize(a, auth);
    const transparent = BigInt(a.balances.transparent);
    await this.stages(auth);
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
  }
}

function fakeKeyFromUfvk(ufvk: string): string {
  return `ufvk:${ufvk.trim()}`;
}
