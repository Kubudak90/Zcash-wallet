// Owns the wallet lifecycle: boot, create/restore, unlock, the background
// sync loop and spending. React reads it through useWallet() (./wallet.tsx).
//
// Secrets policy: the seed phrase is only decrypted for the moment it is
// needed (adding the account, signing, revealing it) and is never kept in
// state. While unlocked, only the derived AES key stays in memory so the
// wallet database can be re-encrypted after each sync. Locking reloads the
// page, which drops the key and the wasm memory together; during a catch-up
// pass the lock screen shows first and the reload waits until the pass is
// saved (see lock()).

import {
  loadEngine,
  type Addresses,
  type HistoryItem,
  type SendStage,
  type Summary,
  type ZcashEngine,
} from '../engine';
import { canSpend, nextCheck, type NetworkCheck } from '../lib/network';
import { storage, type Settings, type WalletMeta } from '../lib/storage';
import { catchUpFor, type SyncInfo } from '../lib/syncView';
import { createVault, decryptDb, encryptDb, unlockVault, type Secret, type VaultRecord } from '../lib/vault';

export type Phase = 'booting' | 'bootError' | 'welcome' | 'locked' | 'ready';

export interface WalletState {
  phase: Phase;
  bootError: string | null;
  settings: Settings;
  meta: WalletMeta | null;
  accountId: number | null;
  summary: Summary | null;
  addresses: Addresses | null;
  history: HistoryItem[];
  sync: SyncInfo;
  /** Whether the network still accepts what the engine builds; read at boot and on every pass. */
  network: NetworkCheck;
  /** True while a send or shield runs; the UI keeps the user on its progress meanwhile. */
  spending: boolean;
  /** The lock screen shows while a catch-up pass finishes and is saved (see lock()). */
  softLocked: boolean;
}

const SYNC_INTERVAL_MS = 30_000;
const SYNC_RETRY_MS = 10_000;
const PROGRESS_POLL_MS = 2_000;
/** How often the engine's pass counters are read while a catch-up pass runs. */
const PASS_PROGRESS_POLL_MS = 1_000;
const HISTORY_LIMIT = 100;

export class NotASeedWalletError extends Error {
  constructor() {
    super('this wallet has no spending key');
    this.name = 'NotASeedWalletError';
  }
}

/** A spend refused before anything left the wallet: the network check did not say yes (see canSpend). */
export class NetworkNotSupportedError extends Error {
  constructor() {
    super('spending is disabled: the engine does not support the network, or that could not be checked');
    this.name = 'NetworkNotSupportedError';
  }
}

/** Asks before the tab is closed or reloaded while a spend is running. */
function confirmLeave(e: BeforeUnloadEvent) {
  e.preventDefault();
  // Older Chromium shows the prompt only when returnValue is set.
  e.returnValue = true;
}

export class WalletController {
  private engine: ZcashEngine | null = null;
  private key: CryptoKey | null = null;
  private listeners = new Set<() => void>();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private lockAfterSpend = false;
  /** Soft-locked: the page reloads once the running pass is saved (see lock()). */
  private lockAfterPass = false;
  /** A password is being checked during a soft lock; the reload waits for it. */
  private unlocking = false;
  private syncing = false;
  private summaryInFlight = false;
  private networkCheck: Promise<void> | null = null;
  private state: WalletState;

  constructor(settings: Settings) {
    this.state = {
      phase: 'booting',
      bootError: null,
      settings,
      meta: null,
      accountId: null,
      summary: null,
      addresses: null,
      history: [],
      sync: { status: 'starting', error: null, catchUp: null, networkTip: null, progress: null },
      network: { status: null, error: null },
      spending: false,
      softLocked: false,
    };
  }

  // --- store plumbing -------------------------------------------------------

  getState = (): WalletState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<WalletState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private get eng(): ZcashEngine {
    if (!this.engine) throw new Error('engine not ready');
    return this.engine;
  }

  // --- boot -----------------------------------------------------------------

  async boot(): Promise<void> {
    this.set({ phase: 'booting', bootError: null });
    try {
      if (!globalThis.crossOriginIsolated) throw new Error('isolation');
      const engine = await loadEngine();
      await engine.init(this.state.settings.serverUrl);
      this.engine = engine;
      // Not awaited: the lock screen shows its result when it comes.
      void this.checkNetwork();
      const meta = (await storage.getMeta()) ?? null;
      const vault = await storage.getVault();
      this.set({ phase: vault && meta ? 'locked' : 'welcome', meta });
    } catch (e) {
      this.set({ phase: 'bootError', bootError: e instanceof Error ? e.message : String(e) });
    }
  }

  latestHeight(): Promise<number> {
    return this.eng.latestHeight();
  }

  detectBirthday(secret: { phrase: string } | { ufvk: string }): Promise<number | null> {
    return this.eng.detectBirthday(secret);
  }

