// Client-side address checks. These catch typos and wrong-network pastes
// before the (slow) transaction proving starts; WebZjs still does the
// authoritative parse when the transaction is built.

import { base58check, bech32, bech32m } from '@scure/base';
import { blake2b } from '@noble/hashes/blake2';
import { sha256 } from '@noble/hashes/sha256';

import { decodeLinkMemo } from './memo';
import { ZATS_PER_ZEC, parseZec } from './zec';

export type AddressKind = 'unified' | 'sapling' | 'transparent' | 'tex';

export type AddressCheck =
  | { ok: true; kind: AddressKind }
  | { ok: false; reason: 'empty' | 'testnet' | 'invalid' };

const b58 = base58check(sha256);

const TRANSPARENT_MAIN = [
  [0x1c, 0xb8], // t1… P2PKH
  [0x1c, 0xbd], // t3… P2SH
];
const TRANSPARENT_TEST = [
  [0x1d, 0x25], // tm…
  [0x1c, 0xba], // t2…
];

function bech32Prefix(address: string, coder: typeof bech32, limit: number | false): string | null {
  const decoded = coder.decodeUnsafe(address, limit);
  return decoded ? decoded.prefix : null;
}

function transparentVersion(address: string): number[] | null {
  try {
    const bytes = b58.decode(address);
    if (bytes.length !== 22) return null;
    return [bytes[0]!, bytes[1]!];
  } catch {
    return null;
  }
}

const sameVersion = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1];

/**
 * Why Celari cannot pay this address, or null if it can. A TEX address is valid, but paying it
 * takes a ZIP 320 pair of transactions, and the engine turns only single-step proposals into
 * PCZTs (zcash_client_backend 0.25 create_pczt_from_proposal): every such send would fail at
 * building (review round 7, SPEND-2 and ES-3).
 */
export function unpayableReason(check: AddressCheck): 'empty' | 'testnet' | 'invalid' | 'texUnsupported' | null {
  if (!check.ok) return check.reason;
  return check.kind === 'tex' ? 'texUnsupported' : null;
}

export function checkAddress(raw: string): AddressCheck {
  const address = raw.trim();
  if (address === '') return { ok: false, reason: 'empty' };

  // Unified addresses are bech32m without the usual 90-character limit.
  // (The decoder lower-cases all-caps input and rejects mixed case.)
  const unified = bech32Prefix(address, bech32m, false);
  if (unified === 'u') return { ok: true, kind: 'unified' };
  if (unified === 'utest') return { ok: false, reason: 'testnet' };
  if (unified === 'tex') return { ok: true, kind: 'tex' };
  if (unified === 'textest') return { ok: false, reason: 'testnet' };

  const sapling = bech32Prefix(address, bech32, 90);
  if (sapling === 'zs') return { ok: true, kind: 'sapling' };
  if (sapling === 'ztestsapling') return { ok: false, reason: 'testnet' };

  const version = transparentVersion(address);
  if (version) {
    if (TRANSPARENT_MAIN.some((v) => sameVersion(v, version))) return { ok: true, kind: 'transparent' };
    if (TRANSPARENT_TEST.some((v) => sameVersion(v, version))) return { ok: false, reason: 'testnet' };
  }

  return { ok: false, reason: 'invalid' };
}

// Unified address receiver typecodes (ZIP 316).
const P2PKH_RECEIVER = 0x00;
const P2SH_RECEIVER = 0x01;
// The receivers that can take a memo.
const SAPLING_RECEIVER = 0x02;
const ORCHARD_RECEIVER = 0x03;

const personal = (tag: string, i: number, j = 0) => {
  const p = new Uint8Array(16);
  p.set(new TextEncoder().encode(tag));
  p[13] = i;
  p[14] = j & 0xff;
  p[15] = j >> 8;
  return p;
};

const xor = (a: Uint8Array, b: Uint8Array) => a.map((x, k) => x ^ b[k]!);

function f4H(i: number, u: Uint8Array, length: number): Uint8Array {
  return blake2b(u, { dkLen: length, personalization: personal('UA_F4Jumble_H', i) });
}

function f4G(i: number, u: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let j = 0; j * 64 < length; j++) {
    const block = blake2b(u, { dkLen: 64, personalization: personal('UA_F4Jumble_G', i, j) });
    out.set(block.subarray(0, Math.min(64, length - j * 64)), j * 64);
  }
  return out;
}

/** Undoes the F4Jumble that hides a unified address's receivers (ZIP 316). */
function f4Unjumble(m: Uint8Array): Uint8Array {
  const left = Math.min(64, Math.floor(m.length / 2));
  const right = m.length - left;
  const c = m.subarray(0, left);
  const d = m.subarray(left);
  const y = xor(c, f4H(1, d, left));
  const x = xor(d, f4G(1, y, right));
  const a = xor(y, f4H(0, x, left));
  const b = xor(x, f4G(0, a, right));
  const out = new Uint8Array(m.length);
  out.set(a);
  out.set(b, left);
  return out;
}

