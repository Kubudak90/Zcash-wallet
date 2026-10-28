import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decodeLightdInfo,
  fetchLightdInfo,
  grpcWebMessages,
  networkStatusFor,
  type LightdInfo,
} from '../../src/engine/lightd';
import { WEBZJS_UPGRADES } from '../../src/engine/webzjs-upgrades';

// GetLightdInfo as zcash-mainnet.chainsafe.dev answered it over gRPC-web on
// 2026-10-28, after NU6.3 (Ironwood) and before NU7: the whole HTTP body, one
// message frame and the trailer frame.
const CAPTURED = new Uint8Array(readFileSync(new URL('../fixtures/lightdinfo.bin', import.meta.url)));

/** A gRPC-web frame: flag byte, 4-byte big-endian length, payload. */
function frame(flag: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = flag;
  new DataView(out.buffer).setUint32(1, payload.length);
  out.set(payload, 5);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const varint = (n: number): number[] => {
  const out: number[] = [];
  do {
    const low = n % 128;
    n = Math.floor(n / 128);
    out.push(n > 0 ? low | 0x80 : low);
  } while (n > 0);
  return out;
};
const str = (field: number, s: string) => {
  const bytes = new TextEncoder().encode(s);
  return [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];
};
const num = (field: number, n: number) => [...varint(field * 8), ...varint(n)];
const trailer = (status: number) => frame(0x80, new TextEncoder().encode(`grpc-status:${status}\r\n`));

const info = (patch: Partial<LightdInfo>): LightdInfo => ({
  version: 'v0.5.3',
  vendor: 'ECC LightWalletD',
  chainName: 'main',
  consensusBranchId: '4dec4df0',
  blockHeight: 3_300_000,
  upgradeName: '',
  upgradeHeight: 0,
  ...patch,
});

describe('GetLightdInfo decoding', () => {
  it('reads the captured mainnet answer', () => {
    const messages = grpcWebMessages(CAPTURED);
    expect(messages).toHaveLength(1);
    expect(decodeLightdInfo(messages[0]!)).toEqual({
      version: 'v0.5.3',
      vendor: 'ECC LightWalletD',
      chainName: 'main',
      consensusBranchId: '37a5165b',
      blockHeight: 3_533_505,
      upgradeName: 'NU7',
      upgradeHeight: 3_543_405,
    });
  });

  it('skips fields it does not read, of every wire type', () => {
    const message = new Uint8Array([
      ...num(3, 1), // taddrSupport
      ...varint((20 << 3) | 1), 1, 2, 3, 4, 5, 6, 7, 8, // a fixed64 from a newer protocol
      ...varint((21 << 3) | 5), 1, 2, 3, 4, // a fixed32
      ...str(8, 'deadbeef'), // gitCommit
      ...str(6, '4DEC4DF0'),
      ...num(7, 2 ** 40), // heights are uint64; nothing is lost past 32 bits
    ]);
    expect(decodeLightdInfo(message)).toMatchObject({ consensusBranchId: '4dec4df0', blockHeight: 2 ** 40 });
  });

  it('refuses truncated or malformed messages instead of reading garbage', () => {
    const whole = new Uint8Array([...str(4, 'main'), ...num(7, 3_533_505)]);
    for (let cut = 1; cut < whole.length; cut++) {
      if (cut === str(4, 'main').length) continue; // a clean field boundary
      expect(() => decodeLightdInfo(whole.subarray(0, cut)), `cut at ${cut}`).toThrow(/truncated/);
    }
    expect(() => decodeLightdInfo(new Uint8Array([(9 << 3) | 1, 1, 2, 3]))).toThrow(/truncated/);
    expect(() => decodeLightdInfo(new Uint8Array([(9 << 3) | 5, 1, 2, 3]))).toThrow(/truncated/);
    expect(() => decodeLightdInfo(new Uint8Array([(9 << 3) | 3]))).toThrow(/wire type 3/);
    expect(() => decodeLightdInfo(new Uint8Array([...varint(4 * 8 + 2), 2, 0xff, 0xfe]))).toThrow();
    expect(() => decodeLightdInfo(new Uint8Array(11).fill(0x80))).toThrow(/varint/);
  });

  it('splits frames and fails on a non-zero gRPC status or compression', () => {
    const message = new Uint8Array(str(4, 'main'));
    expect(grpcWebMessages(concat(frame(0, message), trailer(0)))).toEqual([message]);
    expect(grpcWebMessages(trailer(0))).toEqual([]);
    expect(() => grpcWebMessages(concat(frame(0, message), trailer(14)))).toThrow(/gRPC status 14/);
    expect(() => grpcWebMessages(frame(1, message))).toThrow(/compressed/);
    expect(() => grpcWebMessages(CAPTURED.subarray(0, 100))).toThrow(/truncated/);
    expect(() => grpcWebMessages(CAPTURED.subarray(0, 3))).toThrow(/truncated/);
  });
});

describe('fetchLightdInfo', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: Uint8Array, init: ResponseInit = {}) => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(body, { headers: { 'content-type': 'application/grpc-web' }, ...init }),
    );
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('makes one strict gRPC-web call and decodes the answer', async () => {
    const fetch = respond(CAPTURED);
    const result = await fetchLightdInfo('https://zcash-mainnet.chainsafe.dev/');
    expect(result.consensusBranchId).toBe('37a5165b');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://zcash-mainnet.chainsafe.dev/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(init.body).toEqual(new Uint8Array(5));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails on anything that is not a successful gRPC-web answer', async () => {
    respond(CAPTURED, { status: 502 });
    await expect(fetchLightdInfo('https://x.example')).rejects.toThrow(/HTTP 502/);
    respond(new TextEncoder().encode('<html>'), { headers: { 'content-type': 'text/html' } });
    await expect(fetchLightdInfo('https://x.example')).rejects.toThrow(/content type/);
    respond(new Uint8Array(), { headers: { 'content-type': 'application/grpc-web+proto', 'grpc-status': '12' } });
    await expect(fetchLightdInfo('https://x.example')).rejects.toThrow(/gRPC status 12/);
    respond(trailer(0));
    await expect(fetchLightdInfo('https://x.example')).rejects.toThrow(/empty response/);
    respond(frame(0, new Uint8Array(70_000)));
    await expect(fetchLightdInfo('https://x.example')).rejects.toThrow(/larger than/);
  });
});