  isValidViewingKey(ufvk: string): Promise<boolean> {
    return this.eng.isValidViewingKey(ufvk);
  }

  // --- create / restore / unlock ---------------------------------------------

  async createWallet(secret: Secret, birthday: number, password: string): Promise<void> {
    const { record, key } = await createVault(password, secret);
    const meta: WalletMeta = { kind: secret.kind === 'seed' ? 'seed' : 'view', birthday, createdAt: Date.now() };

    await this.eng.open(null);
    const accountId = await this.addAccount(secret, birthday);
    const db = await encryptDb(key, await this.eng.exportDb());
    await storage.saveWallet(record, meta, db);

    this.key = key;
    this.set({ meta, accountId });
    await this.enterReady();
  }

  async unlock(password: string): Promise<void> {
    const record = await storage.getVault();
    const meta = await storage.getMeta();
    if (!record || !meta) throw new Error('no wallet');
    if (this.lockAfterPass) return this.unlockSoft(record, password);

    // Throws WrongPasswordError before anything else happens.
    const { secret, key } = await unlockVault(record, password);

    const blob = await storage.getDb();
    let accountId: number | null;
    try {
      accountId = await this.eng.open(blob ? await decryptDb(key, blob) : null);
    } catch (e) {
      // e.g. a database written by an older WebZjs version that no longer decodes.
      console.warn('wallet database unreadable', e);
      accountId = await this.eng.open(null);
    }
    if (accountId === null) {
      // The database was missing, empty or unreadable: rebuild it from the secret.
      console.warn('rebuilding the wallet database from the secret');
      accountId = await this.addAccount(secret, meta.birthday);
      await storage.setDb(await encryptDb(key, await this.eng.exportDb()));
    }

    this.key = key;
    this.set({ meta, accountId });
    await this.enterReady();
  }

  /** Ends a soft lock (see lock()): checks the password and returns to the pass that kept running. */
  private async unlockSoft(record: VaultRecord, password: string): Promise<void> {
    this.unlocking = true;
    try {
      // Throws WrongPasswordError; the decrypted secret is dropped at once.
      await unlockVault(record, password);
    } catch (e) {
      // The pass ended during the attempt, and its reload waited for it.
      if (!this.syncing) this.reloadLocked();
      throw e;
    } finally {
      this.unlocking = false;
    }
    this.lockAfterPass = false;
    this.set({ phase: 'ready', softLocked: false });
    // A pass that ended during the attempt did not schedule the next one.
    if (!this.syncing) this.kickSync();
  }

  private addAccount(secret: Secret, birthday: number): Promise<number> {
    return secret.kind === 'seed'
      ? this.eng.addSeedAccount(secret.phrase, birthday)
      : this.eng.addViewAccount(secret.ufvk, birthday);
  }

  private async enterReady() {
    this.set({
      phase: 'ready',
      sync: { ...this.state.sync, status: 'starting', error: null, catchUp: null, progress: null },
    });
    await this.refresh();
    void this.syncLoop();
  }

  /** Decrypts the secret again; used to confirm sensitive actions. */
  async revealSecret(password: string): Promise<Secret> {
    // Nothing secret comes out of a locked wallet, soft-locked included, so no spend can start either.
    if (this.state.phase !== 'ready') throw new Error('the wallet is locked');
    const record = await storage.getVault();
    if (!record) throw new Error('no wallet');
    return (await unlockVault(record, password)).secret;
  }

  async viewingKeyFor(secret: Secret): Promise<string> {
    return secret.kind === 'ufvk' ? secret.ufvk : this.eng.viewingKey(secret.phrase);
  }

  lock(): void {
    // Reloading now would kill a payment half-way through; lock once it settles.
    if (this.state.spending) {
      this.lockAfterSpend = true;
      return;
    }
    this.lockAfterSpend = false;
    // A catch-up pass keeps its progress in memory until it ends and is
    // saved, so reloading now would throw away a restore that may have run
    // for hours. Soft lock instead: the lock screen shows at once (nothing
    // else is rendered, revealSecret refuses, so no spend can start), the
    // pass goes on, and the page reloads as soon as the pass is saved.
    // Unlocking meanwhile cancels the reload.
    if (this.syncing && this.state.sync.catchUp) {
      this.lockAfterPass = true;
      this.set({ phase: 'locked', softLocked: true });
      return;
    }
    this.reloadLocked();
  }

  /** Drops the key and, with the page, the wasm memory. */
  private reloadLocked(): void {
    this.key = null;
    window.location.reload();
  }

  async wipe(): Promise<void> {
    // First, so a pass that ends meanwhile cannot write the database back (see persist).
    this.key = null;
    await storage.wipeWallet();
    window.location.reload();
  }

