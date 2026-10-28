// Client-side address checks. These catch typos and wrong-network pastes
// before the (slow) transaction proving starts; WebZjs still does the
// authoritative parse when the transaction is built.

import { base58check, bech32, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';

import { parseZec } from './zec';

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

export interface PaymentRequest {
  address: string;
  amountZats?: bigint;
  /** Base64url memo the payee asked for; Celari cannot attach memos yet. */
  memo?: string;
  /** Set when the link asks for something Celari cannot honour, so it must not be paid. */
  unsupported?: 'multi' | 'req';
}

/**
 * Reads a pasted address or a single-recipient ZIP-321 URI
 * ("zcash:<address>?amount=1.5"). Links with several payments or with a
 * `req-` parameter are flagged as unsupported: ZIP-321 requires a wallet to
 * reject what it does not understand rather than pay part of the request.
 */
export function parsePaymentInput(raw: string): PaymentRequest {
  const input = raw.trim();
  if (!/^zcash:/i.test(input)) return { address: input };

  const rest = input.slice('zcash:'.length);
  const [path = '', query = ''] = rest.split('?', 2);
  const params = new URLSearchParams(query);

  const keys = [...params.keys()];
  if (keys.some((k) => /\.\d+$/.test(k))) return { address: input, unsupported: 'multi' };
  if (keys.some((k) => k.startsWith('req-'))) return { address: input, unsupported: 'req' };

  // A bare "zcash:" is usually a link still being typed; keep it as it is.
  if (!path && !params.get('address')) return { address: input };
  let address: string;
  try {
    address = decodeURIComponent(path || params.get('address') || '');
  } catch {
    // Malformed %-escape: leave the text alone and let the address check reject it.
    return { address: input };
  }
  const amount = params.get('amount');

  const request: PaymentRequest = { address };
  const memo = params.get('memo');
  if (memo) request.memo = memo;
  if (amount) {
    try {
      request.amountZats = parseZec(amount);
    } catch {
      // An unreadable amount is dropped; the user types it instead.
    }
  }
  return request;
}

/** Shortens an address for display: "u1abcd…wxyz". */
export function shortAddress(address: string, keep = 8): string {
  return address.length <= keep * 2 + 1 ? address : `${address.slice(0, keep)}…${address.slice(-keep)}`;
}
