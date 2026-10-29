// Verifier finding M1 (app side): a trap of the engine's WebAssembly must end the waiting call
// instead of leaving the app on "Syncing" forever.
import { describe, expect, it, vi } from 'vitest';

import { EngineStoppedError } from '../../src/engine/types';
import { CrashWatch, isWasmTrap } from '../../src/engine/webzjs-crash';

/** An `error` event as the page receives it for an uncaught error in a worker (no error object). */
const errorEvent = (message: string) => Object.assign(new Event('error'), { message, error: null });
const rejection = (reason: unknown) => Object.assign(new Event('unhandledrejection'), { reason });

describe('isWasmTrap', () => {
  it('knows a trap by its type or its message in each browser', () => {
    expect(isWasmTrap(new WebAssembly.RuntimeError('unreachable'))).toBe(true);
    // Chromium, measured in round 4's verification (a spam-era batch filled the 1 GiB memory):
    // "Worker unhandled rejection: RuntimeError: unreachable", then two page errors.
    expect(isWasmTrap('Uncaught RuntimeError: unreachable')).toBe(true);
    expect(isWasmTrap('RuntimeError: unreachable executed')).toBe(true); // Firefox
    expect(isWasmTrap('Unreachable code should not be executed')).toBe(true); // Safari
    expect(isWasmTrap('RuntimeError: memory access out of bounds')).toBe(true);
    expect(isWasmTrap(Object.assign(new Error('unreachable'), { name: 'RuntimeError' }))).toBe(true);
  });

  it('is not fooled by network errors or ordinary failures', () => {
    expect(isWasmTrap(new TypeError('Failed to fetch'))).toBe(false);
    expect(isWasmTrap('net::ERR_ADDRESS_UNREACHABLE')).toBe(false);
    expect(isWasmTrap(new Error('transport error: host unreachable'))).toBe(false);
    expect(isWasmTrap(new Error('fake pass failure'))).toBe(false);
    expect(isWasmTrap(undefined)).toBe(false);
    expect(isWasmTrap(null)).toBe(false);
  });
});

describe('CrashWatch', () => {
  it('ends a call that would never settle once the page sees a trap, and every later call', async () => {
    const page = new EventTarget();
    const watch = new CrashWatch(page);
    const listener = vi.fn();
    watch.onStopped(listener);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const pass = watch.guard(new Promise<void>(() => {})); // a sync whose worker died
    const done = watch.guard(Promise.resolve(7));
    await expect(done).resolves.toBe(7);
    page.dispatchEvent(errorEvent('Uncaught RuntimeError: unreachable'));

    await expect(pass).rejects.toBeInstanceOf(EngineStoppedError);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(watch.stopped).toBeInstanceOf(EngineStoppedError);
    expect(() => watch.check()).toThrow(EngineStoppedError);
    await expect(watch.guard(Promise.resolve(1))).rejects.toBeInstanceOf(EngineStoppedError);
    // A second trap changes nothing; a listener added late hears of it at once.
    page.dispatchEvent(rejection(new WebAssembly.RuntimeError('unreachable')));
    expect(listener).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    watch.onStopped(late);
    expect(late).toHaveBeenCalledWith(watch.stopped);
  });

  it('ignores errors that are not traps', async () => {
    const page = new EventTarget();
    const watch = new CrashWatch(page);
    page.dispatchEvent(errorEvent('Uncaught TypeError: x is undefined'));
    page.dispatchEvent(rejection(new Error('fake pass failure')));
    expect(watch.stopped).toBeNull();
    await expect(watch.guard(Promise.resolve('ok'))).resolves.toBe('ok');
    await expect(watch.guard(Promise.reject(new Error('server')))).rejects.toThrow('server');
  });
});