  async saveSettings(settings: Settings, { restart = false } = {}): Promise<void> {
    await storage.setSettings(settings);
    if (restart) {
      window.location.reload();
      return;
    }
    this.set({ settings });
  }

  // --- sync -------------------------------------------------------------------

  private setSync(patch: Partial<SyncInfo>) {
    this.set({ sync: { ...this.state.sync, ...patch } });
  }

  private async syncLoop(): Promise<void> {
    if (this.state.phase !== 'ready' || this.syncing) return;
    this.syncing = true;
    void this.checkNetwork();
    this.setSync({ status: 'syncing', progress: null, ...this.gapTo(await this.readTip()) });

    // Engines that can report progress mid-pass move the bar; WebZjs answers
    // only when the pass ends, so at most one summary call waits at a time.
    const poll = setInterval(() => void this.refreshSummary(), PROGRESS_POLL_MS);
    // WebZjs's pass counters answer at once, so its bar moves too. Only a
    // catch-up pass shows a bar, so steady-state passes are not watched.
    const pass = this.eng.syncProgress && this.state.sync.catchUp ? this.watchPass() : null;
    const scannedBefore = this.state.summary?.scannedHeight;
    let delay = SYNC_INTERVAL_MS;
    try {
      await this.eng.sync();
      // WebZjs reads the tip once per scan iteration, so a long pass ends
      // behind blocks mined while it ran. On the tip read before the pass the
      // wallet would count as up to date and spends would start (and run that
      // catch-up inline), so the tip is read again before the new scanned
      // height shows.
      const tip = await this.readTip();
      if (tip !== null) this.setSync({ networkTip: tip });
      await this.refresh();
      await this.persist();
      const gap = this.gapTo(tip);
      // Still behind after moving forward: catch up again at once. A pass
      // that made no progress (e.g. a lagging server) waits as usual.
      const moved = scannedBefore === undefined || (this.state.summary?.scannedHeight ?? 0) > scannedBefore;
      if (gap.catchUp && moved) {
        this.setSync({ ...gap, progress: null });
        delay = 0;
      } else {
        this.setSync({ status: 'idle', error: null, catchUp: null, progress: null });
      }
    } catch (e) {
      console.warn('sync failed', e);
      this.setSync({ status: 'error', error: e instanceof Error ? e.message : String(e), catchUp: null, progress: null });
      delay = SYNC_RETRY_MS;
    } finally {
      clearInterval(poll);
      pass?.stop();
      this.syncing = false;
    }
    // Soft-locked during the pass: it is saved now, so the lock goes through.
    // After a failed pass there is nothing new to save (only a pass that
    // succeeds is persisted), so it goes through too. A password check under
    // way decides instead (unlockSoft).
    if (this.lockAfterPass) {
      if (!this.unlocking) this.reloadLocked();
      return;
    }
    this.syncTimer = setTimeout(() => void this.syncLoop(), delay);
  }

  /**
   * Reads the network tip before and after a pass, while the engine can
   * answer; null if the server did not.
   */
  private async readTip(): Promise<number | null> {
    try {
      // Servers behind one lightwalletd URL can be a block apart; never step back.
      return Math.max(await this.eng.latestHeight(), this.state.sync.networkTip ?? 0);
    } catch {
      return null;
    }
  }

  /** Compares the network tip with the wallet's scanned height. */
  private gapTo(networkTip: number | null): Partial<SyncInfo> {
    // The pass itself reports connection problems; until then the last error stands.
    if (networkTip === null) return { catchUp: null };
    const scanned = this.state.summary?.scannedHeight;
    return { error: null, networkTip, catchUp: scanned === undefined ? null : catchUpFor(scanned, networkTip) };
  }

  /**
   * Polls the engine's counters for the pass that is starting, until stop().
   * A reading from after the pass ended (running: false) is ignored, so the
   * bar only moves on counts of the running pass.
   */
  private watchPass(): { stop(): void } {
    let stopped = false;
    let inFlight = false;
    const read = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const p = await this.eng.syncProgress?.();
        if (!stopped && p?.running) this.setSync({ progress: { visited: p.visited, scanned: p.scanned } });
      } catch (e) {
        console.warn('sync progress failed', e);
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(() => void read(), PASS_PROGRESS_POLL_MS);
    return {
      stop() {
        stopped = true;
        clearInterval(timer);
      },
    };
  }

  /** Runs a sync now instead of waiting for the next tick (e.g. after sending). */
  private kickSync() {
    if (this.syncing) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    void this.syncLoop();
  }

  private async refreshSummary() {
    if (this.state.accountId === null || this.summaryInFlight) return;
    this.summaryInFlight = true;
    try {
      this.set({ summary: await this.eng.summary(this.state.accountId) });
    } catch (e) {
      console.warn('summary failed', e);
    } finally {
      this.summaryInFlight = false;
    }
  }

