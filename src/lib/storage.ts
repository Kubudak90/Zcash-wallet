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

export const storage = {
  getVault: () => get<VaultRecord>('vault', store),
  getMeta: () => get<WalletMeta>('meta', store),
  getDb: () => get<EncryptedBlob>('db', store),
  setDb: (blob: EncryptedBlob) => set('db', blob, store),

  /** A new wallet: nothing of an earlier one (an old-format copy included) stays. */
  saveWallet: (vault: VaultRecord, meta: WalletMeta, db: EncryptedBlob) =>
    writeAll(
      [
        ['vault', vault],
        ['meta', meta],
        ['db', db],
      ],
      [LEGACY_DB],
    ),

  /**
   * A database rebuilt from the secret replaces the stored one, with its metadata,
   * in one transaction. `legacy` (the old-format blob it replaces) is kept under
   * db-legacy; null leaves db-legacy as it is.
   */
  replaceDb: (db: EncryptedBlob, meta: WalletMeta, legacy: EncryptedBlob | null) =>
    writeAll(
      [
        ['db', db],
        ['meta', meta],
        ...(legacy ? ([[LEGACY_DB, legacy]] as [string, unknown][]) : []),
      ],
      [],
    ),

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
