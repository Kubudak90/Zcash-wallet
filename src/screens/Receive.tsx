import { useState } from 'react';

import { CopyButton, Notice, QrCode, Screen } from '../components/ui';
import { useI18n } from '../i18n';
import { useWallet } from '../state/wallet';

export function Receive() {
  const { t } = useI18n();
  const { addresses, ironwood } = useWallet();
  // Since NU6.3, shielded payments from up-to-date wallets land in Ironwood: an engine without it cannot see them.
  const outdated = !ironwood;
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
