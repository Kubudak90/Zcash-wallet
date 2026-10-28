// Owns the wallet lifecycle: boot, create/restore, unlock, the background
// sync loop and spending. React reads it through useWallet() (./wallet.tsx).
//
// Secrets policy: the seed phrase is only decrypted for the moment it is
// needed (adding the account, signing, revealing it) and is never kept in
// state. While unlocked, only the derived AES key stays in memory so the
// wallet database can be re-encrypted after each sync. Locking reloads the
// page, which drops the key and the wasm memory together.

import {
  loadEngine,
  type Addresses,
  type HistoryItem,
  type SendStage,
  type Summary,
  type ZcashEngine,
} from '../engine';
import { storage, type Settings, type WalletMeta } from '../lib/storage';
import { catchUpFor, type SyncInfo } from '../lib/syncView';
import { createVault, decryptDb, encryptDb, unlockVault, type Secret } from '../lib/vault';

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
  /** True while a send or shield runs; the UI keeps the user on its progress meanwhile. */
  spending: boolean;
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
  private syncing = false;
  private summaryInFlight = false;
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
      spending: false,
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
    this.key = null;
    window.location.reload();
  }

  async wipe(): Promise<void> {
    await storage.wipeWallet();
    this.key = null;
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
    this.setSync({ status: 'syncing', progress: null, ...(await this.measureGap()) });

    // Engines that can report progress mid-pass move the bar; WebZjs answers
    // only when the pass ends, so at most one summary call waits at a time.
    const poll = setInterval(() => void this.refreshSummary(), PROGRESS_POLL_MS);
    // WebZjs's pass counters answer at once, so its bar moves too. Only a
    // catch-up pass shows a bar, so steady-state passes are not watched.
    const pass = this.eng.syncProgress && this.state.sync.catchUp ? this.watchPass() : null;
    let delay = SYNC_INTERVAL_MS;
    try {
      await this.eng.sync();
      await this.refresh();
      await this.persist();
      this.setSync({ status: 'idle', error: null, catchUp: null, progress: null });
    } catch (e) {
      console.warn('sync failed', e);
      this.setSync({ status: 'error', error: e instanceof Error ? e.message : String(e), catchUp: null, progress: null });
      delay = SYNC_RETRY_MS;
    } finally {
      clearInterval(poll);
      pass?.stop();
      this.syncing = false;
    }
    this.syncTimer = setTimeout(() => void this.syncLoop(), delay);
  }

  /**
   * Reads the network tip before a pass, while the engine can still answer,
   * and compares it with the wallet's scanned height.
   */
  private async measureGap(): Promise<Partial<SyncInfo>> {
    let tip: number;
    try {
      tip = await this.eng.latestHeight();
    } catch {
      // The pass itself reports connection problems; until then the last error stands.
      return { catchUp: null };
    }
    // Servers behind one lightwalletd URL can be a block apart; never step back.
    const networkTip = Math.max(tip, this.state.sync.networkTip ?? 0);
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
    if (!this.key) return;
    await storage.setDb(await encryptDb(this.key, await this.eng.exportDb()));
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
    await this.spend(async () => {
      const id = this.requireAccount();
      const phrase = await this.spendingPhrase(password);
      await this.eng.send(id, to, zats, { phrase, onStage }, memo);
    });
  }

  async shield(password: string, onStage: (s: SendStage) => void): Promise<void> {
    await this.spend(async () => {
      const id = this.requireAccount();
      const phrase = await this.spendingPhrase(password);
      await this.eng.shield(id, { phrase, onStage });
    });
  }

  /** Runs one spend at a time, so a second click can never pay twice. */
  private async spend(run: () => Promise<void>): Promise<void> {
    if (this.state.spending) throw new Error('another payment is still in progress');
    this.set({ spending: true });
    window.addEventListener('beforeunload', confirmLeave);
    try {
      await run();
      // The transaction is out at this point: a failed refresh must not read as a failed send.
      await this.afterSpend().catch((e) => console.warn('refresh after spend failed', e));
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