/** The receiver typecodes of a mainnet unified address, or null if it does not decode. */
export function unifiedReceivers(address: string): number[] | null {
  const decoded = bech32m.decodeUnsafe(address, false);
  const bytes = decoded && bech32m.fromWordsUnsafe(decoded.words);
  if (!decoded || !bytes || bytes.length < 48) return null;
  const raw = f4Unjumble(Uint8Array.from(bytes));
  // The last 16 bytes are the prefix padded with zeros.
  const padding = raw.subarray(-16);
  if (!padding.every((b, i) => b === (decoded.prefix.charCodeAt(i) || 0))) return null;

  const body = raw.subarray(0, -16);
  let at = 0;
  // CompactSize; receivers never need the 8-byte form.
  const size = (): number | null => {
    const first = body[at++];
    if (first === undefined || first === 0xff) return null;
    if (first < 0xfd) return first;
    const n = first === 0xfd ? 2 : 4;
    if (at + n > body.length) return null;
    let value = 0;
    for (let k = n - 1; k >= 0; k--) value = value * 256 + body[at + k]!;
    at += n;
    return value;
  };
  const typecodes: number[] = [];
  while (at < body.length) {
    const typecode = size();
    const length = size();
    if (typecode === null || length === null || at + length > body.length) return null;
    typecodes.push(typecode);
    at += length;
  }
  return typecodes;
}

/**
 * Whether this is a mainnet unified address with shielded receivers only: at least
 * one Sapling or Orchard receiver (Ironwood funds arrive at the Orchard one), and
 * no transparent receiver, which would let a sender pay where everyone can see.
 */
export function isShieldedOnlyUnified(raw: string): boolean {
  const address = raw.trim();
  const check = checkAddress(address);
  if (!check.ok || check.kind !== 'unified') return false;
  const receivers = unifiedReceivers(address);
  if (receivers === null) return false;
  return (
    receivers.some((t) => t === SAPLING_RECEIVER || t === ORCHARD_RECEIVER) &&
    !receivers.some((t) => t === P2PKH_RECEIVER || t === P2SH_RECEIVER)
  );
}

/**
 * Whether a payment to this address can carry a memo. Only shielded
 * receivers take one: a Sapling address, or a unified address with a Sapling
 * or Orchard receiver. Transparent and TEX addresses cannot.
 */
export function acceptsMemo(raw: string): boolean {
  const address = raw.trim();
  const check = checkAddress(address);
  if (!check.ok) return false;
  if (check.kind === 'sapling') return true;
  if (check.kind !== 'unified') return false;
  const receivers = unifiedReceivers(address);
  // An address that does not decode is left to the engine, which refuses it whole.
  return receivers === null || receivers.some((t) => t === SAPLING_RECEIVER || t === ORCHARD_RECEIVER);
}

export interface PaymentRequest {
  address: string;
  amountZats?: bigint;
  /** Text memo the payee asked for, decoded from the link. */
  memo?: string;
  /**
   * Set when the link must not be paid as it stands: several payments, a
   * `req-` parameter, a malformed link, or a memo its address cannot take.
   */
  refused?: 'multi' | 'req' | 'invalid' | 'memo';
}

/** ZIP-321 amounts: decimal ZEC with a dot and at most 8 decimals. */
const LINK_AMOUNT = /^\d+(\.\d{1,8})?$/;
const MAX_MONEY_ZATS = 21_000_000n * ZATS_PER_ZEC;

/**
 * Reads a pasted address or a single-recipient ZIP-321 URI
 * ("zcash:<address>?amount=1.5&memo=…"). ZIP-321 requires a wallet to reject
 * a link it does not understand or that is malformed rather than pay part of
 * it or guess, so such links come back `refused`.
 */
export function parsePaymentInput(raw: string): PaymentRequest {
  const input = raw.trim();
  if (!/^zcash:/i.test(input)) return { address: input };

  const rest = input.slice('zcash:'.length);
  const q = rest.indexOf('?');
  const path = q < 0 ? rest : rest.slice(0, q);
  const params = new URLSearchParams(q < 0 ? '' : rest.slice(q + 1));
  const refuse = (refused: NonNullable<PaymentRequest['refused']>): PaymentRequest => ({ address: input, refused });

  const keys = [...params.keys()];
  if (keys.some((k) => /\.\d+$/.test(k))) return refuse('multi');
  if (keys.some((k) => k.startsWith('req-'))) return refuse('req');

  // A bare "zcash:" is usually a link still being typed; keep it as it is.
  if (!path && !params.get('address')) return { address: input };
  // Two values for one key, or an address both in the path and as a parameter.
  if (new Set(keys).size !== keys.length || (path && params.has('address'))) return refuse('invalid');
  let address: string;
  try {
    address = decodeURIComponent(path || params.get('address') || '');
  } catch {
    // Malformed %-escape: leave the text alone and let the address check reject it.
    return { address: input };
  }

  const request: PaymentRequest = { address };
  const amount = params.get('amount');
  if (amount !== null) {
    if (!LINK_AMOUNT.test(amount)) return refuse('invalid');
    // Zero asks for no amount in particular; the user types one.
    if (/[1-9]/.test(amount)) {
      const zats = parseZec(amount);
      if (zats > MAX_MONEY_ZATS) return refuse('invalid');
      request.amountZats = zats;
    }
  }
  const memo = params.get('memo');
  if (memo !== null) {
    const text = decodeLinkMemo(memo);
    if (text === null) return refuse('invalid');
    if (text !== '') {
      if (checkAddress(address).ok && !acceptsMemo(address)) return refuse('memo');
      request.memo = text;
    }
  }
  return request;
}

/** Shortens an address for display: "u1abcd…wxyz". */
export function shortAddress(address: string, keep = 8): string {
  return address.length <= keep * 2 + 1 ? address : `${address.slice(0, keep)}…${address.slice(-keep)}`;
}
