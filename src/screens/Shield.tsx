import { useState } from 'react';

import { Notice, Screen } from '../components/ui';
import { useI18n } from '../i18n';
import { formatZec } from '../lib/zec';
import { useController, useWallet } from '../state/wallet';
import { SpendConfirm } from './SpendSteps';

export function Shield({ onDone }: { onDone: () => void }) {
  const { t, lang } = useI18n();
  const controller = useController();
  const { summary } = useWallet();
  const [done, setDone] = useState(false);

  const transparent = summary?.balances.transparent ?? 0n;

  return (
    <Screen title={t('shield.title')} onBack={onDone}>
      {done ? (
        <>
          <Notice tone="ok">{t('shield.success')}</Notice>
          <button type="button" className="primary" onClick={onDone}>
            {t('common.close')}
          </button>
        </>
      ) : (
        <>
          <p>{t('shield.intro', { amount: formatZec(transparent, { locale: lang }) })}</p>
          <SpendConfirm
            submitLabel={t('shield.confirm')}
            run={async (password, onStage) => {
              await controller.shield(password, onStage);
              setDone(true);
            }}
          />
        </>
      )}
    </Screen>
  );
}
