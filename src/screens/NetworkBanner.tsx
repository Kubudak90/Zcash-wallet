import { Notice } from '../components/ui';
import { useI18n, type Translate } from '../i18n';
import { networkView, spendingDisabled, unsupportedUpcoming, type NetworkView } from '../lib/network';
import { useWallet } from '../state/wallet';

export function useNetworkView(): NetworkView {
  return networkView(useWallet().network);
}

/**
 * Why Send or Shield is off: `outdated` when this version lacks the network's
 * rules, otherwise what would let spending back on.
 */
export function disabledMessage(
  view: Extract<NetworkView, { kind: 'outdated' | 'serverBehind' | 'unverified' }>,
  outdated: string,
  t: Translate,
): string {
  if (view.kind === 'outdated') return outdated;
  return t(view.kind === 'serverBehind' ? 'network.serverBehind' : 'network.unreachable');
}

/**
 * Says, on every screen that shows it, when the network runs rules this
 * version cannot follow (or could not be checked), and which announced
 * upgrade it will not follow. Not dismissible: it lasts as long as that holds.
 */
export function NetworkBanner() {
  const { t, lang } = useI18n();
  const { network } = useWallet();
  const view = networkView(network);
  // Once spending is off, an upgrade that would switch it off says nothing new.
  const upcoming = view.kind === 'supported' ? unsupportedUpcoming(network) : null;
  if (!spendingDisabled(view) && !upcoming) return null;
  return (
    <div className="network-banner" data-testid="network-banner">
      {view.kind === 'outdated' && (
        <Notice tone="warn">
          <strong>{t('network.outdatedTitle')}</strong>
          <p>{t('network.outdatedText', { upgrade: view.upgrade })}</p>
        </Notice>
      )}
      {view.kind === 'serverBehind' && (
        <Notice tone="warn">
          <p>{t('network.serverBehind')}</p>
        </Notice>
      )}
      {view.kind === 'unverified' && (
        <Notice tone="warn">
          <p>{t('network.unreachable')}</p>
        </Notice>
      )}
      {upcoming && (
        <Notice tone="info">
          <p>
            {t('network.upcoming', {
              upgrade: upcoming.name,
              height: upcoming.height.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US'),
            })}
          </p>
        </Notice>
      )}
    </div>
  );
}
