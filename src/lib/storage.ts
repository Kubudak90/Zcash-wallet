// Browser persistence. The vault and wallet database are only ever stored
// encrypted (see vault.ts); settings and metadata hold nothing secret.

import { createStore, del, get, promisifyRequest, set, type UseStore } from 'idb-keyval';

import type { EncryptedBlob, VaultRecord } from './vault';

const store = createStore('celari', 'kv');

/**
 * The database an older engine wrote, kept while the wallet is rebuilt and
 * rescanned in the current engine's format, until a pass that reaches the tip
 * has been saved (see WalletController.unlock). Encrypted like 'db'.
 */
const LEGACY_DB = 'db-legacy';

export type WalletKind = 'seed' | 'view';

export interface WalletMeta {
  kind: WalletKind;
  birthday: number;
  createdAt: number;
  /**
   * The engine's id of the wallet's account, written with each database Celari
   * creates. The engine may not name it from the database alone (WebZjs has no
   * account list before a pass has set the chain tip). Absent in metadata written
   * before the engine port.
   */
  accountId?: number;
}

export interface Settings {
  lang: 'tr' | 'en';
  serverUrl: string;
  autoLockMinutes: number;
  /** Amounts show as a placeholder (useHideBalances); kept across locks. */
  hideBalances: boolean;
  /**
   * Sync passes fetch the wallet's own transactions in full (ZcashEngine.setHistoryEnhancement):
   * memos, and after a restore the recipients and fees of past sends; the server then learns
   * which transactions are the wallet's. On by default.
   */
  historyEnhancement: boolean;
}

export const DEFAULT_SERVER = import.meta.env.VITE_DEFAULT_LIGHTWALLETD || 'https://zcash-mainnet.chainsafe.dev';

/**
 * English is the primary language, whatever the browser's: Turkish is one tap
 * away on Welcome, Unlock and Settings. A language chosen earlier is stored
 * with the settings and still wins (getSettings spreads it over these).
 */
export function defaultSettings(): Settings {
  return { lang: 'en', serverUrl: DEFAULT_SERVER, autoLockMinutes: 15, hideBalances: false, historyEnhancement: true };
}

/** Puts and deletes keys in one IndexedDB transaction: all of them happen, or none. */
function writeAll(puts: [string, unknown][], deletes: string[], customStore: UseStore = store): Promise<void> {
  return customStore('readwrite', (s) => {
    for (const [key, value] of puts) s.put(value, key);
    for (const key of deletes) s.delete(key);
    return promisifyRequest(s.transaction);
  });
}

/**
 * A wallet is stored already: another Celari tab added one after this page looked
 * (review round 7, PLAT-1). Nothing was written.
 */
export class WalletExistsError extends Error {
  constructor() {
    super('a wallet is already stored in this browser');
    this.name = 'WalletExistsError';
  }
}

/**
 * One readwrite transaction that first reads the stored vault and meta, then lets
 * `decide` put and delete (or not) on what it read: no other tab can write between the
 * read and the writes. Resolves with what `decide` returned once the transaction commits;
 * `decide` throwing aborts it, and nothing is written.
 */
function readThenWrite<T>(
  decide: (stored: { vault: VaultRecord | undefined; meta: WalletMeta | undefined }, s: IDBObjectStore) => T,
): Promise<T> {
  return store(
    'readwrite',
    (s) =>
      new Promise<T>((resolve, reject) => {
        let outcome: { value: T } | { error: unknown } | null = null;
        const vault = s.get('vault');
        const meta = s.get('meta');
        // The requests of one transaction complete in order: the vault's is done here.
        meta.onsuccess = () => {
          try {
            outcome = { value: decide({ vault: vault.result, meta: meta.result }, s) };
          } catch (error) {
            outcome = { error };
            s.transaction.abort();
          }
        };
        s.transaction.oncomplete = () => {
          if (outcome && 'value' in outcome) resolve(outcome.value);
          else reject(new Error('the transaction ended before its reads'));
        };
        s.transaction.onabort = () => reject(outcome && 'error' in outcome ? outcome.error : s.transaction.error);
      }),
  );
}

export const storage = {
  getVault: () => get<VaultRecord>('vault', store),
  getMeta: () => get<WalletMeta>('meta', store),
  getDb: () => get<EncryptedBlob>('db', store),

  /**
   * Saves the wallet database, only while the stored vault is still the one `salt`
   * belongs to: true once written, false when the wallet was removed or replaced (in
   * another tab) since this page opened it. Writing then would bring a removed wallet's
   * data back, or put it over the next wallet's (review round 7, VAULT-2, SPEND-5).
   */
  setDb: (blob: EncryptedBlob, salt: string) =>
    readThenWrite(({ vault }, s) => {
      if (vault?.kdf.salt !== salt) return false;
      s.put(blob, 'db');
      return true;
    }),

  /**
   * A new wallet: nothing of an earlier one (an old-format copy included) stays. Refused
   * with WalletExistsError when a wallet is stored already (the same test as boot()'s for
   * the lock screen): this page showed onboarding before another tab added one, and
   * replacing it here would drop that wallet's only stored copy of its secret without the
   * warning and typed confirmation of "Remove wallet" (review round 7, PLAT-1).
   */
  saveWallet: (vault: VaultRecord, meta: WalletMeta, db: EncryptedBlob) =>
    readThenWrite((stored, s) => {
      if (stored.vault !== undefined && stored.meta !== undefined) throw new WalletExistsError();
      s.put(vault, 'vault');
      s.put(meta, 'meta');
      s.put(db, 'db');
      s.delete(LEGACY_DB);
    }),

  /**
   * Replaces the stored vault with `next` (the same wallet and password, the secret sealed
   * again), only while the stored one has the same salt: true once written.
   */
  upgradeVault: (next: VaultRecord) =>
    readThenWrite(({ vault }, s) => {
      if (vault?.kdf.salt !== next.kdf.salt) return false;
      s.put(next, 'vault');
      return true;
    }),

  /**
   * A database rebuilt from the secret replaces the stored one, with its metadata,
   * in one transaction. `legacy` (the old-format blob it replaces) is kept under
   * db-legacy; null leaves db-legacy as it is. Like setDb, only while the stored vault is
   * the one `salt` belongs to; otherwise nothing is written and it throws.
   */
  replaceDb: (db: EncryptedBlob, meta: WalletMeta, legacy: EncryptedBlob | null, salt: string) =>
    readThenWrite(({ vault }, s) => {
      if (vault?.kdf.salt !== salt) throw new Error('the wallet was removed or replaced in another tab');
      s.put(db, 'db');
      s.put(meta, 'meta');
      if (legacy) s.put(legacy, LEGACY_DB);
    }),

  getLegacyDb: () => get<EncryptedBlob>(LEGACY_DB, store),
  async hasLegacyDb(): Promise<boolean> {
    return (await get(LEGACY_DB, store)) !== undefined;
  },
  dropLegacyDb: () => del(LEGACY_DB, store),

  async getSettings(): Promise<Settings> {
    return { ...defaultSettings(), ...((await get<Partial<Settings>>('settings', store)) ?? {}) };
  },
  setSettings: (settings: Settings) => set('settings', settings, store),

  wipeWallet: () => writeAll([], ['vault', 'meta', 'db', LEGACY_DB]),
};
