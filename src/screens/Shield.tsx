import { useEffect, useRef, useState } from 'react';

import { Screen } from '../components/ui';
import { useI18n } from '../i18n';
import { formatZec } from '../lib/zec';
import { useController, useWallet } from '../state/wallet';
import type { Tab } from './Main';
import { SpendConfirm } from './SpendSteps';

export function Shield({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { t, lang } = useI18n();
  const controller = useController();
  const { summary, spending } = useWallet();
  // Kept from before the spend: the live transparent balance drops to zero once it is sent.
  const [shielded, setShielded] = useState<bigint | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (shielded !== null) resultRef.current?.focus();
  }, [shielded]);

  const transparent = summary?.balances.transparent ?? 0n;
  const fmt = (z: bigint) => formatZec(z, { locale: lang });
  const close = () => onNavigate('home');

  return (
    <Screen title={t('shield.title')} onBack={spending ? undefined : close}>
      {shielded !== null ? (
        <>
          <div className="result">
            <span className="result-icon" aria-hidden="true">
              ✓
            </span>
            <h2 ref={resultRef} tabIndex={-1}>
              {t('shield.sentTitle', { amount: fmt(shielded) })}
            </h2>
            <p className="muted">{t('shield.success')}</p>
          </div>
          <div className="row">
            <button type="button" className="secondary" onClick={() => onNavigate('history')}>
              {t('common.viewHistory')}
            </button>
            <button type="button" className="primary" onClick={close}>
              {t('common.close')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{t('shield.intro', { amount: fmt(transparent) })}</p>
          <SpendConfirm
            submitLabel={t('shield.confirm')}
            onViewHistory={() => onNavigate('history')}
            run={async (password, onStage) => {
              const amount = transparent;
              await controller.shield(password, onStage);
              setShielded(amount);
            }}
          />
        </>
      )}
    </Screen>
  );
}
