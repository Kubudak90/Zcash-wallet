// The network upgrades the vendored WebZjs builds transactions for, so
// WebzjsEngine.networkStatus() can tell whether the network still accepts them.
//
// This list MUST change with vendor/ (WEBZJS_COMMIT in scripts/build-webzjs.sh
// and patches/webzjs/). It mirrors zcash_protocol's BranchId and
// MainNetwork::activation_height in the librustzcash that WebZjs pins: today
// ChainSafe/librustzcash-nu61 at 52efe30, which stops at NU6.1 (NU7 is only
// behind cfg(zcash_unstable) there, with a placeholder branch id). Add an
// upgrade here only once the vendored engine really implements it.

import type { KnownUpgrade } from './lightd';

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
