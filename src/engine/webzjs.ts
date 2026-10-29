// ZcashEngine backed by ChainSafe's WebZjs (built from source into vendor/ by
// scripts/build-webzjs.sh).
//
// Two wasm modules are used, mirroring upstream's own wallet + snap split:
//  - webzjs-wallet: the light client (sync, balances, building and proving PCZTs)
//  - webzjs-keys:   key derivation and PCZT signing
// Objects cannot cross wasm modules, so PCZTs move between them as bytes.

import initWalletWasm, {
  initThreadPool,
  Pczt as WalletPczt,
  WebWallet,
  type ProofGenerationKey,
  type WalletSummary,
} from '@chainsafe/webzjs-wallet';
import * as walletModule from '@chainsafe/webzjs-wallet';
import initKeysWasm, {
  Pczt as KeysPczt,
  SeedFingerprint,
  UnifiedFullViewingKey,
  UnifiedSpendingKey,
  pczt_sign,
} from '@chainsafe/webzjs-keys';

import { seedBytes } from '../lib/seed';
import { fetchLightdInfo } from './lightd';
import { CrashWatch } from './webzjs-crash';
import type {
  Addresses,
  EngineStoppedError,
  HistoryItem,
  NetworkStatus,
  SpendAuthority,
  Summary,
  SyncProgress,
  ZcashEngine,
} from './types';
import { balancesFrom, type RawBalance } from './webzjs-balances';
import { openError } from './webzjs-errors';
import { historyFrom, type RawHistoryEntry } from './webzjs-history';
import { webzjsLocalStatus, webzjsNetworkStatus } from './webzjs-upgrades';

const NETWORK = 'main';
const ACCOUNT_HD_INDEX = 0;
// Notes are spendable after one confirmation, as in upstream's web wallet.
const MIN_CONFIRMATIONS_TRUSTED = 1;
const MIN_CONFIRMATIONS_UNTRUSTED = 1;

/**
 * Builds the spending key and seed fingerprint for one signing operation.
 * The raw seed is wiped as soon as wasm has its own copies.
 */
function spendingKeys(phrase: string): { usk: UnifiedSpendingKey; fingerprint: SeedFingerprint } {
  const seed = seedBytes(phrase);
  try {
    return {
      // wasm-bindgen copies the bytes into wasm memory on each call.
      usk: new UnifiedSpendingKey(NETWORK, seed, ACCOUNT_HD_INDEX),
      fingerprint: new SeedFingerprint(seed),
    };
  } finally {
    seed.fill(0);
  }
}

/**
 * The Sapling proof generation key, needed only when Sapling notes are spent.
 * It has to come from the wallet module's own key classes; if this build does
 * not export them, proving falls back to Orchard/transparent-only spends.
 */
type WalletUskConstructor = new (
  network: string,
  seed: Uint8Array,
  hdIndex: number,
) => { to_sapling_proof_generation_key(): ProofGenerationKey; free(): void };

function saplingProofKey(phrase: string): ProofGenerationKey | undefined {
  // Feature-detected: the generated typings do not promise this export.
  const WalletUsk = (walletModule as unknown as { UnifiedSpendingKey?: WalletUskConstructor }).UnifiedSpendingKey;
  if (!WalletUsk) return undefined;
  const seed = seedBytes(phrase);
  try {
    const usk = new WalletUsk(NETWORK, seed, ACCOUNT_HD_INDEX);
    const key = usk.to_sapling_proof_generation_key();
    usk.free();
    return key;
  } finally {
    seed.fill(0);
  }
}

export class WebzjsEngine implements ZcashEngine {
  // The vendored WebZjs (zcash_client_backend 0.25, patches/webzjs/0003-0004) scans,
  // reports and spends the NU6.3 Ironwood pool; summary() refuses a build that does
  // not report it (see ./webzjs-upgrades.ts for the network upgrades it knows).
  readonly ironwood = true;
  private serverUrl = '';
  /** Notices a trap of the engine's WebAssembly (./webzjs-crash.ts); every call fails from then on. */
  private crash = new CrashWatch(typeof window === 'undefined' ? null : window);
  private wallet: WebWallet | null = null;
  // A throwaway wallet for chain queries before the real one is unlocked.
  private probe: WebWallet | null = null;

