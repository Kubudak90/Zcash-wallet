// Asks the lightwalletd server which consensus rules the network runs
// (GetLightdInfo), so an engine can tell whether it still builds transactions
// the network accepts. One gRPC-web unary call over plain fetch(), the
// transport WebZjs itself uses, and a minimal protobuf reader: LightdInfo is a
// flat message of varints and strings, so no proto library is needed.

import type { NetworkStatus } from './types';

/** The fields of LightdInfo (lightwallet-protocol walletrpc/service.proto) the guard reads. */
export interface LightdInfo {
  version: string;
  vendor: string;
  /** "main" or "test". */
  chainName: string;
  /** Branch id of the rules the chain tip was validated under, lowercase hex, e.g. "37a5165b". */
  consensusBranchId: string;
  /** The server's chain tip. */
  blockHeight: number;
  /** The next pending network upgrade, e.g. "NU7"; empty if none is scheduled. */
  upgradeName: string;
  /** Its activation height; 0 if none is scheduled. */
  upgradeHeight: number;
}

const GET_LIGHTD_INFO = '/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo';
// The answer is a few hundred bytes; anything far larger is not LightdInfo.
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;

/** Reads a protobuf varint at `at`; returns the value and the offset after it. */
function varint(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  // Multiplying instead of shifting keeps uint64 heights exact past 2^31.
  for (let shift = 0; shift < 64; shift += 7) {
    const byte = bytes[at++];
    if (byte === undefined) throw new Error('truncated protobuf varint');
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [value, at];
  }
  throw new Error('protobuf varint too long');
}