describe('WebZjs network support', () => {
  const status = (patch: Partial<LightdInfo>) => networkStatusFor(info(patch), WEBZJS_UPGRADES, 'main');

  it('does not support the network the captured answer describes (NU6.3), nor the NU7 it announces', () => {
    const live = decodeLightdInfo(grpcWebMessages(CAPTURED)[0]!);
    expect(networkStatusFor(live, WEBZJS_UPGRADES, 'main')).toEqual({
      branchId: '37a5165b',
      height: 3_533_505,
      supported: false,
      upcoming: { name: 'NU7', height: 3_543_405, supported: false },
    });
  });

  it('supports the rules it expects at the tip, and only those', () => {
    expect(status({})).toEqual({ branchId: '4dec4df0', height: 3_300_000, supported: true });
    // NU6.2, newer than the engine.
    expect(status({ consensusBranchId: '5437f330', blockHeight: 3_364_600 }).supported).toBe(false);
    // A node still on NU6 after NU6.1 activated is on another chain.
    expect(status({ consensusBranchId: 'c8e71055' }).supported).toBe(false);
    // Just before NU6.1 activates, NU6 is right.
    expect(status({ consensusBranchId: 'c8e71055', blockHeight: 3_146_399 }).supported).toBe(true);
    expect(status({ consensusBranchId: '4dec4df0', blockHeight: 3_146_399 }).supported).toBe(false);
  });

  it('says whether an announced upgrade is one it knows, at that height', () => {
    const before = { consensusBranchId: 'c8e71055', blockHeight: 3_140_000 };
    expect(status({ ...before, upgradeName: 'NU6.1', upgradeHeight: 3_146_400 }).upcoming).toEqual({
      name: 'NU6.1',
      height: 3_146_400,
      supported: true,
    });
    expect(status({ ...before, upgradeName: 'NU6.1', upgradeHeight: 3_150_000 }).upcoming?.supported).toBe(false);
    expect(status({ upgradeName: 'NU7', upgradeHeight: 3_543_405 }).upcoming?.supported).toBe(false);
    // An upgrade already behind the tip, or none, is not upcoming.
    expect(status({ upgradeName: 'NU6.1', upgradeHeight: 3_146_400 }).upcoming).toBeUndefined();
    expect(status({ upgradeName: '', upgradeHeight: 0 }).upcoming).toBeUndefined();
  });

  it('refuses an answer it cannot judge', () => {
    expect(() => status({ chainName: 'test' })).toThrow(/chain "test"/);
    expect(() => status({ consensusBranchId: '' })).toThrow(/branch id/);
    expect(() => status({ blockHeight: 0 })).toThrow(/block height/);
  });
});