  async refresh(): Promise<void> {
    const id = this.state.accountId;
    if (id === null) return;
    const [summary, addresses, history] = await Promise.all([
      this.eng.summary(id),
      this.state.addresses ? Promise.resolve(this.state.addresses) : this.eng.addresses(id),
      this.eng.history(id, HISTORY_LIMIT).catch((e) => {
        console.warn('history failed', e);
        return this.state.history;
      }),
    ]);
    this.set({ summary, addresses, history });
  }

  private async persist() {
    const key = this.key;
    if (!key) return;
    const blob = await encryptDb(key, await this.eng.exportDb());
    // Wiped meanwhile (a soft lock leaves the wipe button on screen while a
    // pass runs): writing now would bring the removed database back.
    if (this.key !== key) return;
    await storage.setDb(blob);
  }

  // --- network rules ----------------------------------------------------------

  /**
   * Asks the engine whether it supports the rules the network runs. Fails
   * closed: a server that does not answer leaves spending off until one does
   * (see lib/network.ts). Concurrent callers share one request.
   */
  private checkNetwork(): Promise<void> {
    // Assigned before the request can settle, so .finally never clears a newer one.
    this.networkCheck ??= this.readNetwork().finally(() => {
      this.networkCheck = null;
    });
    return this.networkCheck;
  }

  private async readNetwork(): Promise<void> {
    try {
      const status = await this.eng.networkStatus();
      const seenTip = Math.max(this.state.network.status?.height ?? 0, this.state.sync.networkTip ?? 0);
      this.set({ network: nextCheck(this.state.network, status, seenTip) });
    } catch (e) {
      console.warn('network check failed', e);
      this.set({ network: { ...this.state.network, error: e instanceof Error ? e.message : String(e) } });
    }
  }

  /** Asks the server again and throws unless the engine supports the network. */
  private async requireSupportedNetwork(): Promise<void> {
    await this.checkNetwork();
    if (!canSpend(this.state.network)) throw new NetworkNotSupportedError();
  }

  // --- spending ---------------------------------------------------------------

  private async spendingPhrase(password: string): Promise<string> {
    const secret = await this.revealSecret(password);
    if (secret.kind !== 'seed') throw new NotASeedWalletError();
    return secret.phrase;
  }

  /** `memo`: optional UTF-8 text for a shielded recipient, see ZcashEngine.send. */
  async send(
    to: string,
    zats: bigint,
    password: string,
    onStage: (s: SendStage) => void,
    memo?: string,
  ): Promise<void> {
    await this.spend(onStage, async (stage, beforeBroadcast) => {
      const id = this.requireAccount();
      const phrase = await this.spendingPhrase(password);
      await this.eng.send(id, to, zats, { phrase, onStage: stage, beforeBroadcast }, memo);
    });
  }

  async shield(password: string, onStage: (s: SendStage) => void): Promise<void> {
    await this.spend(onStage, async (stage, beforeBroadcast) => {
      const id = this.requireAccount();
      const phrase = await this.spendingPhrase(password);
      await this.eng.shield(id, { phrase, onStage: stage, beforeBroadcast });
    });
  }

  /**
   * Runs one spend at a time, so a second click can never pay twice. The
   * network is asked again before anything is built and once more before the
   * broadcast: a transaction the network would reject never leaves the wallet.
   */
  private async spend(
    onStage: (s: SendStage) => void,
    run: (onStage: (s: SendStage) => void, beforeBroadcast: () => Promise<void>) => Promise<void>,
  ): Promise<void> {
    if (this.state.spending) throw new Error('another payment is still in progress');
    this.set({ spending: true });
    window.addEventListener('beforeunload', confirmLeave);
    let broadcasting = false;
    try {
      let failure: { cause: unknown } | null = null;
      try {
        await this.requireSupportedNetwork();
        await run(
          (s) => {
            if (s === 'broadcasting') broadcasting = true;
            onStage(s);
          },
          () => this.requireSupportedNetwork(),
        );
      } catch (cause) {
        failure = { cause };
      }
      // After a success the transaction is out. After a failed broadcast it may
      // be too: WebZjs stores it before broadcasting. Either way History must
      // show it and the saved wallet keep it, before a deferred lock reloads;
      // a failed refresh must not read as a failed send.
      if (!failure || broadcasting) {
        await this.afterSpend().catch((e) => console.warn('refresh after spend failed', e));
      }
      if (failure) throw failure.cause;
    } finally {
      window.removeEventListener('beforeunload', confirmLeave);
      this.set({ spending: false });
      if (this.lockAfterSpend) this.lock();
    }
  }

  private async afterSpend() {
    await this.refresh();
    await this.persist();
    this.kickSync();
  }

  private requireAccount(): number {
    if (this.state.accountId === null) throw new Error('no account');
    return this.state.accountId;
  }
}
