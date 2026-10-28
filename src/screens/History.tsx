import { useId } from 'react';

import { Amount, CopyButton, Screen, useHideBalances } from '../components/ui';
import { useI18n } from '../i18n';
import { txPrivacy, type Privacy } from '../lib/privacy';
import { useWallet } from '../state/wallet';

/** Full, half and empty marks back the words up without colour; the two half-shielded labels differ in words. */
const PRIVACY_MARK: Record<Privacy, string> = { shielded: '●', shielding: '◐', partial: '◐', transparent: '○' };

export function History() {
  const { t, lang } = useI18n();
  const { history } = useWallet();
  const balances = useHideBalances();
  const noteId = useId();
  const dateFmt = new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

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
          <ul className="history" data-testid="history" aria-describedby={noteId}>
            {history.map((tx) => {
              const privacy = txPrivacy(tx);
              return (
                <li key={tx.txid} className={`tx tx-${tx.type}`}>
                  <div className="tx-main">
                    <span className="tx-type">{t(`history.type.${tx.type}`)}</span>
                    <span className={tx.valueZats < 0n ? 'tx-amount out' : 'tx-amount in'}>
                      <Amount zats={tx.valueZats} signed /> ZEC
                    </span>
                  </div>
                  <div className="tx-meta muted small">
                    <span className={`status status-${tx.status}`}>{t(`history.status.${tx.status}`)}</span>
                    {tx.timestamp && <span>{dateFmt.format(new Date(tx.timestamp * 1000))}</span>}
                    {tx.feeZats !== null && tx.feeZats > 0n && (
                      <span>{t('history.fee', { amount: balances.fmt(tx.feeZats) })}</span>
                    )}
                    {/* No label where WebZjs could not tell the pool: none is better than a guess. */}
                    {privacy && (
                      <span className={`privacy privacy-${privacy}`}>
                        <span aria-hidden="true">{PRIVACY_MARK[privacy]}</span>{' '}
                        <span className="visually-hidden">{t('history.privacyLabel')}: </span>
                        {t(`history.privacy.${privacy}`)}
                      </span>
                    )}
                  </div>
                  {tx.memo && <p className="tx-memo">“{tx.memo}”</p>}
                  <CopyButton value={tx.txid} label={t('history.copyTxid')} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Screen>
  );
}
