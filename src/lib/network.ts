// Whether the network still accepts what the engine builds, derived from the
// controller's last network check. Kept pure so its rules (fail closed) can be
// unit-tested.

import type { NetworkStatus } from '../engine/types';

export interface NetworkCheck {
  /** The last answer from the server (ZcashEngine.networkStatus); null until one arrives. */
  status: NetworkStatus | null;
  /** The last check's error; it stands until a check succeeds again. */
  error: string | null;
}

export type NetworkView =
  /** No answer yet: spending waits, nothing is claimed about the network. */
  | { kind: 'checking' }
  | { kind: 'supported' }
  /** The network runs rules the engine does not support; `upgrade` names them. */
  | { kind: 'outdated'; upgrade: string }
  /** The last check failed, so support is not verified. */
  | { kind: 'unverified' };

/** Names for the branch ids a server may report (ZIP 200's registry); others show as raw hex. */
const BRANCH_NAMES: Record<string, string> = {
  '5ba81b19': 'Overwinter',
  '76b809bb': 'Sapling',
  '2bb40e60': 'Blossom',
  f5b9230b: 'Heartwood',
  e9ff75a6: 'Canopy',
  c2d6d0b4: 'NU5',
  c8e71055: 'NU6',
  '4dec4df0': 'NU6.1',
  '5437f330': 'NU6.2',
  '37a5165b': 'NU6.3 (Ironwood)',
  '77190ad9': 'NU7',
};

/** The upgrade a consensus branch id belongs to, e.g. 'NU6.3 (Ironwood)', or '0x…' if unknown. */
export function branchName(branchId: string): string {
  return BRANCH_NAMES[branchId] ?? `0x${branchId}`;
}

/**
 * An upgrade name as the server sends it (lightwalletd upgradeName). Known
 * ones get the name Celari uses; anything else is shown only if it looks like
 * an upgrade name, since a server should not get to write sentences into the UI.
 */
export function upgradeName(name: string): string | null {
  const known = Object.values(BRANCH_NAMES).find((n) => n.split(' ')[0]!.toLowerCase() === name.trim().toLowerCase());
  if (known) return known;
  if (name.trim().toLowerCase() === 'ironwood') return BRANCH_NAMES['37a5165b']!;
  return /^[A-Za-z0-9._-]{1,16}$/.test(name.trim()) ? name.trim() : null;
}

export function networkView(check: NetworkCheck): NetworkView {
  const { status, error } = check;
  // The network never goes back to older rules, so a failed check after
  // "not supported" still means not supported.
  if (status && !status.supported) return { kind: 'outdated', upgrade: branchName(status.branchId) };
  if (error !== null) return { kind: 'unverified' };
  if (!status) return { kind: 'checking' };
  return { kind: 'supported' };
}

/** Spending needs a fresh, successful check that says the engine supports the network. */
export function canSpend(check: NetworkCheck): boolean {
  return networkView(check).kind === 'supported';
}

/**
 * The network said no, or could not be asked: Send and Shield say so instead
 * of showing their forms. Before the first answer ('checking') a spend only waits.
 */
export function spendingDisabled(view: NetworkView): view is Extract<NetworkView, { kind: 'outdated' | 'unverified' }> {
  return view.kind === 'outdated' || view.kind === 'unverified';
}

/** An announced upgrade the engine will not support, to warn about ahead of time. */
export function unsupportedUpcoming(check: NetworkCheck): { name: string; height: number } | null {
  const upcoming = check.status?.upcoming;
  if (!upcoming || upcoming.supported) return null;
  const name = upgradeName(upcoming.name);
  return name === null ? null : { name, height: upcoming.height };
}
