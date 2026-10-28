import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decodeLightdInfo,
  fetchLightdInfo,
  LAG_BLOCKS,
  grpcWebUnary,
  localStatus,
  networkStatusFor,
  type LightdInfo,
} from '../../src/engine/lightd';
import { WEBZJS_RULES, WEBZJS_UPGRADES } from '../../src/engine/webzjs-upgrades';

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
    expect(decodeLightdInfo(grpcWebUnary(CAPTURED))).toEqual({
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

  it('takes exactly one message and trailers that plainly say status 0', () => {
    const message = new Uint8Array(str(4, 'main'));
    const trailers = (text: string) => frame(0x80, new TextEncoder().encode(text));
    expect(grpcWebUnary(concat(frame(0, message), trailer(0)))).toEqual(message);
    expect(grpcWebUnary(concat(frame(0, message), trailers('GRPC-Status: 0\r\ngrpc-message: \r\n')))).toEqual(message);
    expect(() => grpcWebUnary(concat(frame(0, message), trailer(14)))).toThrow(/gRPC status 14/);
    // A failed status wins, wherever it sits.
    expect(() => grpcWebUnary(trailer(14))).toThrow(/gRPC status 14/);
    expect(() => grpcWebUnary(concat(frame(0, message), trailers('grpc-status: 0\r\ngrpc-status: 2\r\n')))).toThrow(
      /gRPC status 2/,
    );
    expect(() => grpcWebUnary(concat(frame(0, message), trailers('grpc-status: ok\r\n')))).toThrow(/gRPC status ok/);
    expect(() => grpcWebUnary(concat(frame(0, message), trailers('grpc-status: 0 1\r\n')))).toThrow(/gRPC status 0 1/);
    expect(() => grpcWebUnary(concat(frame(0, message), trailers('grpc-message: fine\r\n')))).toThrow(/no grpc-status/);
    // Anything but one message frame, then one trailer frame.
    expect(() => grpcWebUnary(frame(0, message))).toThrow(/not a unary/);
    expect(() => grpcWebUnary(trailer(0))).toThrow(/not a unary/);
    expect(() => grpcWebUnary(new Uint8Array())).toThrow(/not a unary/);
    expect(() => grpcWebUnary(concat(frame(0, message), frame(0, message), trailer(0)))).toThrow(/not a unary/);
    expect(() => grpcWebUnary(concat(frame(0, message), trailer(0), trailer(0)))).toThrow(/not a unary/);
    expect(() => grpcWebUnary(concat(trailer(0), frame(0, message)))).toThrow(/not a unary/);
    expect(() => grpcWebUnary(concat(frame(0x02, message), trailer(0)))).toThrow(/not a unary/);
    expect(() => grpcWebUnary(concat(frame(0, message), frame(0x81, new TextEncoder().encode('grpc-status: 0'))))).toThrow(
      /not a unary/,
    );
    expect(() => grpcWebUnary(concat(frame(1, message), trailer(0)))).toThrow(/compressed/);
    expect(() => grpcWebUnary(CAPTURED.subarray(0, 100))).toThrow(/truncated/);
    expect(() => grpcWebUnary(CAPTURED.subarray(0, 3))).toThrow(/truncated/);
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
    respond(concat(frame(0, new Uint8Array()), trailer(0)));
    await expect(fetchLightdInfo('https://x.example')).rejects.toThrow(/empty response/);
    respond(trailer(0));
    await expect(fetchLightdInfo('https://x.example')).rejects.toThrow(/not a unary/);
    respond(frame(0, new Uint8Array(70_000)));
    await expect(fetchLightdInfo('https://x.example')).rejects.toThrow(/larger than/);
  });
});

