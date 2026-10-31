// The lightwalletd address typed in Settings, in the one form Celari stores and compares.

/**
 * `value` as a server address: https, no user name or password, no query and no fragment, without
 * a trailing slash; null for anything else (review round 8, A-4). Celari appends gRPC-web paths
 * to it (engine/lightd.ts, WebZjs), so with "#x" or "?x" every request went to the server's root
 * and failed, and an address typed with a space or a trailing slash read as another server than
 * the same one saved, which asked to trust it again.
 */
export function normalizeServerUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  // A bare "?" or "#" leaves search and hash empty but stays in the text: rebuilt without them.
  if (/[?#]/.test(value)) return null;
  return url.origin + url.pathname.replace(/\/+$/, '');
}
