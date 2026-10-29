// Which errors of the vendored WebZjs mean what. Kept apart from the adapter
// (./webzjs.ts), which loads the wasm packages, so the rules can be unit-tested.
//
// WebZjs hands errors to JavaScript as plain Error objects whose message is the
// Rust error's Display text (webzjs-wallet error.rs: `js_sys::Error::new(&e.to_string())`),
// so the message is all there is to match. The texts come from
// engine/zcash_client_memory/src/error.rs (`Error::UnsupportedFormat(Option<u32>)`), and
// tests/unit/webzjs-errors.test.ts checks that source still says them.

import { NewerDatabaseFormatError, OldDatabaseFormatError, SpendRefusedError } from './types';
import { WEBZJS_UPGRADES } from './webzjs-upgrades';

/**
 * `MemoryWalletDb::decode_new` (serialization.rs) refuses a blob that does not start
 * with its magic as UnsupportedFormat(None): the protobuf format the WebZjs before the
 * port wrote. A blob with the magic but another format version is UnsupportedFormat(Some(v)):
 * version 1 is the first of this format, so any other comes from a newer build.
 */
const UNSUPPORTED_FORMAT = /Unsupported wallet data format \(version (None|Some\((\d+)\))\)/;

/** What an error from `new WebWallet(…, db)` means for Celari; other errors come back unchanged. */
export function openError(e: unknown): unknown {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : null;
  const match = message === null ? null : UNSUPPORTED_FORMAT.exec(message);
  if (!match) return e;
  return match[1] === 'None' ? new OldDatabaseFormatError({ cause: e }) : new NewerDatabaseFormatError({ cause: e });
}

/**
 * The send refusals of the vendored WebZjs (webzjs-wallet error.rs, patches/webzjs/0004, round 6;
 * docs/engine-port.md, Decision 23): an Error whose message starts with "<code>: " and that
 * carries `code` and the error's numbers as properties. All three are raised before anything
 * is stored or broadcast.
 */
const REFUSAL = /^(UpgradePending|PcztWrongBranch|PcztExpired): /;
/** The numbers of UpgradePending in its text, for an Error that lost its properties on the way. */
const UPGRADE_PENDING = /^UpgradePending: Network upgrade at height (\d+) in (\d+) blocks/;
/**
 * zcash_client_backend's InsufficientFunds in the glue's generic error (Debug format), from
 * pczt_create: "An generic error occurred: Failed to propose the transfer (possibly insufficient
 * balance): InsufficientFunds { available: Zatoshis(0), required: Zatoshis(50010000) }", and from
 * pczt_shield: "An generic error occurred: Error when shielding: Change(InsufficientFunds { … })".
 * `required` includes the fee.
 */
const INSUFFICIENT_FUNDS = /\bInsufficientFunds \{ available: Zatoshis\((\d+)\), required: Zatoshis\((\d+)\) \}/;

function messageOf(e: unknown): string | null {
  return e instanceof Error ? e.message : typeof e === 'string' ? e : null;
}

function refusal(e: unknown, message: string): SpendRefusedError | null {
  const props: Record<string, unknown> = typeof e === 'object' && e !== null ? (e as Record<string, unknown>) : {};
  const code = typeof props.code === 'string' ? props.code : REFUSAL.exec(message)?.[1];
  const num = (name: string, fallback: string | undefined) => {
    const v = typeof props[name] === 'number' ? (props[name] as number) : fallback === undefined ? NaN : Number(fallback);
    return Number.isSafeInteger(v) ? v : null;
  };
  switch (code) {
    case 'UpgradePending': {
      const text = UPGRADE_PENDING.exec(message);
      const activationHeight = num('activation_height', text?.[1]);
      const upgrade = WEBZJS_UPGRADES.find((u) => u.activation === activationHeight)?.name ?? null;
      return new SpendRefusedError(
        { reason: 'upgradePending', activationHeight, blocksLeft: num('blocks_left', text?.[2]), upgrade },
        { cause: e },
      );
    }
    case 'PcztWrongBranch':
      return new SpendRefusedError({ reason: 'wrongBranch' }, { cause: e });
    case 'PcztExpired':
      return new SpendRefusedError({ reason: 'expired' }, { cause: e });
    default:
      return null;
  }
}

/**
 * What an error from pczt_create or pczt_shield means: a SpendRefusedError for the refusals and
 * for a balance that does not cover the payment (nothing was built), else the error unchanged.
 */
export function buildError(e: unknown): unknown {
  const message = messageOf(e);
  if (message === null) return e;
  const refused = refusal(e, message);
  if (refused) return refused;
  const funds = INSUFFICIENT_FUNDS.exec(message);
  if (!funds) return e;
  return new SpendRefusedError(
    { reason: 'insufficientFunds', availableZats: BigInt(funds[1]!), requiredZats: BigInt(funds[2]!) },
    { cause: e },
  );
}

/**
 * What an error from pczt_send means: a SpendRefusedError only for the three refusals raised
 * before the transaction is stored or broadcast; any other error comes back unchanged, since
 * the transaction may have reached the network.
 */
export function sendError(e: unknown): unknown {
  const message = messageOf(e);
  return (message !== null && refusal(e, message)) || e;
}
