// The network upgrades the vendored WebZjs builds transactions for, and the
// ones it lacks, so WebzjsEngine.networkStatus() can tell whether the network
// still accepts what it builds.
//
// These lists MUST change with vendor/ (WEBZJS_COMMIT in scripts/build-webzjs.sh
// and patches/webzjs/). It mirrors zcash_protocol's BranchId and
// MainNetwork::activation_height in the librustzcash that WebZjs pins: today
// ChainSafe/librustzcash-nu61 at 52efe30, which stops at NU6.1 (NU7 is only
// behind cfg(zcash_unstable) there, with a placeholder branch id). Add an
// upgrade here only once the vendored engine really implements it.

import { localStatus, networkStatusFor, type EngineRules, type KnownUpgrade, type LightdInfo } from './lightd';
import type { NetworkStatus } from './types';

export const WEBZJS_UPGRADES: readonly KnownUpgrade[] = [
  { name: 'Overwinter', branchId: '5ba81b19', activation: 347_500 },
  { name: 'Sapling', branchId: '76b809bb', activation: 419_200 },
  { name: 'Blossom', branchId: '2bb40e60', activation: 653_600 },
  { name: 'Heartwood', branchId: 'f5b9230b', activation: 903_000 },
  { name: 'Canopy', branchId: 'e9ff75a6', activation: 1_046_400 },
  { name: 'NU5', branchId: 'c2d6d0b4', activation: 1_687_104 },
  { name: 'NU6', branchId: 'c8e71055', activation: 2_726_400 },
  { name: 'NU6.1', branchId: '4dec4df0', activation: 3_146_400 },
];

/**
 * Scheduled or active mainnet upgrades the vendored engine does not implement
 * (branch ids from ZIP 200's registry; heights as upstream zcash_protocol
 * and the live servers report them).
 * Remove one only once the engine implements it; add any newly scheduled one.
 */
export const WEBZJS_MISSING_UPGRADES: readonly KnownUpgrade[] = [
  { name: 'NU6.2', branchId: '5437f330', activation: 3_364_600 },
  { name: 'NU6.3', branchId: '37a5165b', activation: 3_428_143 },
  { name: 'NU7', branchId: '77190ad9', activation: 3_543_405 },
];

export const WEBZJS_RULES: EngineRules = { known: WEBZJS_UPGRADES, missing: WEBZJS_MISSING_UPGRADES };

/**
 * A mainnet height a server reported at a time (2026-10-28 12:50:36 UTC): the
 * chain has surely reached it whenever this code runs, whatever the device's
 * clock says. Move it forward now and then; it never needs to be exact.
 */
const CHAIN_ANCHOR = { height: 3_533_575, time: Date.UTC(2026, 9, 28, 12, 50, 36) };
/**
 * Slower than mainnet has ever averaged since Blossom (about 75.4 s), and
 * blind to NU7's 25 s blocks, so the floor stays under the real height.
 */
const FLOOR_BLOCK_SECONDS = 80;
/** A device clock this far ahead still does not raise the floor. */
const CLOCK_SLACK_MS = 2 * 86_400_000;

/** A mainnet height the chain has surely reached at `now`. */
export function chainFloor(now: Date): number {
  const seconds = (now.getTime() - CLOCK_SLACK_MS - CHAIN_ANCHOR.time) / 1000;
  return CHAIN_ANCHOR.height + Math.max(0, Math.floor(seconds / FLOOR_BLOCK_SECONDS));
}

/** WebzjsEngine.networkStatus(): a server's answer judged against this engine's rules. */
export function webzjsNetworkStatus(info: LightdInfo, now: Date): NetworkStatus {
  return networkStatusFor(info, WEBZJS_RULES, 'main', chainFloor(now));
}

/** WebzjsEngine.localNetworkStatus(): what this engine knows without a server. */
export function webzjsLocalStatus(now: Date): NetworkStatus | null {
  return localStatus(WEBZJS_RULES, chainFloor(now));
}
