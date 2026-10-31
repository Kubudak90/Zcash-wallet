// Scripted stand-in for WebZjs, used only by UI tests in dev builds
// (VITE_FAKE_ENGINE=1). It never touches the network or real keys: addresses
// are random-looking strings with valid checksums so the UI's own address
// checks accept them. Production builds do not include this file.

import { base58check, bech32m } from '@scure/base';
import { blake2b } from '@noble/hashes/blake2';
import { sha256 } from '@noble/hashes/sha256';

import { acceptsMemo, checkAddress } from '../lib/address';
import { CrashWatch } from './webzjs-crash';
import { buildError, sendError } from './webzjs-errors';
import type {
  Addresses,
  Balances,
  EngineStoppedError,
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

/** The JS Error the ported WebZjs throws for a send refusal (webzjs-wallet error.rs, round 6). */
function engineRefusal(code: NonNullable<FakeKnobs['refuseSpend']>, tip: number): Error {
  const [message, numbers]: [string, Record<string, number>] =
    code === 'UpgradePending'
      ? [
          `UpgradePending: Network upgrade at height 3543405 in ${3_543_405 - tip - 1} blocks: no transaction is built or sent from 10 blocks before an upgrade until the upgrade's first block is mined, so that none is made for a consensus branch (0x37a5165b) it could then never be mined in. Try again after the upgrade.`,
          { activation_height: 3_543_405, blocks_left: 3_543_405 - tip - 1, branch: 0x37a5165b },
        ]
      : code === 'PcztWrongBranch'
        ? [
            `PcztWrongBranch: Refusing to send: the transaction was built for consensus branch 0x37a5165b, but the next block (${tip + 1}) is in branch 0x77190ad9 (a network upgrade activated). Create the transaction again.`,
            { pczt_branch: 0x37a5165b, network_branch: 0x77190ad9, next_height: tip + 1 },
          ]
        : [
            `PcztExpired: Refusing to send: the transaction expires at height ${tip + 2} and the network is at ${tip}, too late for it to be mined. Create the transaction again.`,
            { expiry_height: tip + 2, network_tip: tip },
          ];
  return Object.assign(new Error(message), { code, ...numbers });
}

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
  /**
   * Payments of 0.1 ZEC to these addresses arrive in the next pass. Each is the account's if it
   * is its full unified address, its transparent one or any shielded address it handed out
   * (they all keep working); others are someone else's and are ignored.
   */
  incoming?: string[];
  /**
   * The engine's WebAssembly traps during the next pass, as the WebZjs build before round 5 did
   * once a spam-era batch filled its memory: the pass never ends on its own, and the trap reaches
   * the page as an uncaught `RuntimeError: unreachable` from a worker (an `error` event), which the
   * fake notices the same way WebzjsEngine does (./webzjs-crash.ts).
   */
  trapDuringPass?: boolean;
  /**
   * Passes like the ported WebZjs's during a restore (round 6, docs/engine-port.md Decisions 8
   * and 21): the scan goes top-down, newest blocks first, so the fully scanned height stays at
   * the birthday - 1 until the last batch; a pass ends at its time budget, after `passBlocks`
   * blocks in batches of `batchBlocks` (default a quarter of that), with `endedEarly` while
   * blocks are left; and syncProgress() reports the pass counters and the scan queue (what is
   * left, also between passes and right after a reload). Set by the fake: `passesRun`.
   */
  budgetedPasses?: { passBlocks: number; batchBlocks?: number; passesRun?: number };
  /**
   * The fee the engine really asks for a send, in zatoshis (default TYPICAL_FEE_ZATS, which the
   * Send form assumes). Above it, a send the form let through can still exceed the balance, as
   * a TEX payment does with the real engine (ZIP 317: 20,000); the fake then refuses it the way
   * WebZjs does (InsufficientFunds in pczt_create's text).
   */
  engineFee?: number;
  /**
   * The engine refuses the next spends with this code, as the ported WebZjs does around a network
   * upgrade (round 6, docs/engine-port.md Decision 23): UpgradePending while building,
   * PcztWrongBranch and PcztExpired in pczt_send, before anything is stored. The error has the
   * engine's text, `code` and numbers.
   */
  refuseSpend?: 'UpgradePending' | 'PcztWrongBranch' | 'PcztExpired';
  /** Set by the fake: the last value setHistoryEnhancement() received (undefined: never called). */
  historyEnhancement?: boolean;
  /** Set by the fake: the txids rebroadcast() was called with, in order. */
  rebroadcasts?: string[];
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
  /** Shielded-only addresses handed out by nextShieldedAddress(), oldest first. */
  shieldedAddresses?: string[];
  /** Ranges of heights still to scan, [from, to] inclusive (FakeKnobs.budgetedPasses only). */
  unscanned?: [number, number][];
  balances: Record<keyof Balances, string>;
  history: (Omit<HistoryItem, 'valueZats' | 'feeZats'> & { valueZats: string; feeZats: string | null })[];
}

