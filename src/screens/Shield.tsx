import { useEffect, useRef, useState } from 'react';

import { Icon } from '../components/icons';
import { Screen } from '../components/ui';
import { TYPICAL_FEE_ZATS } from '../engine';
import { useI18n } from '../i18n';
import { spendingDisabled } from '../lib/network';
import { formatZec } from '../lib/zec';
import { useController, useWallet } from '../state/wallet';
import type { Tab } from './Main';
import { useNetworkView } from './NetworkBanner';
import { SpendConfirm } from './SpendSteps';

/** `onClose` returns to the screen Shield was opened from. */
export function Shield({ onNavigate, onClose }: { onNavigate: (tab: Tab) => void; onClose: () => void }) {
  const { t, lang } = useI18n();
  const controller = useController();
  const { summary, spending, ironwood } = useWallet();
  const network = useNetworkView();
  // Kept from before the spend: the live transparent balance drops to zero once it is sent.
  const [shielded, setShielded] = useState<bigint | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (shielded !== null) resultRef.current?.focus();
  }, [shielded]);

  const transparent = summary?.balances.transparent ?? 0n;
  const fmt = (z: bigint) => formatZec(z, { locale: lang });

  return (
    <Screen title={t('shield.title')} onBack={spending ? undefined : onClose}>
      {shielded !== null ? (
        <div className="card spend-done">
          <div className="result">
            <span className="result-icon" aria-hidden="true">
              <Icon name="check" />
            </span>
            <h2 ref={resultRef} tabIndex={-1}>
              {t('shield.sentTitle', { amount: fmt(shielded) })}
            </h2>
            <p className="muted">{t('shield.success')}</p>
          </div>
          <div className="row spend-done-actions">
            <button type="button" className="secondary" onClick={() => onNavigate('history')}>
              {t('common.viewHistory')}
            </button>
            <button type="button" className="primary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      ) : (
        <div className="spend-layout confirm-layout">
          {/* While shielding is disabled SpendConfirm says so in place of the form, and nothing here is on offer. */}
          {!spendingDisabled(network) && (
            <div className="card spend-summary">
              <dl className="summary summary-hero">
                <div className="summary-amount">
                  <dt>{t('shield.amount')}</dt>
                  <dd>
                    <span className="figure">{fmt(transparent)}</span> <span className="unit">ZEC</span>
                  </dd>
                </div>
                <div className="summary-privacy">
                  <dt className="visually-hidden">{t('send.privacy')}</dt>
                  <dd>
                    <span className="kind-tag kind-shielded">
                      <span className="kind-mark" aria-hidden="true" />
                      {t('send.privacy.shielded')}
                    </span>
                  </dd>
                </div>
              </dl>
              {/* Since NU6.3 shielded funds go to Ironwood; an engine without it shielded into Orchard. */}
              <p className="summary-lead">
                {t(ironwood ? 'shield.intro' : 'shield.introOrchard', { amount: fmt(transparent) })}
              </p>
              <dl className="summary">
                <div className="summary-move">
                  <dt>{t('shield.from')}</dt>
                  <dd>
                    <span className="kind-tag kind-public">
                      <span className="kind-mark" aria-hidden="true" />
                      {t('shield.fromValue')}
                    </span>
                  </dd>
                </div>
                <div className="summary-move">
                  <dt>{t('shield.to')}</dt>
                  <dd>
                    <span className="kind-tag kind-shielded">
                      <span className="kind-mark" aria-hidden="true" />
                      {t(ironwood ? 'shield.toIronwood' : 'shield.toOrchard')}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>{t('send.confirmFee')}</dt>
                  <dd>~{fmt(TYPICAL_FEE_ZATS)} ZEC</dd>
                </div>
              </dl>
            </div>
          )}
          <div className="card confirm-panel">
            <SpendConfirm
              submitLabel={t('shield.confirm')}
              submitIcon="shieldIn"
              disabledText={t('shield.disabledOutdated')}
              note={
                <>
                  <Icon name="lock" />
                  <span>{t('shield.confirmNote')}</span>
                </>
              }
              onViewHistory={() => onNavigate('history')}
              run={async (password, onStage) => {
                const amount = transparent;
                await controller.shield(password, onStage);
                setShielded(amount);
              }}
            />
          </div>
        </div>
      )}
    </Screen>
  );
}
