// Declarations for the subset of the WebZjs API that Celari uses, so the app
// type-checks before the wasm packages are built. They mirror the typings that
// wasm-bindgen generates into vendor/; `npm run typecheck:vendor` checks the
// adapter against the real ones and fails on any drift.

declare module '@chainsafe/webzjs-wallet' {
  export default function init(moduleOrPath?: unknown): Promise<unknown>;
  export function initThreadPool(numThreads: number): Promise<unknown>;

  export class Pczt {
    free(): void;
    serialize(): Uint8Array;
    static from_bytes(bytes: Uint8Array): Pczt;
  }

  export class ProofGenerationKey {
    free(): void;
  }

  export class WalletSummary {
    free(): void;
    readonly account_balances: any;
    chain_tip_height: number;
    fully_scanned_height: number;
  }

  /** From patches/webzjs/0001-sync-progress.patch. */
  export class SyncProgress {
    free(): void;
    running: boolean;
    downloaded: number;
    visited: number;
    revisited: number;
    scanned: number;
    scanned_to: number;
  }

  export class TransactionHistoryResponse {
    free(): void;
    readonly transactions: any;
    readonly total_count: number;
    readonly has_more: boolean;
  }

  export class WebWallet {
    free(): void;
    constructor(
      network: string,
      lightwalletd_url: string,
      min_confirmations_trusted: number,
      min_confirmations_untrusted: number,
      db_bytes?: Uint8Array | null,
    );
    create_account(
      account_name: string,
      seed_phrase: string,
      account_hd_index: number,
      birthday_height?: number | null,
    ): Promise<number>;
    create_account_view_ufvk(
      account_name: string,
      encoded_ufvk: string,
      birthday_height?: number | null,
    ): Promise<number>;
    sync(): Promise<void>;
    // Optional here: the adapter feature-detects it (patches/webzjs/0001-sync-progress.patch).
    sync_progress?(): SyncProgress;
    get_wallet_summary(): Promise<WalletSummary | undefined>;
    db_to_bytes(): Promise<Uint8Array>;
    get_current_address(account_id: number): Promise<string>;
    get_current_address_transparent(account_id: number): Promise<string>;
    get_transaction_history(
      account_id: number,
      limit?: number | null,
      offset?: number | null,
    ): Promise<TransactionHistoryResponse>;
    get_latest_block(): Promise<bigint>;
    detect_birthday_from_transparent_address(transparent_address: string): Promise<number | undefined>;
    pczt_create(account_id: number, to_address: string, value: bigint): Promise<Pczt>;
    pczt_shield(account_id: number): Promise<Pczt>;
    pczt_prove(pczt: Pczt, sapling_proof_gen_key?: ProofGenerationKey | null): Promise<Pczt>;
    pczt_send(pczt: Pczt): Promise<void>;
  }
}

declare module '@chainsafe/webzjs-keys' {
  export default function init(moduleOrPath?: unknown): Promise<unknown>;

  export class Pczt {
    free(): void;
    serialize(): Uint8Array;
    static from_bytes(bytes: Uint8Array): Pczt;
  }

  export class ProofGenerationKey {
    free(): void;
  }

  export class SeedFingerprint {
    free(): void;
    constructor(seed: Uint8Array);
  }

  export class UnifiedFullViewingKey {
    free(): void;
    constructor(network: string, encoding: string);
    encode(network: string): string;
    get_transparent_address(network: string): string | undefined;
  }

  export class UnifiedSpendingKey {
    free(): void;
    constructor(network: string, seed: Uint8Array, hd_index: number);
    to_unified_full_viewing_key(): UnifiedFullViewingKey;
    to_sapling_proof_generation_key(): ProofGenerationKey;
  }

  export function pczt_sign(
    network: string,
    pczt: Pczt,
    usk: UnifiedSpendingKey,
    seed_fp: SeedFingerprint,
  ): Promise<Pczt>;
}
