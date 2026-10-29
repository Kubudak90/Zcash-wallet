// Which errors of the vendored WebZjs mean what. Kept apart from the adapter
// (./webzjs.ts), which loads the wasm packages, so the rules can be unit-tested.
//
// WebZjs hands errors to JavaScript as plain Error objects whose message is the
// Rust error's Display text (webzjs-wallet error.rs: `js_sys::Error::new(&e.to_string())`),
// so the message is all there is to match. The texts come from
// engine/zcash_client_memory/src/error.rs (`Error::UnsupportedFormat(Option<u32>)`), and
// tests/unit/webzjs-errors.test.ts checks that source still says them.

import { NewerDatabaseFormatError, OldDatabaseFormatError } from './types';

/**
 * `MemoryWalletDb::decode_new` (serialization.rs) refuses a blob that does not start
 * with its magic as UnsupportedFormat(None): the protobuf format the WebZjs before the
 * port wrote. A blob with the magic but another format version is UnsupportedFormat(Some(v)):
 * version 1 is the first of this format, so any other comes from a newer build.
 */
const UNSUPPORTED_FORMAT = /Unsupported wallet data format \(version (None|Some\((\d+)\))\)/;

/** What an error from `new WebWallet(…, db)` means for Celari; other errors come back unchanged. */
export function openError(e: unknown): unknown {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : null;
  const match = message === null ? null : UNSUPPORTED_FORMAT.exec(message);
  if (!match) return e;
  return match[1] === 'None' ? new OldDatabaseFormatError({ cause: e }) : new NewerDatabaseFormatError({ cause: e });
}
