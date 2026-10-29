// Scripted stand-in for WebZjs, used only by UI tests in dev builds
// (VITE_FAKE_ENGINE=1). It never touches the network or real keys: addresses
// are random-looking strings with valid checksums so the UI's own address
// checks accept them. Production builds do not include this file.

import { base58check, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';

import { acceptsMemo, checkAddress } from '../lib/address';
import type {
  Addresses,
  Balances,
  HistoryItem,
  NetworkStatus,
  SendStage,
  SpendAuthority,
  Summary,
  SyncProgress,
  ZcashEngine,
} from './types';
import { MEMO_MAX_BYTES, NewerDatabaseFormatError, OldDatabaseFormatError, TYPICAL_FEE_ZATS } from './types';

// A mainnet height under NU6.3 (Ironwood) rules, before NU7 (3,543,405).
const TIP = 3_533_800;
/** NU6.3 (Ironwood) activation: from it on nothing new enters Orchard. */
const NU6_3_ACTIVATION = 3_428_143;
// Send amounts that fail at a given stage, so UI tests can reach the error views.
const FAIL_AT = new Map<bigint, SendStage>([
  [3_330_000n, 'proving'], // 0.0333 ZEC
  [6_660_000n, 'broadcasting'], // 0.0666 ZEC
]);
const encoder = new TextEncoder();
/** Tags in front of a fake database written by another engine version (FakeKnobs.oldDbFormat, newerDbFormat). */
const OLD_FORMAT = 'old-engine:';
const NEWER_FORMAT = 'newer-engine:';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Set by UI tests (page.addInitScript) to reach behaviour the default fake does not show.
 * By default the fake behaves like the ported WebZjs Celari ships (zcash_client_backend 0.25,
 * patches/webzjs/0003-0004): it sees Ironwood, supports the network's NU6.3 rules, and has no
 * summary before a pass has set the chain tip. `ironwood: false`, `networkOutdated`,
 * `localOutdated` and `summaryBeforePass` bring back the engine that stopped at NU6.1.
 */
export interface FakeKnobs {
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
  /** Keep a send or shield at its proving stage until this is cleared. */
  holdSpend?: boolean;
  /** The network runs NU6.3 (Ironwood), which the engine does not support, like the WebZjs that stopped at NU6.1. */
  networkOutdated?: boolean;
  /** The server reports NU5 rules, older than the network's, like a node that missed upgrades. */
  networkServerBehind?: boolean;
  /** networkStatus() reports a tip this many blocks under latestHeight(), like a lagging server. */
  networkLag?: number;
  /** networkStatus() fails, like a server that does not answer GetLightdInfo. */
  networkUnreachable?: boolean;
  /** localNetworkStatus() says the engine lacks NU6.3 without asking, as the WebZjs that stopped at NU6.1 did. */
  localOutdated?: boolean;
  /** Whether the engine sees the NU6.3 Ironwood pool; default true (the ported WebZjs). false: the WebZjs that stopped at NU6.1. */
  ironwood?: boolean;
  /**
   * summary() answers for an account before any pass has run (scanned to birthday - 1), as the
   * WebZjs that stopped at NU6.1 did. By default, like the ported WebZjs (zcash_client_sqlite
   * rules), it answers null until a pass has set the chain tip.
   */
  summaryBeforePass?: boolean;
  /** Set by the fake: how many times networkStatus() has answered, so tests can wait for the next check. */
  networkChecks?: number;
  /** Keep networkStatus() from answering until this is cleared. */
  holdNetworkCheck?: boolean;
  /** An upgrade the server announces, as networkStatus() reports it. */
  upcomingUpgrade?: NetworkStatus['upcoming'];
  /**
   * exportDb() writes the format of the engine before the port, which a fake without this
   * knob refuses with OldDatabaseFormatError, as the ported WebZjs refuses the old protobuf.
   */
  oldDbFormat?: boolean;
  /** exportDb() writes a format a newer Celari would; a fake without this knob refuses it with NewerDatabaseFormatError. */
  newerDbFormat?: boolean;
  /** open() of a stored database throws this, like a corrupted database or a wasm trap while decoding it. */
  openFails?: string;
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

/**
 * The pool WebZjs reports for a payment: the recipient's pool and that of the
 * change, 'mixed' when they differ. WebZjs pays a unified address's Orchard
 * receiver; the ported engine pays it through Ironwood and puts the change
 * there too (no new value enters Orchard since NU6.3), the old one used Orchard.
 */
function sentPool(to: string, change: bigint, ironwood: boolean): string {
  const shielded = ironwood ? 'ironwood' : 'orchard';
  const check = checkAddress(to);
  const kind = check.ok ? check.kind : 'transparent';
  const recipient = kind === 'sapling' ? 'sapling' : kind === 'unified' && acceptsMemo(to) ? shielded : 'transparent';
  return change > 0n && recipient !== shielded ? 'mixed' : recipient;
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

  get ironwood(): boolean {
    return knobs().ironwood ?? true;
  }

  localNetworkStatus(): NetworkStatus | null {
    if (!knobs().localOutdated) return null;
    return { branchId: '37a5165b', height: chainTip(), supported: false, behind: 'engine', lacks: ['NU6.2', 'NU6.3'] };
  }

  async networkStatus(): Promise<NetworkStatus> {
    await sleep(20);
    while (knobs().holdNetworkCheck) await sleep(50);
    const k = knobs();
    k.networkChecks = (k.networkChecks ?? 0) + 1;
    if (k.networkUnreachable) throw new Error('fake GetLightdInfo failure');
    // NU6.3 (Ironwood) rules at the fake tip, which the ported engine supports; an engine that
    // stopped at NU6.1 lacks NU6.2 and NU6.3 (networkOutdated).
    const height = chainTip() + (k.tipAhead ?? 0) - (k.networkLag ?? 0);
    const status: NetworkStatus = k.networkOutdated
      ? { branchId: '37a5165b', height, supported: false, behind: 'engine', lacks: ['NU6.2', 'NU6.3'] }
      : k.networkServerBehind
        ? { branchId: 'c2d6d0b4', height, supported: false, behind: 'server' }
        : { branchId: '37a5165b', height, supported: true };
    if (k.upcomingUpgrade) status.upcoming = k.upcomingUpgrade;
    return status;
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
    const k = knobs();
    let text = db ? new TextDecoder().decode(db) : '[]';
    if (db && k.openFails) throw new Error(k.openFails);
    for (const [tag, ours, Refused] of [
      [OLD_FORMAT, k.oldDbFormat, OldDatabaseFormatError],
      [NEWER_FORMAT, k.newerDbFormat, NewerDatabaseFormatError],
    ] as const) {
      if (!text.startsWith(tag)) continue;
      if (!ours) throw new Refused({ cause: new Error(`fake: a database in the format "${tag}"`) });
      text = text.slice(tag.length);
    }
    this.accounts = JSON.parse(text) as FakeAccount[];
    // Fake databases saved before the Ironwood balance existed.
    for (const a of this.accounts) a.balances.ironwood ??= '0';
    this.opened = true;
    // Like the WebZjs adapter, which reads the account from the summary: none before a pass
    // has set the chain tip (summaryBeforePass: the engine before the port had one).
    const first = this.accounts[0];
    if (!first) return null;
    return !k.summaryBeforePass && first.tip < first.birthday ? null : first.id;
  }

  private add(kind: FakeAccount['kind'], key: string, birthday: number): number {
    if (!this.opened) throw new Error('wallet not open');
    const keyHash = hex(hash(kind === 'seed' ? key : fakeKeyFromUfvk(key)));
    // The error the ported WebZjs gives for the same key added twice (logs/round4/errors.json).
    const twin = this.accounts.find((a) => a.keyHash === keyHash);
    if (twin) throw new Error(`Memory client error: Other error: the key collides with existing account AccountId(${twin.id})`);
    const id = this.accounts.length;
    this.accounts.push({
      id,
      kind,
      keyHash,
      birthday,
      // Like WebZjs before its first pass: only the birthday is known.
      tip: birthday - 1,
      scanned: birthday - 1,
      funded: false,
      balances: { orchard: '0', sapling: '0', ironwood: '0', transparent: '0', pending: '0' },
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
    const k = knobs();
    const tag = k.oldDbFormat ? OLD_FORMAT : k.newerDbFormat ? NEWER_FORMAT : '';
    return encoder.encode(tag + JSON.stringify(this.accounts));
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
      // A wallet born before NU6.3 holds an Orchard note from then; since NU6.3 shielded
      // payments land in Ironwood, which an engine that stopped at NU6.1 cannot see (so,
      // modelling the funds it does see, that engine gets them in Orchard).
      const pool = this.ironwood && a.birthday >= NU6_3_ACTIVATION ? 'ironwood' : 'orchard';
      const height = pool === 'orchard' && this.ironwood ? NU6_3_ACTIVATION - 1000 : TIP - 120;
      a.balances[pool] = '125000000';
      a.balances.transparent = '50000000';
      a.history.unshift({
        txid: hex(hash(a.keyHash + 'rx')),
        type: 'received',
        valueZats: '125000000',
        feeZats: null,
        height,
        confirmations: TIP - height + 1,
        status: 'confirmed',
        memo: 'Hoş geldin!',
        timestamp: Math.floor(Date.now() / 1000) - 9000,
        pool,
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
    if (!knobs().summaryBeforePass && a.tip < a.birthday) return null;
    return {
      tipHeight: a.tip,
      scannedHeight: a.scanned,
      balances: {
        orchard: BigInt(a.balances.orchard),
        sapling: BigInt(a.balances.sapling),
        ironwood: BigInt(a.balances.ironwood),
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
      if (stage === 'broadcasting') await auth.beforeBroadcast();
      auth.onStage?.(stage);
      while (knobs().holdStage === stage) await sleep(50);
      if (stage === 'building') check?.();
      if (stage === 'broadcasting') store();
      await sleep(stage === 'proving' ? 600 : 150);
      while (stage === 'proving' && knobs().holdSpend) await sleep(50);
      if (stage === failAt) throw new Error(`fake ${stage} failure`);
    }
  }

  async send(id: number, to: string, zats: bigint, auth: SpendAuthority, memo?: string): Promise<void> {
    const a = this.account(id);
    this.authorize(a, auth);
    const ironwood = this.ironwood;
    // The ported engine spends Orchard and Ironwood notes alike; the old one saw Orchard only.
    const spendable = BigInt(a.balances.orchard) + (ironwood ? BigInt(a.balances.ironwood) : 0n);
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
      const change = spendable - zats - TYPICAL_FEE_ZATS;
      a.balances.orchard = ironwood ? '0' : change.toString();
      if (ironwood) a.balances.ironwood = change.toString();
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
        pool: sentPool(to, change, ironwood),
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
        // The shielded note is the wallet's only output; WebZjs does not count the transparent
        // inputs. The ported engine shields into Ironwood (nothing new enters Orchard).
        pool: this.ironwood ? 'ironwood' : 'orchard',
      });
    };
    await this.stages(auth, { store });
  }
}

function fakeKeyFromUfvk(ufvk: string): string {
  return `ufvk:${ufvk.trim()}`;
}
