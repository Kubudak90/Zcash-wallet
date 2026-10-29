// The shipped network guard, written by the round-4 verifier (NU7 lens), adopted in round 5:
// (webzjsNetworkStatus = networkStatusFor with WEBZJS_RULES and the chain floor) and the
// controller's spend check (nextCheck + canSpend, as requireSupportedNetwork applies them)
// at every height 3,543,390..3,543,410, on 5-6 Nov 2026, against servers that announce NU7
// correctly, announce nothing, or announce another height.

import { describe, expect, it } from 'vitest';

import type { LightdInfo } from '../../src/engine/lightd';
import { chainFloor, WEBZJS_RULES, webzjsNetworkStatus } from '../../src/engine/webzjs-upgrades';
import { canSpend, nextCheck, networkView, type NetworkCheck } from '../../src/lib/network';

const NU7 = 3_543_405;
const NU63 = '37a5165b';
const NU7_ID = '77190ad9';
const HEIGHTS = Array.from({ length: 21 }, (_, i) => 3_543_390 + i);
// About when NU7 activates (the task: 5-6 Nov 2026), and a day later.
const NOW = new Date(Date.UTC(2026, 10, 5, 18, 0, 0));
const LATER = new Date(Date.UTC(2026, 10, 6, 18, 0, 0));

const lightd = (patch: Partial<LightdInfo>): LightdInfo => ({
  version: 'v0.5.3',
  vendor: 'ECC LightWalletD',
  chainName: 'main',
  consensusBranchId: NU63,
  blockHeight: 0,
  upgradeName: '',
  upgradeHeight: 0,
  ...patch,
});

type Server = (h: number) => LightdInfo;
/** zcashd/lightwalletd as captured: the chain tip's branch, the next *pending* upgrade. */
const announces: Server = (h) =>
  h < NU7
    ? lightd({ blockHeight: h, upgradeName: 'NU7', upgradeHeight: NU7 })
    : lightd({ blockHeight: h, consensusBranchId: NU7_ID });
/** The same, but it keeps naming NU7 after activation (an upgrade list that does not filter). */
const keepsAnnouncing: Server = (h) =>
  lightd({ blockHeight: h, consensusBranchId: h < NU7 ? NU63 : NU7_ID, upgradeName: 'NU7', upgradeHeight: NU7 });
/** A node that upgraded but whose server sends no upgrade fields. */
const silent: Server = (h) => lightd({ blockHeight: h, consensusBranchId: h < NU7 ? NU63 : NU7_ID });
/** The network postponed NU7 to 3,543,500: still NU6.3 through 3,543,410. */
const postponed: Server = (h) => lightd({ blockHeight: h, upgradeName: 'NU7', upgradeHeight: 3_543_500 });
/** The network moved NU7 earlier, to 3,543,400. */
const earlier: Server = (h) =>
  h < 3_543_400
    ? lightd({ blockHeight: h, upgradeName: 'NU7', upgradeHeight: 3_543_400 })
    : lightd({ blockHeight: h, consensusBranchId: NU7_ID });

const kind = (server: Server, h: number, now = NOW) => {
  const s = webzjsNetworkStatus(server(h), now);
  return s.supported ? 'supported' : s.behind === 'server' ? 'serverBehind' : 'outdated';
};

/** The controller's state over one page session that sees every height in turn. */
function session(server: Server, now = NOW): Record<number, ReturnType<typeof networkView>['kind']> {
  let check: NetworkCheck = { status: null, error: null };
  const out: Record<number, ReturnType<typeof networkView>['kind']> = {};
  for (const h of HEIGHTS) {
    const seenTip = Math.max(check.status?.height ?? 0, h);
    check = nextCheck(check, webzjsNetworkStatus(server(h), now), seenTip);
    out[h] = networkView(check).kind;
    expect(canSpend(check)).toBe(out[h] === 'supported');
  }
  return out;
}

describe('NU7 activation, as the shipped guard sees it on 5-6 Nov 2026', () => {
  it('the rules are the ported ones and the floor stays under the chain', () => {
    expect(WEBZJS_RULES.missing).toEqual([]);
    expect(WEBZJS_RULES.known.at(-1)).toEqual({ name: 'NU7', branchId: NU7_ID, activation: NU7 });
    // At 75 s blocks from the anchor (3,533,575 on 28 Oct 12:50 UTC), 5 Nov 18:00 is ~3,543,0xx.
    expect(chainFloor(NOW)).toBeLessThan(3_543_390);
    expect(chainFloor(LATER)).toBeLessThan(3_543_390);
  });

  it('a server that announces NU7 at 3,543,405: spending stays on at every height', () => {
    for (const now of [NOW, LATER]) {
      for (const h of HEIGHTS) expect(kind(announces, h, now), `${h}`).toBe('supported');
      expect(Object.values(session(announces, now)).every((k) => k === 'supported')).toBe(true);
    }
    for (const h of HEIGHTS) expect(kind(keepsAnnouncing, h), `${h}`).toBe('supported');
    // The upcoming NU7 is shown as supported before activation, and not at all after it.
    expect(webzjsNetworkStatus(announces(NU7 - 1), NOW).upcoming).toEqual({ name: 'NU7', height: NU7, supported: true });
    expect(webzjsNetworkStatus(announces(NU7), NOW).upcoming).toBeUndefined();
  });

  it('a server that announces nothing: off only in the 6 blocks before activation, on again after', () => {
    for (const h of HEIGHTS) {
      const want = h >= NU7 - 1 - 5 && h < NU7 ? 'serverBehind' : 'supported';
      expect(kind(silent, h), `${h}`).toBe(want);
    }
    const s = session(silent);
    expect(s[NU7 - 7]).toBe('supported');
    expect(s[NU7 - 6]).toBe('serverBehind');
    expect(s[NU7 - 1]).toBe('serverBehind');
    expect(s[NU7]).toBe('supported');
    expect(s[3_543_410]).toBe('supported');
  });

  // Adopted with one change: from the engine's own activation height on (3,543,405) its rules
  // and the network's are NU7's again, so what it builds is accepted ('supported'); the verifier's
  // version expected 'outdated' there too, which the guard never answered (old code: 'supported'
  // from 3,543,405; it stopped at the 3,543,400 failure before checking those heights).
  it('a network that moved NU7 earlier: outdated from 6 blocks before the new height to the engine\'s own', () => {
    for (const h of HEIGHTS) {
      const want = h >= 3_543_400 - 1 - 5 && h < NU7 ? 'outdated' : 'supported';
      expect(kind(earlier, h), `${h}`).toBe(want);
    }
  });

  it('a network that postponed NU7: never supported from 6 blocks before 3,543,405 on', () => {
    const s = session(postponed);
    for (const h of HEIGHTS) {
      expect(s[h] === 'supported', `${h}: ${s[h]}`).toBe(h < NU7 - 6);
    }
  });

  // The guard's own contract (lightd.ts networkStatusFor doc): "Likewise when the engine
  // expects an upgrade the server announces at another height: the network moved it" ->
  // behind: 'engine'. A page opened after 3,543,405 on a network that postponed NU7.
  it('a network that postponed NU7, seen first after 3,543,405, still blames the engine', () => {
    for (const h of HEIGHTS.filter((x) => x >= NU7 - 6)) expect(kind(postponed, h), `${h}`).toBe('outdated');
  });
});
