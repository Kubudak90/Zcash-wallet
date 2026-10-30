import { useId } from 'react';

import { TxRow, useFractionWidth } from '../components/TxRow';
import { Screen } from '../components/ui';
import { useI18n } from '../i18n';
import { useWallet } from '../state/wallet';

export function History() {
  const { t } = useI18n();
  const { history } = useWallet();
  const noteId = useId();
  const fraction = useFractionWidth(history);

  return (
    <Screen title={t('history.title')}>
      {history.length === 0 ? (
        <p className="muted">{t('history.empty')}</p>
      ) : (
        <>
          <p id={noteId} className="muted small">
            {t('history.privacyNote')}
          </p>
          {/* The note scopes every label; a list announces its description on entry, a span would not. */}
          <ul className="history tx-list" data-testid="history" aria-describedby={noteId} style={fraction}>
            {history.map((tx) => (
              <TxRow key={tx.txid} tx={tx} copyId />
            ))}
          </ul>
        </>
      )}
    </Screen>
  );
}
