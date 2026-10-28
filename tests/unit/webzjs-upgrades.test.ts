import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { decodeLightdInfo, grpcWebUnary, type LightdInfo } from '../../src/engine/lightd';
import {
  WEBZJS_MISSING_UPGRADES,
  WEBZJS_UPGRADES,
  chainFloor,
  webzjsLocalStatus,
  webzjsNetworkStatus,
} from '../../src/engine/webzjs-upgrades';
import { NU7_ACTIVATION_HEIGHT } from '../../src/lib/birthday';

const CAPTURED = new Uint8Array(readFileSync(new URL('../fixtures/lightdinfo.bin', import.meta.url)));
// The anchor chainFloor counts from: 3,533,575 at 2026-10-28 12:50:36 UTC.
const ANCHOR = Date.UTC(2026, 9, 28, 12, 50, 36);
const DAY = 86_400_000;

const stuck: LightdInfo = {
  version: 'v0.4.0',
  vendor: 'ECC LightWalletD',
  chainName: 'main',
  consensusBranchId: '4dec4df0',
  blockHeight: 3_300_000,
  upgradeName: '',
  upgradeHeight: 0,
};

describe('WebZjs and the network it runs on', () => {
  it('keeps a floor under the real chain height, whatever the clock says', () => {
    expect(chainFloor(new Date(ANCHOR))).toBe(3_533_575);
    // A clock set back years, or only two days ahead, never lowers or raises it.
    expect(chainFloor(new Date(Date.UTC(2020, 0, 1)))).toBe(3_533_575);
    expect(chainFloor(new Date(ANCHOR + 2 * DAY))).toBe(3_533_575);
    // 80 s blocks after that: slower than mainnet's ~75.4 s average and NU7's 25 s.
    expect(chainFloor(new Date(ANCHOR + 2 * DAY + 80_000_000))).toBe(3_533_575 + 1000);
    for (const days of [30, 400, 730]) {
      const real = 3_533_575 + Math.floor((days * DAY) / 75_400);
      expect(chainFloor(new Date(ANCHOR + days * DAY)), `${days} days on`).toBeLessThan(real);
    }
  });

  it('is behind the network now, whatever a server or the clock says', () => {
    const live = decodeLightdInfo(grpcWebUnary(CAPTURED));
    for (const now of [new Date(ANCHOR), new Date(Date.UTC(2020, 0, 1)), new Date(ANCHOR + 365 * DAY)]) {
      expect(webzjsNetworkStatus(live, now)).toMatchObject({ supported: false, behind: 'engine' });
      // A server stuck on NU6.1 at a height from before NU6.2 is not believed.
      const lacks = expect.arrayContaining(['NU6.2', 'NU6.3']);
      expect(webzjsNetworkStatus(stuck, now)).toMatchObject({ supported: false, behind: 'engine', lacks });
      expect(webzjsLocalStatus(now)).toMatchObject({ supported: false, behind: 'engine', lacks });
    }
  });

  it('counts NU7 among what it lacks once the floor passes it', () => {
    expect(webzjsLocalStatus(new Date(ANCHOR))?.lacks).toEqual(['NU6.2', 'NU6.3']);
    expect(webzjsLocalStatus(new Date(ANCHOR + 365 * DAY))?.lacks).toEqual(['NU6.2', 'NU6.3', 'NU7']);
  });

  it('agrees with the birthday estimate on when NU7 activates', () => {
    const nu7 = [...WEBZJS_UPGRADES, ...WEBZJS_MISSING_UPGRADES].find((u) => u.name === 'NU7');
    expect(nu7?.activation).toBe(NU7_ACTIVATION_HEIGHT);
  });

  it('lists every upgrade once, oldest first, with registry branch ids', () => {
    const all = [...WEBZJS_UPGRADES, ...WEBZJS_MISSING_UPGRADES];
    for (let i = 1; i < all.length; i++) expect(all[i]!.activation).toBeGreaterThan(all[i - 1]!.activation);
    expect(new Set(all.map((u) => u.branchId)).size).toBe(all.length);
    for (const u of all) expect(u.branchId).toMatch(/^[0-9a-f]{8}$/);
  });
});
