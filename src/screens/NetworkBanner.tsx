import { Notice } from '../components/ui';
import { useI18n } from '../i18n';
import { networkView, spendingDisabled, unsupportedUpcoming, type NetworkView } from '../lib/network';
import { useWallet } from '../state/wallet';

export function useNetworkView(): NetworkView {
  return networkView(useWallet().network);
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
  const upcoming = unsupportedUpcoming(network);
  if (!spendingDisabled(view) && !upcoming) return null;
  return (
    <div className="network-banner" data-testid="network-banner">
      {view.kind === 'outdated' && (
        <Notice tone="warn">
          <strong>{t('network.outdatedTitle')}</strong>
          <p>{t('network.outdatedText', { upgrade: view.upgrade })}</p>
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