/** Decodes one LightdInfo message. Unknown fields are skipped, as protobuf requires. */
export function decodeLightdInfo(message: Uint8Array): LightdInfo {
  const text = new TextDecoder('utf-8', { fatal: true });
  const info: LightdInfo = {
    version: '',
    vendor: '',
    chainName: '',
    consensusBranchId: '',
    blockHeight: 0,
    upgradeName: '',
    upgradeHeight: 0,
  };
  let at = 0;
  while (at < message.length) {
    let tag: number;
    [tag, at] = varint(message, at);
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (wire === 0) {
      let value: number;
      [value, at] = varint(message, at);
      if (field === 7) info.blockHeight = value;
      else if (field === 17) info.upgradeHeight = value;
    } else if (wire === 2) {
      let length: number;
      [length, at] = varint(message, at);
      if (at + length > message.length) throw new Error('truncated protobuf field');
      const bytes = message.subarray(at, at + length);
      at += length;
      if (field === 1) info.version = text.decode(bytes);
      else if (field === 2) info.vendor = text.decode(bytes);
      else if (field === 4) info.chainName = text.decode(bytes);
      else if (field === 6) info.consensusBranchId = text.decode(bytes).toLowerCase();
      else if (field === 16) info.upgradeName = text.decode(bytes);
    } else if (wire === 1 || wire === 5) {
      at += wire === 1 ? 8 : 4;
      if (at > message.length) throw new Error('truncated protobuf field');
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
  }
  return info;
}

/** Reads the grpc-status of a trailer frame: every grpc-status line must say exactly 0. */
function checkTrailers(frame: Uint8Array): void {
  const trailers = new TextDecoder().decode(frame);
  const statuses = [...trailers.matchAll(/^grpc-status:(.*)$/gim)].map((m) => m[1]!.trim());
  if (statuses.length === 0) throw new Error('gRPC-web trailers carry no grpc-status');
  const failed = statuses.find((status) => status !== '0');
  if (failed !== undefined) throw new Error(`gRPC status ${failed}: ${trailers.trim()}`);
}

/**
 * Reads a unary gRPC-web response body: exactly one uncompressed message
 * frame, then one trailer frame (flag 0x80) whose grpc-status is 0. Each
 * frame is a flag byte and a 4-byte big-endian length. Anything else (no
 * trailers, a second message, other flag bits) fails the call.
 */
export function grpcWebUnary(body: Uint8Array): Uint8Array {
  const frames: { flag: number; data: Uint8Array }[] = [];
  let at = 0;
  while (at < body.length) {
    if (at + 5 > body.length) throw new Error('truncated gRPC-web frame');
    const flag = body[at]!;
    const length = ((body[at + 1]! << 24) | (body[at + 2]! << 16) | (body[at + 3]! << 8) | body[at + 4]!) >>> 0;
    const data = body.subarray(at + 5, at + 5 + length);
    if (data.length !== length) throw new Error('truncated gRPC-web frame');
    at += 5 + length;
    // A failed call's status is the more useful error, wherever its trailers sit.
    if (flag === 0x80) checkTrailers(data);
    frames.push({ flag, data });
  }
  if (frames.some((f) => f.flag === 0x01)) throw new Error('compressed gRPC-web messages are not supported');
  const [message, trailers] = frames;
  if (frames.length !== 2 || message!.flag !== 0x00 || trailers!.flag !== 0x80) {
    throw new Error(`not a unary gRPC-web answer (frame flags: ${frames.map((f) => f.flag).join(', ') || 'none'})`);
  }
  return message!.data;
}

/** Reads a response body, refusing one larger than `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error(`gRPC-web response larger than ${max} bytes`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.length;
  }
  return body;
}

/** Calls GetLightdInfo on a lightwalletd gRPC-web proxy. Throws if the server does not answer it. */
export async function fetchLightdInfo(serverUrl: string, timeoutMs = TIMEOUT_MS): Promise<LightdInfo> {
  const res = await fetch(serverUrl.replace(/\/+$/, '') + GET_LIGHTD_INFO, {
    method: 'POST',
    headers: { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1' },
    // One frame holding the empty request message (Empty).
    body: new Uint8Array(5),
    // Nothing of the page goes with it: no cookies, no referrer, no browser-cached
    // answer. A CDN in front of the server may still cache it (the default one
    // answers x-cache: hit), which is why a height is never taken on trust alone.
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    // A redirect could hand the question to another server.
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GetLightdInfo: HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!/^application\/grpc-web(\+proto)?(;|$)/i.test(type)) throw new Error(`GetLightdInfo: unexpected content type "${type}"`);
  // An error without a message comes as headers only ("trailers-only").
  const status = res.headers.get('grpc-status');
  if (status !== null && status !== '0') {
    throw new Error(`GetLightdInfo: gRPC status ${status} ${res.headers.get('grpc-message') ?? ''}`.trim());
  }
  const message = grpcWebUnary(await readCapped(res, MAX_RESPONSE_BYTES));
  if (message.length === 0) throw new Error('GetLightdInfo: empty response');
  return decodeLightdInfo(message);
}

/** A network upgrade, as an engine knows it. */
export interface KnownUpgrade {
  /** As lightwalletd names it in upgradeName, e.g. "NU6.1". */
  name: string;
  /** Consensus branch id, 8 lowercase hex digits. */
  branchId: string;
  /** Mainnet activation height. */
  activation: number;
}

/** What an engine knows about network upgrades. */
export interface EngineRules {
  /** The upgrades it builds transactions for, oldest first. */
  known: readonly KnownUpgrade[];
  /**
   * Upgrades scheduled or active on the network that it does not implement,
   * oldest first. From the first one's activation on the engine is outdated
   * whatever a server reports, so a server whose node missed them cannot
   * vouch for it.
   */
  missing: readonly KnownUpgrade[];
}

/**
 * A spend is built for the block after the tip, but may be mined a few blocks
 * later, so an upgrade the engine lacks counts from this many blocks before
 * its activation.
 */
export const MINING_MARGIN_BLOCKS = 5;

/** A server this many blocks under a height already known lags behind the network. */
export const LAG_BLOCKS = 20;

/**
 * What an engine can say about the network without asking a server, given
 * `floorHeight`, a height the chain has surely reached: outdated once an
 * upgrade it lacks is active (or could take the next spend) there.
 */
export function localStatus(rules: EngineRules, floorHeight: number): NetworkStatus | null {
  const lacking = rules.missing.filter((u) => u.activation <= floorHeight + 1 + MINING_MARGIN_BLOCKS);
  const last = lacking.at(-1);
  if (!last) return null;
  return {
    branchId: last.branchId,
    height: floorHeight,
    supported: false,
    behind: 'engine',
    lacks: lacking.map((u) => u.name),
  };
}

/**
 * Whether an engine that knows `rules` builds transactions the network
 * accepts. `floorHeight` is a height the chain has surely reached, known
 * without the server, so a server stuck in the past can neither hide an
 * upgrade the engine lacks nor pass for current.
 *
 * - The engine is outdated (behind: 'engine') once a spend built now could be
 *   mined under rules it lacks: one of `rules.missing`, an upgrade the server
 *   announces that the engine does not expect at that height, or a branch the
 *   engine has never heard of. Likewise when the network moved an upgrade the
 *   engine expects: the server announces it at another height, reports its
 *   branch before the engine's activation height (moved earlier), or, past
 *   that height, still reports the branch before it while announcing an
 *   upgrade at a height the engine does not know (postponed).
 * - Otherwise the server must report the branch the engine applies at the
 *   server's tip, from a tip no lower than the floor. An older branch, a tip
 *   under the floor or no word of the upgrade the engine expects next means
 *   the server is behind (behind: 'server'); another server may do.
 *
 * Upgrades are matched by activation height, not by name: servers name them
 * differently ('NU6.3', 'Ironwood').
 */
export function networkStatusFor(info: LightdInfo, rules: EngineRules, chain: string, floorHeight = 0): NetworkStatus {
  if (info.chainName !== chain) throw new Error(`the server is on chain "${info.chainName}", not "${chain}"`);
  if (!/^[0-9a-f]{8}$/.test(info.consensusBranchId)) throw new Error('the server sent no consensus branch id');
  if (!Number.isSafeInteger(info.blockHeight) || info.blockHeight <= 0) throw new Error('the server sent no block height');

  const status: NetworkStatus = { branchId: info.consensusBranchId, height: info.blockHeight, supported: false };
  const announced = info.upgradeName !== '' && info.upgradeHeight > info.blockHeight;
  if (announced) {
    status.upcoming = {
      name: info.upgradeName,
      height: info.upgradeHeight,
      supported: rules.known.some((u) => u.activation === info.upgradeHeight),
    };
  }

  const engine = { ...status, behind: 'engine' as const };
  const server = { ...status, behind: 'server' as const };
  // The last height a spend built now might be mined at.
  const target = Math.max(info.blockHeight, floorHeight) + 1 + MINING_MARGIN_BLOCKS;
  const lacking = rules.missing.filter((u) => u.activation <= target);
  if (lacking.length > 0) return { ...engine, lacks: lacking.map((u) => u.name) };
  if (status.upcoming && !status.upcoming.supported && status.upcoming.height <= target) {
    return { ...engine, lacks: [status.upcoming.name] };
  }
  const reported = rules.known.find((u) => u.branchId === info.consensusBranchId);
  // A branch the engine applies only from a later height: the network activated it earlier.
  if (reported && reported.activation > info.blockHeight) return engine;
  // The engine switches rules before the target: the network must be switching there too.
  const next = rules.known.find((u) => u.activation > info.blockHeight && u.activation <= target);
  if (next && !announced) return server;
  if (next && info.upgradeHeight !== next.activation) return engine;

  const expected = rules.known.filter((u) => u.activation <= info.blockHeight).at(-1);
  if (expected?.branchId === info.consensusBranchId) {
    return info.blockHeight + LAG_BLOCKS < floorHeight ? server : { ...status, supported: true };
  }
  if (reported && expected && reported.activation < expected.activation) {
    // Still on an older branch but announcing an upgrade at a height the engine does not know:
    // the network postponed the upgrade the engine applies (moved it, as above). With no such
    // announcement the server's node missed the upgrade.
    return status.upcoming && !status.upcoming.supported ? engine : server;
  }
  return engine;
}
