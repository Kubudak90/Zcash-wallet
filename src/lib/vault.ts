// Password vault for the wallet secret (seed phrase or viewing key) and the
// wallet database. Everything stored in the browser goes through here:
// PBKDF2-SHA256 derives an AES-256-GCM key from the password, and each blob
// carries its own random IV plus a purpose label as associated data so that
// ciphertexts cannot be swapped between slots.

import { fromBase64, toBase64 } from './bytes';

export const KDF_ITERATIONS = 600_000; // OWASP 2023 recommendation for PBKDF2-SHA256
export const MIN_PASSWORD_LENGTH = 8;

const AAD_SECRET = 'celari/secret/v1';
const AAD_DB = 'celari/db/v1';

export type Secret =
  | { kind: 'seed'; phrase: string }
  | { kind: 'ufvk'; ufvk: string };

export interface EncryptedBlob {
  iv: string;
  ct: string;
}

export interface VaultRecord {
  v: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  secret: EncryptedBlob;
}

export class WrongPasswordError extends Error {
  constructor() {
    super('wrong password');
    this.name = 'WrongPasswordError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
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
): Promise<{ record: VaultRecord; key: CryptoKey }> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error('password too short');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, iterations);
  const sealed = await seal(key, encoder.encode(JSON.stringify(secret)), AAD_SECRET);
  return {
    record: {
      v: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
      secret: sealed,
    },
    key,
  };
}

/** Derives the key from the password and decrypts the secret. Throws WrongPasswordError on mismatch. */
export async function unlockVault(
  record: VaultRecord,
  password: string,
): Promise<{ secret: Secret; key: CryptoKey }> {
  const key = await deriveKey(password, fromBase64(record.kdf.salt), record.kdf.iterations);
  let plaintext: Uint8Array;
  try {
    plaintext = await open(key, record.secret, AAD_SECRET);
  } catch {
    throw new WrongPasswordError();
  }
  return { secret: JSON.parse(decoder.decode(plaintext)) as Secret, key };
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
