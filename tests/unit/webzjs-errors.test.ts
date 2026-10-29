import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { NewerDatabaseFormatError, OldDatabaseFormatError } from '../../src/engine/types';
import { openError } from '../../src/engine/webzjs-errors';

// What `new WebWallet('main', …, db)` of the vendored build threw in Chromium for each kind of
// blob (engine-port smoke/errors-run.mjs, logs/round4/errors.json): plain Errors, message only.
const MEASURED = {
  oldProtobuf:
    'Memory client error: Unsupported wallet data format (version None); the wallet must be rebuilt and rescanned',
  newerVersion:
    'Memory client error: Unsupported wallet data format (version Some(2)); the wallet must be rebuilt and rescanned',
  truncated: 'Memory client error: Corrupted Data: wallet data: unexpected end of data',
  otherNetwork: 'Memory client error: Corrupted Data: the stored wallet belongs to a different network',
  bitFlip: 'Memory client error: Corrupted Data: wallet data: invalid account id',
};

describe('openError', () => {
  it('reads an old-format database (the WebZjs before the port) as OldDatabaseFormatError', () => {
    const cause = new Error(MEASURED.oldProtobuf);
    const e = openError(cause);
    expect(e).toBeInstanceOf(OldDatabaseFormatError);
    expect((e as Error).cause).toBe(cause);
  });

  it('reads a database of a newer format version as NewerDatabaseFormatError, never as old', () => {
    expect(openError(new Error(MEASURED.newerVersion))).toBeInstanceOf(NewerDatabaseFormatError);
    expect(openError(new Error(MEASURED.newerVersion.replace('Some(2)', 'Some(17)')))).toBeInstanceOf(
      NewerDatabaseFormatError,
    );
  });

  it('leaves every other error as it is, so the database is kept', () => {
    for (const message of [MEASURED.truncated, MEASURED.otherNetwork, MEASURED.bitFlip]) {
      const e = new Error(message);
      expect(openError(e)).toBe(e);
    }
    for (const e of [new RangeError('Out of memory'), new WebAssembly.RuntimeError('unreachable'), null, undefined, 42]) {
      expect(openError(e)).toBe(e);
    }
    // The words alone are not enough: only the engine's sentence with its version.
    const loose = new Error('Unsupported wallet data format');
    expect(openError(loose)).toBe(loose);
  });

  it('matches a string thrown as is', () => {
    expect(openError(MEASURED.oldProtobuf)).toBeInstanceOf(OldDatabaseFormatError);
  });
});

// The matcher depends on the engine's wording; the engine source ships in this repository
// (engine/zcash_client_memory, PORT-NOTES Decision 1), so a change there fails here first.
describe('the engine source still says what openError matches', () => {
  const src = (file: string) =>
    readFileSync(new URL(`../../engine/zcash_client_memory/src/${file}`, import.meta.url), 'utf8');

  it('names UnsupportedFormat with its optional version', () => {
    expect(src('error.rs')).toContain(
      '#[error("Unsupported wallet data format (version {0:?}); the wallet must be rebuilt and rescanned")]\n    UnsupportedFormat(Option<u32>),',
    );
  });

  it('refuses a blob without its magic as version None, and another version with Some', () => {
    const s = src('serialization.rs');
    expect(s).toContain('pub const FORMAT_VERSION: u32 = 1;');
    expect(s).toMatch(/if &magic != MAGIC \{\s*return Err\(Error::UnsupportedFormat\(None\)\);/);
    expect(s).toMatch(/if version != FORMAT_VERSION \{\s*return Err\(Error::UnsupportedFormat\(Some\(version\)\)\);/);
  });
});