describe('network support rule', () => {
  // Rules as WebZjs knew them before NU6.2 was scheduled: what the branch rule alone decides.
  const OLD_RULES = { known: WEBZJS_UPGRADES, missing: [] };
  const status = (patch: Partial<LightdInfo>, floor = 0) => networkStatusFor(info(patch), OLD_RULES, 'main', floor);
  const today = (patch: Partial<LightdInfo>, floor = 0) => networkStatusFor(info(patch), WEBZJS_RULES, 'main', floor);
  // A future engine that implements NU6.2, NU6.3 and NU7.
  const PORTED = {
    known: [
      ...WEBZJS_UPGRADES,
      { name: 'NU6.2', branchId: '5437f330', activation: 3_364_600 },
      { name: 'NU6.3', branchId: '37a5165b', activation: 3_428_143 },
      { name: 'NU7', branchId: '77190ad9', activation: 3_543_405 },
    ],
    missing: [],
  };
  const ported = (patch: Partial<LightdInfo>, floor = 0) =>
    networkStatusFor(info({ consensusBranchId: '37a5165b', blockHeight: 3_533_575, ...patch }), PORTED, 'main', floor);

  it('does not support the network the captured answer describes (NU6.3), nor the NU7 it announces', () => {
    const live = decodeLightdInfo(grpcWebUnary(CAPTURED));
    expect(networkStatusFor(live, WEBZJS_RULES, 'main')).toEqual({
      branchId: '37a5165b',
      height: 3_533_505,
      supported: false,
      behind: 'engine',
      lacks: ['NU6.2', 'NU6.3'],
      upcoming: { name: 'NU7', height: 3_543_405, supported: false },
    });
  });

  it('is outdated from the first upgrade it lacks on, whatever branch a server reports', () => {
    // A node that missed NU6.2 and NU6.3 still reports NU6.1, at a height or stuck before them.
    expect(today({ blockHeight: 3_533_575 })).toMatchObject({ behind: 'engine', lacks: ['NU6.2', 'NU6.3'] });
    expect(today({ blockHeight: 3_364_599 })).toMatchObject({ supported: false, behind: 'engine', lacks: ['NU6.2'] });
    // A spend built a few blocks before the activation could be mined after it.
    expect(today({ blockHeight: 3_364_600 - 1 - 5 })).toMatchObject({ supported: false, lacks: ['NU6.2'] });
    expect(today({ blockHeight: 3_364_600 - 2 - 5 })).toMatchObject({ supported: true });
    // A server stuck in the past does not outweigh the floor.
    expect(today({ blockHeight: 3_300_000 })).toMatchObject({ supported: true });
    expect(today({ blockHeight: 3_300_000 }, 3_531_000)).toMatchObject({ supported: false, lacks: ['NU6.2', 'NU6.3'] });
    expect(today({ blockHeight: 3_300_000 }, 3_364_594)).toMatchObject({ supported: false, lacks: ['NU6.2'] });
    // From NU7 on (within the margin), all three, oldest first.
    expect(today({ blockHeight: 3_543_399 }).lacks).toEqual(['NU6.2', 'NU6.3', 'NU7']);
    expect(today({ blockHeight: 3_543_398 }).lacks).toEqual(['NU6.2', 'NU6.3']);
  });

  it('says what it knows without a server', () => {
    expect(localStatus(WEBZJS_RULES, 3_533_575)).toEqual({
      branchId: '37a5165b',
      height: 3_533_575,
      supported: false,
      behind: 'engine',
      lacks: ['NU6.2', 'NU6.3'],
    });
    expect(localStatus(WEBZJS_RULES, 3_364_594)?.lacks).toEqual(['NU6.2']);
    expect(localStatus(WEBZJS_RULES, 3_364_593)).toBeNull();
    expect(localStatus(PORTED, 3_600_000)).toBeNull();
  });

  it('supports the rules it expects at the tip, and only those', () => {
    expect(status({})).toEqual({ branchId: '4dec4df0', height: 3_300_000, supported: true });
    // NU6.2, newer than the engine.
    expect(status({ consensusBranchId: '5437f330', blockHeight: 3_364_600 })).toMatchObject({
      supported: false,
      behind: 'engine',
    });
    expect(status({ consensusBranchId: '0badc0de' })).toMatchObject({ supported: false, behind: 'engine' });
    // A node still on NU6 or NU5 after NU6.1 activated missed an upgrade: the server is behind.
    expect(status({ consensusBranchId: 'c8e71055' })).toMatchObject({ supported: false, behind: 'server' });
    expect(status({ consensusBranchId: 'c2d6d0b4' })).toMatchObject({ supported: false, behind: 'server' });
    // Just before NU6.1 activates, NU6 is right if the server knows NU6.1 is coming.
    const nu61 = { upgradeName: 'NU6.1', upgradeHeight: 3_146_400 };
    expect(status({ ...nu61, consensusBranchId: 'c8e71055', blockHeight: 3_146_399 }).supported).toBe(true);
    expect(status({ ...nu61, consensusBranchId: '4dec4df0', blockHeight: 3_146_399 })).toMatchObject({
      supported: false,
      behind: 'engine',
    });
  });

  it('matches an announced upgrade by its height, whatever the server calls it', () => {
    const before = { consensusBranchId: 'c8e71055', blockHeight: 3_140_000 };
    expect(status({ ...before, upgradeName: 'NU6.1', upgradeHeight: 3_146_400 }).upcoming).toEqual({
      name: 'NU6.1',
      height: 3_146_400,
      supported: true,
    });
    expect(status({ ...before, upgradeName: 'NU6_1', upgradeHeight: 3_146_400 }).upcoming?.supported).toBe(true);
    expect(status({ ...before, upgradeName: 'NU6.1', upgradeHeight: 3_150_000 }).upcoming?.supported).toBe(false);
    expect(status({ upgradeName: 'NU7', upgradeHeight: 3_543_405 }).upcoming?.supported).toBe(false);
    // Ironwood by its other name, for an engine that has it.
    const ironwood = { consensusBranchId: '5437f330', blockHeight: 3_400_000, upgradeName: 'Ironwood', upgradeHeight: 3_428_143 };
    expect(ported(ironwood)).toMatchObject({ supported: true, upcoming: { supported: true } });
    // An upgrade already behind the tip, or none, is not upcoming.
    expect(status({ upgradeName: 'NU6.1', upgradeHeight: 3_146_400 }).upcoming).toBeUndefined();
    expect(status({ upgradeName: '', upgradeHeight: 0 }).upcoming).toBeUndefined();
  });

  it('is outdated once an announced upgrade it does not support could take the next spend', () => {
    const nu7 = { upgradeName: 'NU7', upgradeHeight: 3_543_405 };
    expect(status({ ...nu7, blockHeight: 3_543_404 })).toMatchObject({ supported: false, behind: 'engine', lacks: ['NU7'] });
    expect(status({ ...nu7, blockHeight: 3_543_405 - 1 - 5 })).toMatchObject({ supported: false, lacks: ['NU7'] });
    expect(status({ ...nu7, blockHeight: 3_543_405 - 2 - 5 }).supported).toBe(true);
  });

  it('wants the network to switch where the engine switches', () => {
    const nu7 = { upgradeName: 'NU7', upgradeHeight: 3_543_405, blockHeight: 3_543_404 };
    expect(ported(nu7).supported).toBe(true);
    // The network postponed NU7: what the engine builds for it would be rejected.
    expect(ported({ ...nu7, upgradeHeight: 3_600_000 })).toMatchObject({ supported: false, behind: 'engine' });
    // A server with no word of it runs an old node.
    expect(ported({ ...nu7, upgradeName: '', upgradeHeight: 0 })).toMatchObject({ supported: false, behind: 'server' });
    // Far from the switch, no announcement is needed.
    expect(ported({ upgradeName: '', upgradeHeight: 0 }).supported).toBe(true);
  });

  it('does not take a server under the floor for current', () => {
    expect(ported({}, 3_533_575 + LAG_BLOCKS).supported).toBe(true);
    expect(ported({}, 3_533_575 + LAG_BLOCKS + 1)).toMatchObject({ supported: false, behind: 'server' });
  });

  it('refuses an answer it cannot judge', () => {
    expect(() => status({ chainName: 'test' })).toThrow(/chain "test"/);
    expect(() => status({ consensusBranchId: '' })).toThrow(/branch id/);
    expect(() => status({ blockHeight: 0 })).toThrow(/block height/);
  });
});
