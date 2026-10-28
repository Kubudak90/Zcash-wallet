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

import type { EngineRules, KnownUpgrade } from './lightd';

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