const hash = (s: string) => sha256(encoder.encode(s));

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function fakeUnified(seed: string, hrp = 'u'): string {
  const bytes = new Uint8Array([...hash(seed + hrp), ...hash(seed + hrp + '2'), ...hash(seed + hrp + '3')]);
  return bech32m.encode(hrp, bech32m.toWords(bytes), false);
}

/** F4Jumble (ZIP 316), so the fake's unified addresses decode like real ones (src/lib/address.ts). */
function f4jumble(m: Uint8Array): Uint8Array {
  const tag = (name: string, i: number, j = 0) => {
    const p = new Uint8Array(16);
    p.set(encoder.encode(`UA_F4Jumble_${name}`));
    p.set([i, j & 0xff, j >> 8], 13);
    return p;
  };
  const left = Math.min(64, Math.floor(m.length / 2));
  const right = m.length - left;
  const h = (i: number, u: Uint8Array) => blake2b(u, { dkLen: left, personalization: tag('H', i) });
  const g = (i: number, u: Uint8Array) => {
    const out: number[] = [];
    for (let j = 0; out.length < right; j++) out.push(...blake2b(u, { dkLen: 64, personalization: tag('G', i, j) }));
    return out.slice(0, right);
  };
  const xor = (a: Uint8Array, b: ArrayLike<number>) => a.map((v, k) => v ^ b[k]!);
  const x = xor(m.subarray(left), g(0, m.subarray(0, left)));
  const y = xor(m.subarray(0, left), h(0, x));
  const d = xor(x, g(1, y));
  const c = xor(y, h(1, d));
  return new Uint8Array([...c, ...d]);
}

/**
 * A mainnet unified address derived from `seed`: P2PKH (0x00, 20 bytes), Sapling (0x02, 43)
 * and Orchard (0x03, 43) receivers as WebZjs gives them, in typecode order.
 */
