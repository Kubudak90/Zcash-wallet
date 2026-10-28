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
import { createVault, decryptDb, encryptDb, unlockVault, type Secret } from '../lib/vault';

export type Phase = 'booting' | 'bootError' | 'welcome' | 'locked' | 'ready';
export type SyncStatus = 'starting' | 'syncing' | 'idle' | 'error';

export interface WalletState {
  phase: Phase;
  bootError: string | null;
  settings: Settings;
  meta: WalletMeta | null;
  accountId: number | null;
  summary: Summary | null;
  addresses: Addresses | null;
  history: HistoryItem[];
  sync: { status: SyncStatus; error: string | null };
}

const SYNC_INTERVAL_MS = 30_000;
const SYNC_RETRY_MS = 10_000;
const PROGRESS_POLL_MS = 2_000;
const HISTORY_LIMIT = 100;

export class NotASeedWalletError extends Error {
  constructor() {
    super('this wallet has no spending key');
    this.name = 'NotASeedWalletError';
  }
}

export class WalletController {
  private engine: ZcashEngine | null = null;
  private key: CryptoKey | null = null;
  private listeners = new Set<() => void>();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
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
      sync: { status: 'starting', error: null },
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
    this.set({ phase: 'ready', sync: { status: 'starting', error: null } });
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

  private async syncLoop(): Promise<void> {
    if (this.state.phase !== 'ready') return;
    this.set({ sync: { status: 'syncing', error: null } });

    // Sync runs in a worker; poll the summary meanwhile so progress moves.
    const poll = setInterval(() => void this.refreshSummary(), PROGRESS_POLL_MS);
    let delay = SYNC_INTERVAL_MS;
    try {
      await this.eng.sync();
      await this.refresh();
      await this.persist();
      this.set({ sync: { status: 'idle', error: null } });
    } catch (e) {
      console.warn('sync failed', e);
      this.set({ sync: { status: 'error', error: e instanceof Error ? e.message : String(e) } });
      delay = SYNC_RETRY_MS;
    } finally {
      clearInterval(poll);
    }
    this.syncTimer = setTimeout(() => void this.syncLoop(), delay);
  }

  /** Runs a sync now instead of waiting for the next tick (e.g. after sending). */
  private kickSync() {
    if (this.state.sync.status === 'syncing') return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    void this.syncLoop();
  }

  private async refreshSummary() {
    if (this.state.accountId === null) return;
    try {
      this.set({ summary: await this.eng.summary(this.state.accountId) });
    } catch (e) {
      console.warn('summary failed', e);
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

  async send(to: string, zats: bigint, password: string, onStage: (s: SendStage) => void): Promise<void> {
    const id = this.requireAccount();
    const phrase = await this.spendingPhrase(password);
    await this.eng.send(id, to, zats, { phrase, onStage });
    await this.afterSpend();
  }

  async shield(password: string, onStage: (s: SendStage) => void): Promise<void> {
    const id = this.requireAccount();
    const phrase = await this.spendingPhrase(password);
    await this.eng.shield(id, { phrase, onStage });
    await this.afterSpend();
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
