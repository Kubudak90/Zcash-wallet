// Password vault for the wallet secret (seed phrase or viewing key) and the
// wallet database. Everything stored in the browser goes through here:
// PBKDF2-SHA256 derives 256 bits from the password, and each blob carries its own
// random IV plus a purpose label as associated data so that ciphertexts cannot be
// swapped between slots.
//
// Keys (review round 7, VAULT-1). The database key, which the controller keeps while
// the wallet is unlocked, is the PBKDF2 output imported as a non-extractable AES-GCM
// key. A version 1 vault seals the secret under that same key, so whoever holds the
// key in an unlocked tab (DevTools, an injected script) can open the secret without the
// password. A version 2 vault seals it under a second key derived from the same bits
// with HKDF ('celari/secret/v2'), which the database key cannot stand in for and which
// is dropped as soon as the secret is open; the database key, and so every stored
// database blob, stays as it is. This release reads both versions but still writes
// version 1 (VAULT_WRITE_VERSION): the build deployed before it reads only version 1,
// so writing version 2 now would lock a wallet out ("wrong password") on a rollback in
// the weeks around NU7. Switching VAULT_WRITE_VERSION to 2 later upgrades each vault on
// its next unlock, and a rollback to this release still opens it.

import { fromBase64, toBase64 } from './bytes';

export const KDF_ITERATIONS = 600_000; // OWASP 2023 recommendation for PBKDF2-SHA256
export const MIN_PASSWORD_LENGTH = 8;

const AAD_SECRET_V1 = 'celari/secret/v1';
const AAD_SECRET_V2 = 'celari/secret/v2';
const AAD_DB = 'celari/db/v1';
/** HKDF info of the version 2 secret key. */
const SECRET_KEY_INFO = 'celari/secret/v2';

export type VaultVersion = 1 | 2;

/** The version new vaults are written in and older ones are upgraded to on unlock (see above). */
export const VAULT_WRITE_VERSION: VaultVersion = 1;

export type Secret =
  | { kind: 'seed'; phrase: string }
  | { kind: 'ufvk'; ufvk: string };

export interface EncryptedBlob {
  iv: string;
  ct: string;
}

export interface VaultRecord {
  v: VaultVersion;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  secret: EncryptedBlob;
}

export class WrongPasswordError extends Error {
  constructor() {
    super('wrong password');
    this.name = 'WrongPasswordError';
  }
}

/** A vault record of a version this Celari does not know (a newer one wrote it). Not a wrong password. */
export class UnsupportedVaultError extends Error {
  constructor(version: unknown) {
    super(`unsupported vault version ${String(version)}`);
    this.name = 'UnsupportedVaultError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface VaultKeys {
  /** Opens the database blobs, and a version 1 secret. The PBKDF2 output itself, non-extractable. */
  db: CryptoKey;
  /** Opens a version 2 secret: HKDF-SHA256 of the same bits, non-extractable. */
  secret: CryptoKey;
}

/**
 * The PBKDF2 bits as the two keys. `db` is the key PBKDF2 deriveKey made before version 2
 * (deriveKey is deriveBits of the key length, imported raw), so every existing database
 * blob opens with it. The bits are zeroed once imported.
 */
async function deriveKeys(password: string, salt: Uint8Array, iterations: number): Promise<VaultKeys> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256),
  );
  try {
    const db = await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const secret = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(SECRET_KEY_INFO) },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    return { db, secret };
  } finally {
    bits.fill(0);
  }
}

/** Seals the secret as a vault of `version`. */
function sealSecret(keys: VaultKeys, plaintext: Uint8Array, version: VaultVersion): Promise<EncryptedBlob> {
  return version === 2 ? seal(keys.secret, plaintext, AAD_SECRET_V2) : seal(keys.db, plaintext, AAD_SECRET_V1);
}

async function seal(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    key,
    plaintext,
  );
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

async function open(key: CryptoKey, blob: EncryptedBlob, aad: string): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(blob.iv), additionalData: encoder.encode(aad) },
    key,
    fromBase64(blob.ct),
  );
  return new Uint8Array(pt);
}

export async function createVault(
  password: string,
  secret: Secret,
  iterations = KDF_ITERATIONS,
  version: VaultVersion = VAULT_WRITE_VERSION,
): Promise<{ record: VaultRecord; key: CryptoKey }> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error('password too short');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keys = await deriveKeys(password, salt, iterations);
  const sealed = await sealSecret(keys, encoder.encode(JSON.stringify(secret)), version);
  return {
    record: {
      v: version,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
      secret: sealed,
    },
    // Only the database key leaves: for a version 2 vault it cannot open the secret.
    key: keys.db,
  };
}

/**
 * Derives the keys from the password and decrypts the secret. Throws WrongPasswordError on
 * mismatch, UnsupportedVaultError for a version this Celari does not know. `key` is the
 * database key. `upgraded`: the same vault with the secret sealed again in `writeVersion`
 * (same salt and password), for the caller to store; null when it is in that version already.
 */
export async function unlockVault(
  record: VaultRecord,
  password: string,
  writeVersion: VaultVersion = VAULT_WRITE_VERSION,
): Promise<{ secret: Secret; key: CryptoKey; upgraded: VaultRecord | null }> {
  const version: unknown = record.v;
  if (version !== 1 && version !== 2) throw new UnsupportedVaultError(version);
  const keys = await deriveKeys(password, fromBase64(record.kdf.salt), record.kdf.iterations);
  let plaintext: Uint8Array;
  try {
    plaintext =
      version === 2 ? await open(keys.secret, record.secret, AAD_SECRET_V2) : await open(keys.db, record.secret, AAD_SECRET_V1);
  } catch {
    throw new WrongPasswordError();
  }
  const upgraded =
    version < writeVersion ? { ...record, v: writeVersion, secret: await sealSecret(keys, plaintext, writeVersion) } : null;
  const secret = JSON.parse(decoder.decode(plaintext)) as Secret;
  plaintext.fill(0);
  return { secret, key: keys.db, upgraded };
}

export function encryptDb(key: CryptoKey, bytes: Uint8Array): Promise<EncryptedBlob> {
  return seal(key, bytes, AAD_DB);
}

export function decryptDb(key: CryptoKey, blob: EncryptedBlob): Promise<Uint8Array> {
  return open(key, blob, AAD_DB);
}

export type PasswordStrength = 'weak' | 'fair' | 'strong';

export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) return 'weak';
  const classes = [/[a-zçğıöşü]/, /[A-ZÇĞİÖŞÜ]/, /\d/, /[^A-Za-z0-9çğıöşüÇĞİÖŞÜ]/].filter((re) =>
    re.test(password),
  ).length;
  if (password.length >= 14 && classes >= 3) return 'strong';
  if (password.length >= 10 && classes >= 2) return 'fair';
  return 'weak';
}
