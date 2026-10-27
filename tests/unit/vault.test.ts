import { describe, expect, it } from 'vitest';

import {
  WrongPasswordError,
  createVault,
  decryptDb,
  encryptDb,
  passwordStrength,
  unlockVault,
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

describe('passwordStrength', () => {
  it('grades passwords', () => {
    expect(passwordStrength('abc')).toBe('weak');
    expect(passwordStrength('abcdefgh')).toBe('weak');
    expect(passwordStrength('abcdefgh12')).toBe('fair');
    expect(passwordStrength('Kırmızı-Elma-2026')).toBe('strong');
  });
});
