import { useEffect, useState } from 'react';

import { CopyButton, Notice, QrCode, Screen, Spinner } from '../components/ui';
import { useI18n } from '../i18n';
import type { ReceiveAddress } from '../state/controller';
import { useController, useWallet } from '../state/wallet';

export function Receive() {
  const { t } = useI18n();
  const controller = useController();
  const { addresses, ironwood } = useWallet();
  // Since NU6.3, shielded payments from up-to-date wallets land in Ironwood: an engine without it cannot see them.
  const outdated = !ironwood;
  const [transparent, setTransparent] = useState(false);
  // This opening of the screen: it shows one fresh shielded address, also after a
  // switch to the transparent address and back.
  const [visit] = useState(() => ({}));
  const [shielded, setShielded] = useState<ReceiveAddress | null>(null);

  useEffect(() => {
    let current = true;
    controller.receiveAddress(visit).then(
      (a) => current && setShielded(a),
      (e) => console.warn('no shielded address to show', e),
    );
    return () => {
      current = false;
    };
  }, [controller, visit]);

  if (!addresses) return <Screen title={t('receive.title')}>…</Screen>;

  const address = transparent ? addresses.transparent : shielded?.address;
  const label = t(transparent ? 'receive.transparent' : 'receive.unified');

  return (
    <Screen title={t('receive.title')}>
      {outdated && !transparent && (
        <Notice tone="warn">
          <p data-testid="receive-outdated">{t('receive.outdatedWarn')}</p>
        </Notice>
      )}
      <h2 className="address-kind">{label}</h2>
      {!transparent && !shielded ? (
        <p className="muted" data-testid="receive-preparing">
          <Spinner /> {t('receive.preparing')}
        </p>
      ) : address ? (
        <>
          <QrCode value={address} label={label} />
          <code className="address" data-testid="receive-address">
            {address}
          </code>
          <CopyButton value={address} />
          {!transparent && (
            <p className="muted small" data-testid="receive-fresh-note">
              {t(shielded?.fresh ? 'receive.freshNote' : 'receive.previousNote')}
            </p>
          )}
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
