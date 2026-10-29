// The UI talks to the Zcash light client only through this interface. The real
// implementation wraps WebZjs (./webzjs.ts); a scripted fake (./fake.ts) backs
// UI tests in dev builds and is never bundled into production.

export interface Balances {
  orchard: bigint;
  sapling: bigint;
  /** The NU6.3 pool where new shielded value lands; 0 for an engine without it (ZcashEngine.ironwood). */
  ironwood: bigint;
  transparent: bigint;
  /**
   * Received notes and change still waiting for confirmations, transparent funds
   * included, and value held back for a transaction being built (WebZjs's
   * `locked`), in every pool.
   */
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
  /**
   * Where the wallet's own outputs went: 'sapling', 'orchard', 'ironwood',
   * 'transparent', 'mixed' (more than one) or 'unknown', as WebZjs reports it.
   * See lib/privacy.ts.
   */
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
  /**
   * Awaited once the transaction is proved, before the 'broadcasting' stage
   * starts. Throwing stops the spend there: nothing has left the wallet.
   * Required, so no engine can leave out the last network check.
   */
  beforeBroadcast: () => Promise<void>;
}

/** A network upgrade the lightwalletd server announces but the chain has not reached. */
export interface UpcomingUpgrade {
  /** As the server names it, e.g. 'NU7'. */
  name: string;
  /** Its activation height. */
  height: number;
  /** Whether this engine will still build transactions the network accepts after it. */
  supported: boolean;
}

/** The consensus rules the network runs, as the engine's lightwalletd server reports them. */
export interface NetworkStatus {
  /** Consensus branch id at the server's chain tip, 8 lowercase hex digits (e.g. '37a5165b'). */
  branchId: string;
  /** The server's chain tip. */
  height: number;
  /** Whether this engine builds transactions the network accepts under these rules. */
  supported: boolean;
  /**
   * Why not, when not supported: the network runs rules the engine lacks
   * ('engine'), or the server runs older rules than the network or lags behind
   * it ('server'), so another server may do.
   */
  behind?: 'engine' | 'server';
  /** For 'engine': the upgrades the engine lacks, by name, oldest first (e.g. ['NU6.2', 'NU6.3']), when known. */
  lacks?: string[];
  upcoming?: UpcomingUpgrade;
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
  /** Blocks downloaded so far (a batch counts once it has arrived in full); optional. */
  downloaded?: number;
}

/** A memo holds at most this many bytes of UTF-8 text (ZIP 302). */
export const MEMO_MAX_BYTES = 512;

/**
 * open() refused the stored database because it is in a format this engine no
 * longer reads: written by the engine Celari shipped before (WebZjs's own
 * format). Rebuilding it from the wallet's secret and rescanning is the way on.
 */
export class OldDatabaseFormatError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('the wallet database was written by an older engine, in a format this one does not read', options);
    this.name = 'OldDatabaseFormatError';
  }
}

/**
 * open() refused the stored database because a newer engine (a later Celari)
 * wrote it, in a format version this one does not know. It must be kept as it is.
 */
export class NewerDatabaseFormatError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('the wallet database was written by a newer engine than this one', options);
    this.name = 'NewerDatabaseFormatError';
  }
}

/**
 * The engine stopped and cannot be used in this page any more: its WebAssembly trapped (it ran
 * out of memory, or hit an internal error such as a Rust panic). Calls fail with this error,
 * including one that was waiting when it happened; nothing more is saved. Reloading the page
 * starts a fresh engine from what was saved last.
 */
export class EngineStoppedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('the wallet engine stopped (out of memory or an internal error); reload the page', options);
    this.name = 'EngineStoppedError';
  }
}

export interface ZcashEngine {
  /** Loads the wasm runtime and connects to the lightwalletd proxy. Call once per page. */
  init(serverUrl: string): Promise<void>;
  latestHeight(): Promise<number>;
  /**
   * Asks the server which consensus rules the network runs and says whether
   * this engine supports them; only the engine knows which it supports.
   * Throws if the server does not answer.
   */
  networkStatus(): Promise<NetworkStatus>;
  /**
   * What the engine knows about the network without a server, e.g. that an
   * upgrade it lacks is surely active by now. Optional; null if it cannot tell.
   */
  localNetworkStatus?(): NetworkStatus | null;
  /** Whether the engine sees and spends the NU6.3 Ironwood pool. */
  readonly ironwood: boolean;
  /** Earliest height a key ever received transparent funds, if it can be found. */
  detectBirthday(secret: { phrase: string } | { ufvk: string }): Promise<number | null>;
  isValidViewingKey(ufvk: string): Promise<boolean>;
  viewingKey(phrase: string): Promise<string>;

  /**
   * Opens the wallet database (or a fresh one) and returns the first account id,
   * or null if the engine cannot name one yet (WebZjs gives no summary, and so no
   * account list, before a pass has set the chain tip). Throws
   * OldDatabaseFormatError or NewerDatabaseFormatError for a database in another
   * format; any other error means the database could not be read.
   */
  open(db: Uint8Array | null): Promise<number | null>;
  addSeedAccount(phrase: string, birthday: number): Promise<number>;
  addViewAccount(ufvk: string, birthday: number): Promise<number>;
  exportDb(): Promise<Uint8Array>;

  sync(): Promise<void>;
  /**
   * Calls `listener` once if the engine stops (EngineStoppedError), whether or not a call was
   * running then. Optional: engines that cannot stop leave it out.
   */
  onStopped?(listener: (error: EngineStoppedError) => void): void;
  /** Progress of the running pass, readable while sync() runs. Optional: engines that cannot tell leave it out. */
  syncProgress?(): Promise<SyncProgress | null>;
  summary(account: number): Promise<Summary | null>;
  addresses(account: number): Promise<Addresses>;
  /**
   * A unified address with shielded receivers only (Orchard, which also receives
   * Ironwood funds, and Sapling), never handed out before. The engine records it, so
   * funds sent to it, and to every earlier one, are the account's; `addresses()` is
   * unaffected. WebZjs answers once a running sync pass lets go of the database.
   */
  nextShieldedAddress(account: number): Promise<string>;
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

/** Spendable shielded value: Sapling + Orchard + Ironwood. */
export const shieldedTotal = (b: Balances) => b.sapling + b.orchard + b.ironwood;
export const grandTotal = (b: Balances) => shieldedTotal(b) + b.transparent + b.pending;

/** WebZjs refuses to shield less than this (see SHIELDING_THRESHOLD upstream). */
export const SHIELDING_THRESHOLD_ZATS = 100_000n;
/** ZIP-317 fee for the common two-action transaction; the real fee can be higher. */
export const TYPICAL_FEE_ZATS = 10_000n;