  async init(serverUrl: string): Promise<void> {
    this.serverUrl = serverUrl;
    await initWalletWasm();
    await initKeysWasm();
    await initThreadPool(Math.max(2, navigator.hardwareConcurrency || 4));
    this.probe = this.newWallet(null);
  }

  private newWallet(db: Uint8Array | null): WebWallet {
    return new WebWallet(
      NETWORK,
      this.serverUrl,
      MIN_CONFIRMATIONS_TRUSTED,
      MIN_CONFIRMATIONS_UNTRUSTED,
      db ?? undefined,
    );
  }

  private get chain(): WebWallet {
    this.crash.check();
    const wallet = this.wallet ?? this.probe;
    if (!wallet) throw new Error('engine not initialized');
    return wallet;
  }

  private get open_(): WebWallet {
    this.crash.check();
    if (!this.wallet) throw new Error('wallet not open');
    return this.wallet;
  }

  /** `call()`, failing with EngineStoppedError instead of never settling if the engine traps meanwhile. */
  private guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return this.crash.guard(call());
    } catch (e) {
      return Promise.reject(e);
    }
  }

  onStopped(listener: (error: EngineStoppedError) => void): void {
    this.crash.onStopped(listener);
  }

  async latestHeight(): Promise<number> {
    return Number(await this.guarded(() => this.chain.get_latest_block()));
  }

  /** WebZjs has no call for this, so it goes to the server directly (./lightd.ts). */
  async networkStatus(): Promise<NetworkStatus> {
    if (!this.serverUrl) throw new Error('engine not initialized');
    return webzjsNetworkStatus(await fetchLightdInfo(this.serverUrl), new Date());
  }

  localNetworkStatus(): NetworkStatus | null {
    return webzjsLocalStatus(new Date());
  }

  async detectBirthday(secret: { phrase: string } | { ufvk: string }): Promise<number | null> {
    let ufvk: UnifiedFullViewingKey;
    if ('phrase' in secret) {
      const { usk, fingerprint } = spendingKeys(secret.phrase);
      fingerprint.free();
      ufvk = usk.to_unified_full_viewing_key();
      usk.free();
    } else {
      ufvk = new UnifiedFullViewingKey(NETWORK, secret.ufvk);
    }
    const taddr = ufvk.get_transparent_address(NETWORK);
    ufvk.free();
    if (!taddr) return null;
    return (await this.chain.detect_birthday_from_transparent_address(taddr)) ?? null;
  }

  async isValidViewingKey(ufvk: string): Promise<boolean> {
    try {
      new UnifiedFullViewingKey(NETWORK, ufvk.trim()).free();
      return true;
    } catch {
      return false;
    }
  }

  async viewingKey(phrase: string): Promise<string> {
    const { usk, fingerprint } = spendingKeys(phrase);
    fingerprint.free();
    const ufvk = usk.to_unified_full_viewing_key();
    usk.free();
    const encoded = ufvk.encode(NETWORK);
    ufvk.free();
    return encoded;
  }

  async open(db: Uint8Array | null): Promise<number | null> {
    try {
      this.wallet = this.newWallet(db);
    } catch (e) {
      throw openError(e);
    }
    // No summary before a pass has set the chain tip (zcash_client_sqlite's rule), so
    // a database saved before its first pass ended names no account here.
    const summary = await this.wallet.get_wallet_summary();
    if (!summary) return null;
    const first = (summary.account_balances as [number, RawBalance][])[0];
    summary.free();
    return first ? first[0] : null;
  }

  addSeedAccount(phrase: string, birthday: number): Promise<number> {
    return this.open_.create_account('Celari', phrase, ACCOUNT_HD_INDEX, birthday);
  }

  addViewAccount(ufvk: string, birthday: number): Promise<number> {
    return this.open_.create_account_view_ufvk('Celari (izleme)', ufvk.trim(), birthday);
  }

  async exportDb(): Promise<Uint8Array> {
    return new Uint8Array(await this.guarded(() => this.open_.db_to_bytes()));
  }

  sync(): Promise<void> {
    return this.guarded(() => this.open_.sync());
  }

  /**
   * WebZjs holds its database write lock for a whole pass, so
   * get_wallet_summary() only answers once the pass ends. sync_progress()
   * (patches/webzjs/0001-sync-progress.patch) reads counters the pass updates
   * and answers at once. Feature-detected, so a vendor/ built without the
   * patch still works, just without a percentage.
   */
  async syncProgress(): Promise<SyncProgress | null> {
    const wallet: { sync_progress?: WebWallet['sync_progress'] } = this.open_;
    if (typeof wallet.sync_progress !== 'function') return null;
    const p = wallet.sync_progress();
    const progress = { running: p.running, visited: p.visited, scanned: p.scanned, downloaded: p.downloaded };
    p.free();
    return progress;
  }

  async summary(account: number): Promise<Summary | null> {
    const summary: WalletSummary | undefined = await this.guarded(() => this.open_.get_wallet_summary());
    if (!summary) return null;
    const entry = (summary.account_balances as [number, RawBalance][]).find(([id]) => id === account);
    const b = entry?.[1];
    const { chain_tip_height: tipHeight, fully_scanned_height: scannedHeight } = summary;
    summary.free();
    return { tipHeight, scannedHeight, balances: balancesFrom(b) };
  }

  async addresses(account: number): Promise<Addresses> {
    const unified = await this.guarded(() => this.open_.get_current_address(account));
    let transparent: string | null = null;
    try {
      transparent = await this.guarded(() => this.open_.get_current_address_transparent(account));
    } catch {
      // Viewing keys without a transparent component have no t-address.
    }
    return { unified, transparent };
  }

  nextShieldedAddress(account: number): Promise<string> {
    // Waits for the database write lock, which a sync pass holds until it ends.
    return this.guarded(() => this.open_.get_next_shielded_address(account));
  }

  async history(account: number, limit: number): Promise<HistoryItem[]> {
    const response = await this.guarded(() => this.open_.get_transaction_history(account, limit, 0));
    const entries = (response.transactions ?? []) as RawHistoryEntry[];
    response.free();
    return historyFrom(entries);
  }

  async send(account: number, to: string, zats: bigint, auth: SpendAuthority, memo?: string): Promise<void> {
    auth.onStage?.('building');
    // pczt_create takes the memo as a 4th argument only with
    // patches/webzjs/0002-memo.patch; an unpatched build would silently drop it.
    if (memo && this.open_.pczt_create.length < 4) throw new Error('this WebZjs build cannot attach a memo');
    // ZIP 302 reads trailing NULs as padding, so the recipient would see the memo cut short.
    if (memo?.includes('\u0000')) throw new Error('a memo cannot contain NUL characters');
    // WebZjs encodes the memo and rejects one that is too long or goes to a
    // transparent or TEX address, before it touches the network.
    const pczt = await this.guarded(() => this.open_.pczt_create(account, to.trim(), zats, memo || undefined));
    await this.signProveSend(pczt, auth);
  }

  async shield(account: number, auth: SpendAuthority): Promise<void> {
    auth.onStage?.('building');
    const pczt = await this.guarded(() => this.open_.pczt_shield(account));
    await this.signProveSend(pczt, auth);
  }

  private async signProveSend(pczt: WalletPczt, auth: SpendAuthority): Promise<void> {
    auth.onStage?.('signing');
    const { usk, fingerprint } = spendingKeys(auth.phrase);
    // pczt_sign takes ownership of the key objects and frees them.
    const signed = await this.guarded(() => pczt_sign(NETWORK, KeysPczt.from_bytes(pczt.serialize()), usk, fingerprint));
    pczt.free();

    auth.onStage?.('proving');
    const proved = await this.guarded(() =>
      this.open_.pczt_prove(WalletPczt.from_bytes(signed.serialize()), saplingProofKey(auth.phrase)),
    );
    signed.free();

    try {
      await auth.beforeBroadcast();
    } catch (e) {
      proved.free();
      throw e;
    }
    auth.onStage?.('broadcasting');
    await this.guarded(() => this.open_.pczt_send(proved));
  }
}
