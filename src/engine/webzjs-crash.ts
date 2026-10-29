// Noticing that the WebZjs engine stopped (verifier finding M1).
//
// A WebAssembly trap (`unreachable` after a Rust panic or a failed allocation once the 1 GiB
// memory is used up, an out-of-bounds access) kills the thread it happens on. When that is one
// of the engine's worker threads, which is where a sync pass and its rayon pool run, nothing
// rejects the promise the page is waiting on: the sync call never settles and the app would show
// "Syncing" forever. The trap reaches the page as an `error` event (an uncaught error in a worker
// is reported to the page that owns it) or an `unhandledrejection` with a WebAssembly
// RuntimeError. The engine's state in shared memory is then unknown (a lock may be held by the
// dead thread), so nothing of it may be used or saved any more.

import { EngineStoppedError } from './types';

/**
 * A WebAssembly trap as an error message: its type (an uncaught error from a worker reaches the
 * page as text, "Uncaught RuntimeError: unreachable" in Chromium) or the trap's own wording in
 * Firefox and Safari. Not "unreachable" alone: network errors use that word too.
 */
const TRAP = /\bRuntimeError\b|unreachable (code )?(executed|should not be executed)|memory access out of bounds/i;

/** Whether an error event's payload, or a rejection reason, is a WebAssembly trap. */
export function isWasmTrap(x: unknown): boolean {
  if (typeof WebAssembly !== 'undefined' && x instanceof WebAssembly.RuntimeError) return true;
  if (x instanceof Error) return x.name === 'RuntimeError' || TRAP.test(x.message);
  if (typeof x === 'string') return TRAP.test(x);
  return false;
}

/** The parts of an `error` or `unhandledrejection` event that can say what failed. */
function payload(event: Event): unknown[] {
  const e = event as Event & { error?: unknown; message?: unknown; reason?: unknown };
  return [e.error, e.message, e.reason];
}

/**
 * Watches `target` (the page's window) for a trap of the engine. Once one happened, `check()`
 * throws and every promise passed through `guard()` rejects with the same EngineStoppedError.
 */
export class CrashWatch {
  private error: EngineStoppedError | null = null;
  private listeners: ((e: EngineStoppedError) => void)[] = [];
  private rejectWaiting: ((e: EngineStoppedError) => void)[] = [];

  constructor(target: EventTarget | null) {
    const onEvent = (event: Event) => {
      const found = payload(event).find(isWasmTrap);
      if (found !== undefined) this.stop(found);
    };
    target?.addEventListener('error', onEvent);
    target?.addEventListener('unhandledrejection', onEvent);
  }

  /** The error the engine stopped with, or null while it runs. */
  get stopped(): EngineStoppedError | null {
    return this.error;
  }

  /** Records the trap (once) and fails what was waiting. */
  stop(cause: unknown): void {
    if (this.error) return;
    const error = new EngineStoppedError({ cause });
    this.error = error;
    console.error('the wallet engine stopped', cause);
    for (const reject of this.rejectWaiting.splice(0)) reject(error);
    for (const listener of this.listeners.splice(0)) listener(error);
  }

  onStopped(listener: (e: EngineStoppedError) => void): void {
    if (this.error) listener(this.error);
    else this.listeners.push(listener);
  }

  /** Throws once the engine has stopped. */
  check(): void {
    if (this.error) throw this.error;
  }

  /** `promise`, unless the engine stops first: then the EngineStoppedError. */
  guard<T>(promise: Promise<T>): Promise<T> {
    if (this.error) return Promise.reject(this.error);
    return new Promise<T>((resolve, reject) => {
      const onStop = (e: EngineStoppedError) => reject(e);
      this.rejectWaiting.push(onStop);
      const done = () => {
        const i = this.rejectWaiting.indexOf(onStop);
        if (i >= 0) this.rejectWaiting.splice(i, 1);
      };
      promise.then(
        (v) => {
          done();
          resolve(v);
        },
        (e) => {
          done();
          reject(e);
        },
      );
    });
  }
}
