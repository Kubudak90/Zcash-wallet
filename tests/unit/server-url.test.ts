import { describe, expect, it } from 'vitest';

import { normalizeServerUrl } from '../../src/lib/serverUrl';

// Review round 8, A-4: the server address was checked for https only, and compared and saved as typed.
describe('normalizeServerUrl', () => {
  it.each([
    ['https://zcash-mainnet.chainsafe.dev', 'https://zcash-mainnet.chainsafe.dev'],
    ['  https://zcash-mainnet.chainsafe.dev/  ', 'https://zcash-mainnet.chainsafe.dev'],
    ['HTTPS://Lightd.Example.COM:443/', 'https://lightd.example.com'],
    ['https://lightd.example.com:9067', 'https://lightd.example.com:9067'],
    ['https://example.com/lightwalletd//', 'https://example.com/lightwalletd'],
  ])('keeps %j as %j', (input, want) => {
    expect(normalizeServerUrl(input)).toBe(want);
  });

  it.each([
    'http://lightd.example.com',
    'lightd.example.com',
    '',
    'https://lightd.example.com/#x',
    'https://lightd.example.com/#',
    'https://lightd.example.com/?a=1',
    'https://lightd.example.com/?',
    'https://user@lightd.example.com',
    'https://user:pass@lightd.example.com',
  ])('refuses %j', (input) => {
    expect(normalizeServerUrl(input)).toBeNull();
  });

  it('gives the default server as it is stored, so it is never taken for another one', () => {
    // src/lib/storage.ts DEFAULT_SERVER (storage opens IndexedDB, which the unit tests lack).
    const DEFAULT_SERVER = 'https://zcash-mainnet.chainsafe.dev';
    expect(normalizeServerUrl(` ${DEFAULT_SERVER}/ `)).toBe(DEFAULT_SERVER);
  });
});
