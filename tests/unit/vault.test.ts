import { describe, expect, it } from 'vitest';

import { fromBase64, toBase64 } from '../../src/lib/bytes';
import {
  UnsupportedVaultError,
  VAULT_WRITE_VERSION,
  WrongPasswordError,
  createVault,
  decryptDb,
  encryptDb,
  passwordStrength,
  unlockVault,
  type EncryptedBlob,
  type VaultRecord,
} from '../../src/lib/vault';

// Low iteration count keeps the tests fast; production uses KDF_ITERATIONS.
const FAST = 1_000;
const phrase =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

describe('vault', () => {
  it('round-trips the secret with the right password', async () => {
    const { record } = await createVault('correct horse', { kind: 'seed', phrase }, FAST);
    const { secret } = await unlockVault(record, 'correct horse');
    expect(secret).toEqual({ kind: 'seed', phrase });
  });

  it('does not store the secret in plaintext', async () => {
    const { record } = await createVault('correct horse', { kind: 'seed', phrase }, FAST);
    expect(JSON.stringify(record)).not.toContain('abandon');
  });

  it('rejects a wrong password', async () => {
    const { record } = await createVault('correct horse', { kind: 'ufvk', ufvk: 'uview1xyz' }, FAST);
    await expect(unlockVault(record, 'wrong horse')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('rejects short passwords', async () => {
    await expect(createVault('short', { kind: 'seed', phrase }, FAST)).rejects.toThrow();
  });

  it('uses a fresh salt and IV each time', async () => {
    const a = await createVault('correct horse', { kind: 'seed', phrase }, FAST);
    const b = await createVault('correct horse', { kind: 'seed', phrase }, FAST);
    expect(a.record.kdf.salt).not.toBe(b.record.kdf.salt);
    expect(a.record.secret.iv).not.toBe(b.record.secret.iv);
  });

  it('encrypts the wallet database with the unlocked key', async () => {
    const { record, key } = await createVault('correct horse', { kind: 'seed', phrase }, FAST);
    const db = new Uint8Array([1, 2, 3, 250, 251, 252]);
    const blob = await encryptDb(key, db);

    const unlocked = await unlockVault(record, 'correct horse');
    expect(await decryptDb(unlocked.key, blob)).toEqual(db);
  });

  it('refuses to open a database blob in the secret slot', async () => {
    const { record, key } = await createVault('correct horse', { kind: 'seed', phrase }, FAST);
    const swapped = { ...record, secret: await encryptDb(key, new TextEncoder().encode('{}')) };
    await expect(unlockVault(swapped, 'correct horse')).rejects.toBeInstanceOf(WrongPasswordError);
  });
});

const enc = new TextEncoder();

/** The vault code before review round 7: one PBKDF2 deriveKey for the secret and the database. */
async function vaultV1(password: string, plaintext: string, db: Uint8Array) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: FAST },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const seal = async (bytes: Uint8Array, aad: string): Promise<EncryptedBlob> => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, bytes);
    return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
  };
  const record: VaultRecord = {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: FAST, salt: toBase64(salt) },
    secret: await seal(enc.encode(plaintext), 'celari/secret/v1'),
  };
  return { record, dbBlob: await seal(db, 'celari/db/v1') };
}

/** Opens a sealed secret with `key` directly, without the password, under either secret label. */
async function openWith(key: CryptoKey, blob: EncryptedBlob): Promise<string[]> {
  const opened: string[] = [];
  for (const aad of ['celari/secret/v1', 'celari/secret/v2']) {
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(blob.iv), additionalData: enc.encode(aad) },
        key,
        fromBase64(blob.ct),
      );
      opened.push(new TextDecoder().decode(pt));
    } catch {
      // Refused, as it should be for a version 2 vault.
    }
  }
  return opened;
}

// Review round 7, VAULT-1: the database key the controller keeps while unlocked must not
// open the stored secret. Version 2 vaults seal it under a separate HKDF key; this release
// reads them but still writes version 1, which the build deployed before it can open.
describe('vault versions', () => {
  const seed = { kind: 'seed', phrase } as const;
  const db = new Uint8Array([7, 7, 7, 0, 1, 2]);

  it('opens a version 1 vault and database written by the code before version 2', async () => {
    const { record, dbBlob } = await vaultV1('correct horse', JSON.stringify(seed), db);
    const { secret, key, upgraded } = await unlockVault(record, 'correct horse');
    expect(secret).toEqual(seed);
    expect(await decryptDb(key, dbBlob)).toEqual(db);
    expect(upgraded).toBeNull();
    await expect(unlockVault(record, 'wrong horse')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('still writes version 1, so a rollback to the build before it opens new wallets', async () => {
    expect(VAULT_WRITE_VERSION).toBe(1);
    const { record } = await createVault('correct horse', seed, FAST);
    expect(record.v).toBe(1);
  });

  it('hands out a database key that cannot open the secret of a version 2 vault', async () => {
    const created = await createVault('correct horse', seed, FAST, 2);
    expect(created.record.v).toBe(2);
    expect(await openWith(created.key, created.record.secret)).toEqual([]);

    const unlocked = await unlockVault(created.record, 'correct horse');
    expect(unlocked.secret).toEqual(seed);
    expect(unlocked.upgraded).toBeNull();
    expect(await openWith(unlocked.key, created.record.secret)).toEqual([]);
    // The two keys open the same database blobs.
    expect(await decryptDb(unlocked.key, await encryptDb(created.key, db))).toEqual(db);
    await expect(unlockVault(created.record, 'wrong horse')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('a version 1 vault (the gap) opens with its database key', async () => {
    const { record, key } = await createVault('correct horse', seed, FAST, 1);
    expect(await openWith(key, record.secret)).toEqual([JSON.stringify(seed)]);
  });

  it('upgrades a version 1 vault on unlock when told to write version 2, keeping the database key', async () => {
    const { record, dbBlob } = await vaultV1('correct horse', JSON.stringify(seed), db);
    const { key, upgraded } = await unlockVault(record, 'correct horse', 2);
    expect(upgraded).not.toBeNull();
    expect(upgraded!.v).toBe(2);
    expect(upgraded!.kdf).toEqual(record.kdf);
    // The database stays as it is: same key.
    expect(await decryptDb(key, dbBlob)).toEqual(db);
    // The upgraded secret opens with the password, not with the key that stays in memory.
    expect(await openWith(key, upgraded!.secret)).toEqual([]);
    const again = await unlockVault(upgraded!, 'correct horse', 2);
    expect(again.secret).toEqual(seed);
    expect(again.upgraded).toBeNull();
    expect(await decryptDb(again.key, dbBlob)).toEqual(db);
    // And this release, which writes version 1, still opens it (a rollback after the switch).
    expect((await unlockVault(upgraded!, 'correct horse')).secret).toEqual(seed);
  });

  it('refuses a vault version it does not know without calling it a wrong password', async () => {
    const { record } = await createVault('correct horse', seed, FAST);
    const newer = { ...record, v: 3 } as unknown as VaultRecord;
    await expect(unlockVault(newer, 'correct horse')).rejects.toBeInstanceOf(UnsupportedVaultError);
  });
});

describe('passwordStrength', () => {
  it('grades passwords', () => {
    expect(passwordStrength('abc')).toBe('weak');
    expect(passwordStrength('abcdefgh')).toBe('weak');
    expect(passwordStrength('abcdefgh12')).toBe('fair');
    expect(passwordStrength('Kırmızı-Elma-2026')).toBe('strong');
  });
});
