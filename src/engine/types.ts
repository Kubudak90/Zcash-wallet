// The UI talks to the Zcash light client only through this interface. The real
// implementation wraps WebZjs (./webzjs.ts); a scripted fake (./fake.ts) backs
// UI tests in dev builds and is never bundled into production.

export interface Balances {
  orchard: bigint;
  sapling: bigint;
  transparent: bigint;
  /** Received notes and change still waiting for confirmations. */
  pending: bigint;
}

export interface Summary {
  tipHeight: number;
  scannedHeight: number;
  balances: Balances;
}

export type TxType = 'received' | 'sent' | 'shielded';
export type TxStatus = 'confirmed' | 'pending' | 'expired';

export interface HistoryItem {
  txid: string;
  type: TxType;
  /** Net change for the account; negative when funds left it. */
  valueZats: bigint;
  feeZats: bigint | null;
  height: number | null;
  confirmations: number;
  status: TxStatus;
  memo: string | null;
  /** Seconds since the Unix epoch, estimated from the block height. */
  timestamp: number | null;
  pool: string;
}

export interface Addresses {
  unified: string;
  transparent: string | null;
}

export type SendStage = 'building' | 'signing' | 'proving' | 'broadcasting';

export interface SpendAuthority {
  /** The wallet's seed phrase; used to sign, then dropped by the caller. */
  phrase: string;
  onStage?: (stage: SendStage) => void;
}

/**
 * Counters for the running sync pass, in blocks of that pass. Engines that keep
 * their database locked for a whole pass (WebZjs) cannot report progress
 * through summary(); these counters answer mid-pass.
 */
export interface SyncProgress {
  /** False once the pass has ended; the counts then describe that pass. */
  running: boolean;
  /** Blocks the scanner has reached (trial decryption under way or done). */
  visited: number;
  /** Blocks whose batch is scanned and committed to the wallet database. */
  scanned: number;
}

/** A memo holds at most this many bytes of UTF-8 text (ZIP 302). */
export const MEMO_MAX_BYTES = 512;

export interface ZcashEngine {
  /** Loads the wasm runtime and connects to the lightwalletd proxy. Call once per page. */
  init(serverUrl: string): Promise<void>;
  latestHeight(): Promise<number>;
  /** Earliest height a key ever received transparent funds, if it can be found. */
  detectBirthday(secret: { phrase: string } | { ufvk: string }): Promise<number | null>;
  isValidViewingKey(ufvk: string): Promise<boolean>;
  viewingKey(phrase: string): Promise<string>;

  /** Opens the wallet database (or a fresh one) and returns the first account id, if any. */
  open(db: Uint8Array | null): Promise<number | null>;
  addSeedAccount(phrase: string, birthday: number): Promise<number>;
  addViewAccount(ufvk: string, birthday: number): Promise<number>;
  exportDb(): Promise<Uint8Array>;

  sync(): Promise<void>;
  /** Progress of the running pass, readable while sync() runs. Optional: engines that cannot tell leave it out. */
  syncProgress?(): Promise<SyncProgress | null>;
  summary(account: number): Promise<Summary | null>;
  addresses(account: number): Promise<Addresses>;
  history(account: number, limit: number): Promise<HistoryItem[]>;

  /**
   * Builds, signs, proves and broadcasts a payment. `memo` is UTF-8 text for
   * the recipient, at most MEMO_MAX_BYTES bytes; only shielded recipients can
   * receive one, so a memo to a transparent or TEX address is rejected before
   * anything is built. An empty or missing memo sends none.
   */
  send(account: number, to: string, zats: bigint, auth: SpendAuthority, memo?: string): Promise<void>;
  shield(account: number, auth: SpendAuthority): Promise<void>;
}

export const shieldedTotal = (b: Balances) => b.orchard + b.sapling;
export const grandTotal = (b: Balances) => b.orchard + b.sapling + b.transparent + b.pending;

/** WebZjs refuses to shield less than this (see SHIELDING_THRESHOLD upstream). */
export const SHIELDING_THRESHOLD_ZATS = 100_000n;
/** ZIP-317 fee for the common two-action transaction; the real fee can be higher. */
export const TYPICAL_FEE_ZATS = 10_000n;
