import { useEffect, useId, useState } from 'react';

import { GroupedAddress } from '../components/GroupedAddress';
import { Icon } from '../components/icons';
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
  const kindId = useId();

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
  const preparing = !transparent && !shielded;
  const toggle = (
    <button type="button" className="secondary receive-toggle" onClick={() => setTransparent((v) => !v)}>
      {t(transparent ? 'receive.showUnified' : 'receive.showTransparent')}
      <Icon name="arrowRight" />
    </button>
  );

  return (
    <Screen
      title={t('receive.title')}
      subtitle={
        !transparent && shielded ? (
          <span data-testid="receive-fresh-note">{t(shielded.fresh ? 'receive.freshNote' : 'receive.previousNote')}</span>
        ) : undefined
      }
    >
      <div className="receive-layout">
        {/* Before the address: what happens to payments sent to it. */}
        {outdated && !transparent && (
          <Notice tone="warn">
            <p data-testid="receive-outdated">{t('receive.outdatedWarn')}</p>
          </Notice>
        )}
        <section className={transparent ? 'card receive-card is-transparent' : 'card receive-card'} aria-labelledby={kindId}>
          <div className="receive-qr">
            {address ? (
              // Light paper and its quiet zone in both themes; the code element holds the SVG only.
              <QrCode value={address} label={label} />
            ) : (
              <div className="qr-wait" aria-hidden="true">
                {preparing && <Spinner />}
              </div>
            )}
          </div>
          <div className="receive-main">
            <div className="receive-head">
              <h2 id={kindId} className="address-kind">
                {label}
              </h2>
              {transparent && (
                <span className="kind-tag kind-public">
                  <span className="kind-mark" aria-hidden="true" />
                  {t('send.privacy.public')}
                </span>
              )}
            </div>
            {preparing ? (
              <p className="muted receive-preparing" data-testid="receive-preparing">
                <Spinner /> {t('receive.preparing')}
              </p>
            ) : address ? (
              <>
                {/* Grouped by four for reading; its text, and so a copy, is the address itself. */}
                <code className="address address-groups" data-testid="receive-address">
                  <GroupedAddress value={address} />
                </code>
                <div className="receive-actions">
                  <CopyButton value={address} />
                </div>
                <p className="field-help with-icon">
                  <Icon name="info" />
                  <span>{t('receive.verifyHint')}</span>
                </p>
              </>
            ) : (
              <p className="muted">{t('receive.noTransparent')}</p>
            )}
            {transparent && <Notice tone="warn">{t('receive.transparentHelp')}</Notice>}
          </div>
        </section>

        <aside className="card receive-about" aria-label={t('receive.about')}>
          <div className="about-sec">
            <h2 className="about-head">
              <Icon name="shield" className="about-icon shielded" />
              {t('receive.unifiedTitle')}
            </h2>
            {/* "Funds land directly in your shielded balance" is not true while the warning above shows. */}
            <p>{t(outdated ? 'receive.safeToShare' : 'receive.unifiedHelp')}</p>
            {transparent && toggle}
          </div>
          {/* Shown, the transparent address carries this warning itself. */}
          {!transparent && (
            <div className="about-sec">
              <h2 className="about-head">
                <Icon name="eye" className="about-icon public" />
                {t('receive.transparent')}
              </h2>
              <p>{t('receive.transparentHelp')}</p>
              {toggle}
            </div>
          )}
        </aside>
      </div>
    </Screen>
  );
}
