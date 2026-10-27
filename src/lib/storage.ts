// Browser persistence. The vault and wallet database are only ever stored
// encrypted (see vault.ts); settings and metadata hold nothing secret.

import { createStore, del, get, set } from 'idb-keyval';

import type { EncryptedBlob, VaultRecord } from './vault';

const store = createStore('celari', 'kv');

export type WalletKind = 'seed' | 'view';

export interface WalletMeta {
  kind: WalletKind;
  birthday: number;
  createdAt: number;
}

export interface Settings {
  lang: 'tr' | 'en';
  serverUrl: string;
  autoLockMinutes: number;
}

export const DEFAULT_SERVER = import.meta.env.VITE_DEFAULT_LIGHTWALLETD || 'https://zcash-mainnet.chainsafe.dev';

export function defaultSettings(): Settings {
  const lang = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en';
  return { lang, serverUrl: DEFAULT_SERVER, autoLockMinutes: 15 };
}

export const storage = {
  getVault: () => get<VaultRecord>('vault', store),
  getMeta: () => get<WalletMeta>('meta', store),
  getDb: () => get<EncryptedBlob>('db', store),
  setDb: (blob: EncryptedBlob) => set('db', blob, store),

  async saveWallet(vault: VaultRecord, meta: WalletMeta, db: EncryptedBlob) {
    await set('vault', vault, store);
    await set('meta', meta, store);
    await set('db', db, store);
  },

  async getSettings(): Promise<Settings> {
    return { ...defaultSettings(), ...((await get<Partial<Settings>>('settings', store)) ?? {}) };
  },
  setSettings: (settings: Settings) => set('settings', settings, store),

  async wipeWallet() {
    await del('vault', store);
    await del('meta', store);
    await del('db', store);
  },
};
