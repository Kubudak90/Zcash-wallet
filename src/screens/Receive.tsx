import { useState } from 'react';

import { CopyButton, Notice, QrCode, Screen } from '../components/ui';
import { useI18n } from '../i18n';
import { spendingDisabled } from '../lib/network';
import { useWallet } from '../state/wallet';
import { useNetworkView } from './NetworkBanner';

export function Receive() {
  const { t } = useI18n();
  const { addresses } = useWallet();
  // Outdated, or not verified: shielded payments from up-to-date wallets land in a pool this engine cannot see.
  const outdated = spendingDisabled(useNetworkView());
  const [transparent, setTransparent] = useState(false);

  if (!addresses) return <Screen title={t('receive.title')}>…</Screen>;

  const address = transparent ? addresses.transparent : addresses.unified;

  return (
    <Screen title={t('receive.title')}>
      {outdated && !transparent && (
        <Notice tone="warn">
          <p data-testid="receive-outdated">{t('receive.outdatedWarn')}</p>
        </Notice>
      )}
      <h2 className="address-kind">{t(transparent ? 'receive.transparent' : 'receive.unified')}</h2>
      {address ? (
        <>
          <QrCode value={address} label={t(transparent ? 'receive.transparent' : 'receive.unified')} />
          <code className="address" data-testid="receive-address">
            {address}
          </code>
          <CopyButton value={address} />
        </>
      ) : (
        <p className="muted">{t('receive.noTransparent')}</p>
      )}
      {transparent ? (
        <Notice tone="warn">{t('receive.transparentHelp')}</Notice>
      ) : (
        // "Funds land directly in your shielded balance" is not true while the warning above shows.
        !outdated && <p className="muted">{t('receive.unifiedHelp')}</p>
      )}
      <button type="button" className="link" onClick={() => setTransparent((v) => !v)}>
        {t(transparent ? 'receive.showUnified' : 'receive.showTransparent')}
      </button>
    </Screen>
  );
}
