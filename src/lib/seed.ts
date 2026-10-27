// Seed phrases are generated here with the browser CSPRNG (via @scure/bip39)
// rather than with WebZjs' generate_seed_phrase, whose own docs warn it may
// not use secure randomness in the browser.

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export function newSeedPhrase(): string {
  return generateMnemonic(wordlist, 256); // 24 words
}

/** Lower-cases and collapses whitespace so pasted phrases compare cleanly. */
export function normalizeSeedPhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(' ');
}

export function isValidSeedPhrase(phrase: string): boolean {
  const normalized = normalizeSeedPhrase(phrase);
  const words = normalized.split(' ').length;
  return [12, 15, 18, 21, 24].includes(words) && validateMnemonic(normalized, wordlist);
}

/** BIP39 seed with an empty passphrase, matching how WebZjs derives accounts. */
export function seedBytes(phrase: string): Uint8Array {
  return mnemonicToSeedSync(normalizeSeedPhrase(phrase), '');
}

/** Picks `count` distinct word positions (0-based, sorted) for the backup check. */
export function pickVerificationPositions(count: number, total = 24): number[] {
  const picked = new Set<number>();
  const random = new Uint32Array(1);
  while (picked.size < count) {
    crypto.getRandomValues(random);
    picked.add(random[0]! % total);
  }
  return [...picked].sort((a, b) => a - b);
}

export { wordlist as seedWordlist };