function fakeUa(seed: string, receivers: (0x00 | 0x02 | 0x03)[]): string {
  const body = receivers.flatMap((typecode) => {
    const length = typecode === 0x00 ? 20 : 43;
    const data = [...hash(`${seed}/${typecode}`), ...hash(`${seed}/${typecode}/2`)].slice(0, length);
    return [typecode, length, ...data];
  });
  const padding = [...encoder.encode('u'), ...new Array<number>(15).fill(0)];
  return bech32m.encode('u', bech32m.toWords(f4jumble(new Uint8Array([...body, ...padding]))), false);
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
  /** FakeKnobs.budgetedPasses: the pass's `visited` when the queue was last reported, and how the last pass ended. */
  private reportedAt = 0;
  private endedEarly = false;
  /** Notices a trap (knob trapDuringPass) as WebzjsEngine does. */
  private crash = new CrashWatch(typeof window === 'undefined' ? null : window);

  async init(): Promise<void> {
    await sleep(50);
  }

  onStopped(listener: (error: EngineStoppedError) => void): void {
    this.crash.onStopped(listener);
  }

  setHistoryEnhancement(enabled: boolean): void {
    const g = globalThis as { __fakeEngine?: FakeKnobs };
    g.__fakeEngine = { ...g.__fakeEngine, historyEnhancement: enabled };
  }

  async latestHeight(): Promise<number> {
    return chainTip() + (knobs().tipAhead ?? 0);
  }

  async rebroadcast(txid: string): Promise<void> {
    this.crash.check();
    const g = globalThis as { __fakeEngine?: FakeKnobs };
    g.__fakeEngine = { ...g.__fakeEngine, rebroadcasts: [...(g.__fakeEngine?.rebroadcasts ?? []), txid] };
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
    this.crash.check();
    const k = knobs();
    const tag = k.oldDbFormat ? OLD_FORMAT : k.newerDbFormat ? NEWER_FORMAT : '';
    return encoder.encode(tag + JSON.stringify(this.accounts));
  }

  async sync(): Promise<void> {
    this.crash.check();
    if (knobs().trapDuringPass) {
      this.counters = { running: true, visited: 0, scanned: 0 };
      // The pass's worker dies: nothing settles this pass, the error event reaches the page.
      setTimeout(() => {
        window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught RuntimeError: unreachable' }));
      }, 300);
      return this.crash.guard(new Promise<void>(() => {}));
    }
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
    if (knobs().budgetedPasses) {
      // Like WebZjs's database, which reports its queue when opened and after every write.
      const a = this.accounts[0];
      const unscanned = (a?.unscanned ?? []).reduce((n, [from, to]) => n + to - from + 1, 0);
      const queue = { unscanned, walletTip: a?.tip ?? 0, visitedAtReport: this.reportedAt };
      return { ...this.counters, queue, endedEarly: this.endedEarly };
    }
    return knobs().passCounters ? { ...this.counters } : null;
  }

  /** FakeKnobs.budgetedPasses: top-down batches until the budget, newest blocks first. */
  private async runBudgetedPass(budget: NonNullable<FakeKnobs['budgetedPasses']>): Promise<void> {
    const tip = chainTip();
    const batchBlocks = Math.max(1, budget.batchBlocks ?? Math.ceil(budget.passBlocks / 4));
    this.counters = { running: true, visited: 0, scanned: 0, downloaded: 0 };
    this.reportedAt = 0;
    this.endedEarly = false;
    // The chain tip update: the blocks mined since the last pass join the queue.
    for (const a of this.accounts) {
      a.unscanned ??= [];
      if (tip > a.tip) a.unscanned.push([a.tip + 1, tip]);
      a.tip = tip;
    }
    while (knobs().holdPass) await sleep(50);
    let done = 0;
    for (;;) {
      const left = (a: FakeAccount) => (a.unscanned ?? []).reduce((n, [from, to]) => n + to - from + 1, 0);
      const most = Math.max(0, ...this.accounts.map(left));
      if (most === 0) break;
      if (done >= budget.passBlocks) {
        this.endedEarly = true;
        break;
      }
      const n = Math.min(batchBlocks, most);
      // The scanner reaches the batch (trial decryption), then the batch is committed.
      await sleep(250);
      this.counters = { ...this.counters, visited: this.counters.visited + n, downloaded: (this.counters.downloaded ?? 0) + n };
      await sleep(250);
      for (const a of this.accounts) {
        // Take the `n` highest heights still to scan.
        let take = n;
        const ranges = [...(a.unscanned ?? [])].sort((x, y) => y[1] - x[1]);
        const kept: [number, number][] = [];
        for (const [from, to] of ranges) {
          if (take === 0) {
            kept.push([from, to]);
            continue;
          }
          const size = to - from + 1;
          if (size <= take) take -= size;
          else {
            kept.push([from, to - take]);
            take = 0;
          }
        }
        a.unscanned = kept;
        // Fully scanned: up to the lowest height still to scan.
        a.scanned = kept.length ? Math.min(...kept.map(([from]) => from)) - 1 : tip;
      }
      this.counters = { ...this.counters, scanned: this.counters.scanned + n };
      this.reportedAt = this.counters.visited;
      done += n;
    }
    budget.passesRun = (budget.passesRun ?? 0) + 1;
  }

  private async runPass(): Promise<void> {
    const budget = knobs().budgetedPasses;
    if (budget) {
      await this.runBudgetedPass(budget);
      this.afterPass(chainTip());
      this.counters = { ...this.counters, running: false };
      return;
    }
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
    this.afterPass(tip);
    this.counters = { ...this.counters, running: false };
  }

  /** What every pass finds: the welcome payment of a new wallet, and the knob's incoming ones. */
  private afterPass(tip: number): void {
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
    const k = knobs();
    for (const to of k.incoming ?? []) {
      const a = this.accounts.find(
        (x) =>
          to === fakeUa(x.keyHash, [0x00, 0x02, 0x03]) ||
          to === fakeTransparent(x.keyHash) ||
          (x.shieldedAddresses ?? []).includes(to),
      );
      if (!a) continue;
      const pool = to.startsWith('t1') ? 'transparent' : this.ironwood ? 'ironwood' : 'orchard';
      a.balances[pool] = (BigInt(a.balances[pool]) + 10_000_000n).toString();
      a.history.unshift({
        txid: hex(hash(a.keyHash + 'rx' + to + Date.now())),
        type: 'received',
        valueZats: '10000000',
        feeZats: null,
        height: tip,
        confirmations: 1,
        status: 'confirmed',
        memo: null,
        timestamp: Math.floor(Date.now() / 1000),
        pool,
      });
    }
    if (k.incoming) k.incoming = [];
  }

  private account(id: number): FakeAccount {
    const a = this.accounts.find((x) => x.id === id);
    if (!a) throw new Error(`account ${id} not found`);
    return a;
  }

  async summary(id: number): Promise<Summary | null> {
    this.crash.check();
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
    this.crash.check();
    const a = this.account(id);
    return { unified: fakeUa(a.keyHash, [0x00, 0x02, 0x03]), transparent: fakeTransparent(a.keyHash) };
  }

  async nextShieldedAddress(id: number): Promise<string> {
    this.crash.check();
    // WebZjs takes the database's write lock, which a running pass holds until it ends.
    await this.pass;
    const a = this.account(id);
    a.shieldedAddresses ??= [];
    const address = fakeUa(`${a.keyHash}/shielded/${a.shieldedAddresses.length}`, [0x02, 0x03]);
    a.shieldedAddresses.push(address);
    return address;
  }

  async history(id: number, limit: number): Promise<HistoryItem[]> {
    this.crash.check();
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
      const refuse = knobs().refuseSpend;
      // Through the adapter's own mapping (./webzjs-errors.ts), as WebzjsEngine does.
      if (stage === 'building' && refuse === 'UpgradePending') throw buildError(engineRefusal(refuse, chainTip()));
      if (stage === 'building') {
        try {
          check?.();
        } catch (e) {
          throw buildError(e);
        }
      }
      // pczt_send checks the branch and the expiry before it stores the transaction.
      if (stage === 'broadcasting' && refuse && refuse !== 'UpgradePending') throw sendError(engineRefusal(refuse, chainTip()));
      if (stage === 'broadcasting') store();
      await sleep(stage === 'proving' ? 600 : 150);
      while (stage === 'proving' && knobs().holdSpend) await sleep(50);
      if (stage === failAt) throw new Error(`fake ${stage} failure`);
    }
  }

  async send(id: number, to: string, zats: bigint, auth: SpendAuthority, memo?: string): Promise<void> {
    this.crash.check();
    const a = this.account(id);
    this.authorize(a, auth);
    const ironwood = this.ironwood;
    // The ported engine spends Orchard and Ironwood notes alike; the old one saw Orchard only.
    const spendable = BigInt(a.balances.orchard) + (ironwood ? BigInt(a.balances.ironwood) : 0n);
    if (zats + TYPICAL_FEE_ZATS > spendable) throw new Error('Insufficient balance');
    const fee = BigInt(knobs().engineFee ?? TYPICAL_FEE_ZATS);
    // The errors WebZjs (patches/webzjs/0002-memo.patch) and the adapter give.
    const check = () => {
      // WebZjs proposes a ZIP 320 pair for a TEX recipient, and create_pczt_from_proposal
      // refuses every proposal of more than one step (review round 7, SPEND-2).
      if (to.trim().toLowerCase().startsWith('tex1')) throw new Error('Failed to create Pczt: ProposalNotSupported');
      if (zats + fee > spendable) {
        throw new Error(
          `An generic error occurred: Failed to propose the transfer (possibly insufficient balance): InsufficientFunds { available: Zatoshis(${spendable}), required: Zatoshis(${zats + fee}) }`,
        );
      }
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
    this.crash.check();
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
