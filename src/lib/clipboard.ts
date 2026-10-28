// Copying, and clearing a copied viewing key from the clipboard again.
//
// The clear is best effort, and the UI says so. Browsers let a page write the
// clipboard only while it has focus (Firefox and Safari only during a click
// or key press), so a clear that falls due while the tab is in the background
// waits for the next focus or input. Without the read permission, which
// Celari does not ask for, a page cannot see what the clipboard holds either.
// It knows only of its own writes and of copies made in its own page; either
// one means the clipboard now holds something else, and cancels the clear.
// A copy made in another app cannot be seen, so that may be what is cleared.
//
// A pending clear outlives a reload (locking reloads the page) through
// sessionStorage, which holds only its deadline.

export const CLEAR_AFTER_MS = 60_000;
const KEY = 'celari.clipboardClear';
/** Marks an element (the viewing key) whose text, copied by hand, is cleared like a Copy button's. */
const CLEAR_ATTR = 'data-clipboard-clear';

export type ClearStatus = 'idle' | 'pending' | 'cleared';

export interface ClipboardEnv {
  write(text: string): Promise<void>;
  hasFocus(): boolean;
  now(): number;
  /** Where a pending clear outlives a reload; null where storage is blocked. */
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

export class ClipboardGuard {
  private deadline: number | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private clearing = false;
  private status: ClearStatus = 'idle';
  private listeners = new Set<() => void>();

  constructor(private readonly env: ClipboardEnv) {
    const saved = Number(this.load());
    if (Number.isInteger(saved) && saved > 0) this.schedule(saved);
  }

  getStatus = (): ClearStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Writes `text`; with `clearAfter` the clipboard is cleared again CLEAR_AFTER_MS later. */
  async copy(text: string, { clearAfter = false } = {}): Promise<void> {
    await this.env.write(text);
    if (clearAfter) this.schedule(this.env.now() + CLEAR_AFTER_MS);
    else this.cancel();
  }

  /** A copy made in the page by hand; `ofCleared` if it copied text marked with CLEAR_ATTR. */
  copiedInPage(ofCleared: boolean): void {
    if (ofCleared) this.schedule(this.env.now() + CLEAR_AFTER_MS);
    else this.cancel();
  }

  /** Clears the clipboard if a clear is due and the browser lets it; its timer, focus and input call this. */
  async tryClear(): Promise<void> {
    const due = this.deadline;
    if (due === null || this.clearing || this.env.now() < due || !this.env.hasFocus()) return;
    this.clearing = true;
    try {
      await this.env.write('');
    } catch {
      // Refused (no focus, or no click or key press): the next focus or input tries again.
      return;
    } finally {
      this.clearing = false;
    }
    // Something was copied while the write ran; that copy decides.
    if (this.deadline !== due) return;
    this.deadline = null;
    this.save(null);
    this.setStatus('cleared');
  }

  private schedule(at: number) {
    this.deadline = at;
    this.save(at);
    this.setStatus('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tryClear(), Math.max(0, at - this.env.now()));
  }

  private cancel() {
    clearTimeout(this.timer);
    if (this.deadline !== null) this.save(null);
    this.deadline = null;
    this.setStatus('idle');
  }

  private setStatus(status: ClearStatus) {
    if (status === this.status) return;
    this.status = status;
    this.listeners.forEach((l) => l());
  }

  private load(): string | null {
    try {
      return this.env.storage?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  }

  private save(deadline: number | null) {
    try {
      if (deadline === null) this.env.storage?.removeItem(KEY);
      else this.env.storage?.setItem(KEY, String(deadline));
    } catch {
      // Storage blocked: the clear still runs in this page, it just does not outlive a reload.
    }
  }
}

function sessionStore(): ClipboardEnv['storage'] {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export const clipboard = new ClipboardGuard({
  write: (text) => navigator.clipboard.writeText(text),
  hasFocus: () => document.hasFocus(),
  now: () => Date.now(),
  storage: sessionStore(),
});

/** Retries a due clear on focus and input, and watches copies made in the page. Returns the cleanup. */
export function watchClipboard(guard: ClipboardGuard = clipboard): () => void {
  const retry = () => void guard.tryClear();
  // Not on a copy shortcut: the clear would race the copy it should give way to.
  const onKey = (e: KeyboardEvent) => {
    if (!e.ctrlKey && !e.metaKey) retry();
  };
  const onCopy = () => {
    const selection = document.getSelection();
    const node = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).commonAncestorContainer : null;
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    guard.copiedInPage(el?.closest(`[${CLEAR_ATTR}]`) != null);
  };
  window.addEventListener('focus', retry);
  window.addEventListener('pointerdown', retry, true);
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('visibilitychange', retry);
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCopy);
  return () => {
    window.removeEventListener('focus', retry);
    window.removeEventListener('pointerdown', retry, true);
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', retry);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCopy);
  };
}
