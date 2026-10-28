// Memo rules shared by the Send form and payment links. A memo is UTF-8 text
// of at most MEMO_MAX_BYTES bytes (ZIP 302); only shielded payments carry one.

import { base64urlnopad } from '@scure/base';

import { MEMO_MAX_BYTES } from '../engine/types';

const encoder = new TextEncoder();

/** The space a memo takes on chain: its UTF-8 length, not its character count. */
export const memoBytes = (text: string): number => encoder.encode(text).length;

export type MemoProblem = 'tooLong' | 'nul';

/** Why `text` cannot be sent as a memo, or null if it can. */
export function memoProblem(text: string): MemoProblem | null {
  if (memoBytes(text) > MEMO_MAX_BYTES) return 'tooLong';
  // ZIP 302 reads trailing NULs as padding, so the engine refuses them anywhere.
  if (text.includes('\u0000')) return 'nul';
  return null;
}

/**
 * Decodes a ZIP-321 `memo` value: the memo bytes, base64url without padding.
 * Returns the text ('' for no memo), or null when the value is not a text
 * memo Celari can send: a bad encoding, more than 512 bytes, binary data or
 * a NUL inside the text.
 */
export function decodeLinkMemo(value: string): string | null {
  let bytes: Uint8Array;
  try {
    // Strict: padding, other alphabets and stray low bits all throw.
    bytes = base64urlnopad.decode(value);
  } catch {
    return null;
  }
  if (bytes.length > MEMO_MAX_BYTES) return null;
  // 0xF6 followed by zeros is ZIP 302's "no memo".
  if (bytes[0] === 0xf6 && bytes.every((b, i) => i === 0 || b === 0)) return '';
  // Trailing zeros pad a text memo; on chain it is padded the same way.
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  let text: string;
  try {
    // Binary memos start with a byte above 0xF4, which is never valid UTF-8.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, end));
  } catch {
    return null;
  }
  return memoProblem(text) === null ? text : null;
}
