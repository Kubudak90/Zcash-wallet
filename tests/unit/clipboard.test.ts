import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLEAR_AFTER_MS, ClipboardGuard, type ClipboardEnv } from '../../src/lib/clipboard';

const KEY = 'uview1secret';

/** A clipboard, focus and sessionStorage the test controls. */
function fakeEnv(saved: Record<string, string> = {}) {
  const store = new Map(Object.entries(saved));
  const env = {
    clipboard: '',
    focused: true,
    /** When set, writes are refused, as without focus or a click. */
    refuse: false,
    writes: [] as string[],
    store,
    write: async (text: string) => {
      if (env.refuse) throw new DOMException('Document is not focused.', 'NotAllowedError');
      env.writes.push(text);
      env.clipboard = text;
    },
    hasFocus: () => env.focused,
    now: () => Date.now(),
    storage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  return env satisfies ClipboardEnv;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => vi.useRealTimers());

describe('ClipboardGuard', () => {
  it('clears a copied viewing key a minute later', async () => {
    const env = fakeEnv();
    const guard = new ClipboardGuard(env);
    await guard.copy(KEY, { clearAfter: true });
    expect(env.clipboard).toBe(KEY);
    expect(guard.getStatus()).toBe('pending');

    await vi.advanceTimersByTimeAsync(CLEAR_AFTER_MS - 1);
    expect(env.clipboard).toBe(KEY);
    await vi.advanceTimersByTimeAsync(1);
    expect(env.clipboard).toBe('');
    expect(guard.getStatus()).toBe('cleared');
    // The saved deadline holds only a time, and is gone once cleared.
    expect(env.store.size).toBe(0);
  });

  it('leaves other copies alone', async () => {
    const env = fakeEnv();
    const guard = new ClipboardGuard(env);
    await guard.copy('u1address');
    await vi.advanceTimersByTimeAsync(10 * CLEAR_AFTER_MS);
    expect(env.writes).toEqual(['u1address']);
    expect(guard.getStatus()).toBe('idle');
  });

  it('waits for focus when the clear falls due in the background', async () => {
    const env = fakeEnv();
    const guard = new ClipboardGuard(env);
    await guard.copy(KEY, { clearAfter: true });
    env.focused = false;
    await vi.advanceTimersByTimeAsync(5 * CLEAR_AFTER_MS);
    expect(env.clipboard).toBe(KEY);

    env.focused = true;
    await guard.tryClear(); // the focus event
    expect(env.clipboard).toBe('');
  });

  it('tries again on the next focus or input when the browser refuses', async () => {
    const env = fakeEnv();
    const guard = new ClipboardGuard(env);
    await guard.copy(KEY, { clearAfter: true });
    env.refuse = true;
    await vi.advanceTimersByTimeAsync(CLEAR_AFTER_MS);
    expect(guard.getStatus()).toBe('pending');

    env.refuse = false;
    await guard.tryClear(); // a click
    expect(env.clipboard).toBe('');
    expect(guard.getStatus()).toBe('cleared');
  });

  it('does not clear early', async () => {
    const env = fakeEnv();
    const guard = new ClipboardGuard(env);
    await guard.copy(KEY, { clearAfter: true });
    await guard.tryClear(); // a focus right after copying
    expect(env.clipboard).toBe(KEY);
  });

  it('gives way to anything copied since, by a Copy button or by hand', async () => {
    const env = fakeEnv();
    const guard = new ClipboardGuard(env);
    await guard.copy(KEY, { clearAfter: true });
    await guard.copy('u1address');
    await vi.advanceTimersByTimeAsync(2 * CLEAR_AFTER_MS);
    expect(env.clipboard).toBe('u1address');

    await guard.copy(KEY, { clearAfter: true });
    guard.copiedInPage(false);
    await vi.advanceTimersByTimeAsync(2 * CLEAR_AFTER_MS);
    expect(env.writes.at(-1)).toBe(KEY);
    expect(guard.getStatus()).toBe('idle');
    expect(env.store.size).toBe(0);
  });

  it('counts a minute from the last copy of the key, by hand too', async () => {
    const env = fakeEnv();
    const guard = new ClipboardGuard(env);
    await guard.copy(KEY, { clearAfter: true });
    await vi.advanceTimersByTimeAsync(CLEAR_AFTER_MS / 2);
    guard.copiedInPage(true);
    await vi.advanceTimersByTimeAsync(CLEAR_AFTER_MS / 2);
    expect(env.clipboard).toBe(KEY);
    await vi.advanceTimersByTimeAsync(CLEAR_AFTER_MS / 2);
    expect(env.clipboard).toBe('');
  });

  it('carries a pending clear across a reload', async () => {
    const before = fakeEnv();
    await new ClipboardGuard(before).copy(KEY, { clearAfter: true });
    const saved = Object.fromEntries(before.store);
    expect(Object.values(saved)).toEqual([String(Date.now() + CLEAR_AFTER_MS)]);

    // The reloaded page, 70 s later: the clear is overdue and runs at once.
    vi.setSystemTime(Date.now() + 70_000);
    const after = fakeEnv(saved);
    after.clipboard = KEY;
    const guard = new ClipboardGuard(after);
    expect(guard.getStatus()).toBe('pending');
    await vi.advanceTimersByTimeAsync(0);
    expect(after.clipboard).toBe('');
    expect(after.store.size).toBe(0);
  });

  it('names what the pending clear is for, and tells its listeners when that changes (VAULT-4)', async () => {
    const env = fakeEnv();
    const guard = new ClipboardGuard(env);
    let told = 0;
    guard.subscribe(() => told++);
    await guard.copy(KEY, { clearAfter: true, source: 'viewing-key' });
    expect([guard.getStatus(), guard.getSource()]).toEqual(['pending', 'viewing-key']);
    const before = told;
    // The phrase copied by hand while the key's clear is pending: still pending, for the phrase.
    guard.copiedInPage(true, 'seed');
    expect([guard.getStatus(), guard.getSource()]).toEqual(['pending', 'seed']);
    expect(told).toBeGreaterThan(before);
    await vi.advanceTimersByTimeAsync(CLEAR_AFTER_MS);
    expect(env.clipboard).toBe('');
    expect([guard.getStatus(), guard.getSource()]).toEqual(['cleared', 'seed']);
  });
});
