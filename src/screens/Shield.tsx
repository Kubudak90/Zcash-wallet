import { useEffect, useRef, useState, type CSSProperties } from 'react';

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

/**
 * Where shielding takes the funds and what it costs: the confirm step and the
 * result list the same rows. No privacy tag: the transparent inputs, their
 * address and the amount are public, so it is not a "Shielded" payment
 * (History calls it "Shielded · amount public"); From and To say each side.
 */
function ShieldRows({ ironwood, fee }: { ironwood: boolean; fee: string }) {
  const { t } = useI18n();
  return (
    <>
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
        <dt>{t('shield.fee')}</dt>
        {/* A lower bound, as on Send: ZIP 317 adds 5,000 zats for each further input (review round 7, ES-4). */}
        <dd>{t('send.atLeast', { amount: fee })}</dd>
      </div>
    </>
  );
}

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
  const amount = fmt(transparent);

  return (
    // No Back once it is done, as on Send's result: Close there goes to the same place.
    <Screen title={t('shield.title')} onBack={spending || shielded !== null ? undefined : onClose}>
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
          <dl className="summary">
            <ShieldRows ironwood={ironwood} fee={fmt(TYPICAL_FEE_ZATS)} />
          </dl>
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
                    <span className="figure" style={{ '--chars': amount.length } as CSSProperties}>
                      {amount}
                    </span>{' '}
                    <span className="unit">ZEC</span>
                  </dd>
                </div>
              </dl>
              {/* Since NU6.3 shielded funds go to Ironwood; an engine without it shielded into Orchard. */}
              <p className="summary-lead">
                {t(ironwood ? 'shield.intro' : 'shield.introOrchard', { amount })}
              </p>
              <dl className="summary">
                <ShieldRows ironwood={ironwood} fee={fmt(TYPICAL_FEE_ZATS)} />
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
