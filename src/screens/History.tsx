import { CopyButton, Screen } from '../components/ui';
import { useI18n } from '../i18n';
import { formatZec } from '../lib/zec';
import { useWallet } from '../state/wallet';

export function History() {
  const { t, lang } = useI18n();
  const { history } = useWallet();
  const fmt = (z: bigint) => formatZec(z, { locale: lang });
  const dateFmt = new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <Screen title={t('history.title')}>
      {history.length === 0 ? (
        <p className="muted">{t('history.empty')}</p>
      ) : (
        <ul className="history" data-testid="history">
          {history.map((tx) => (
            <li key={tx.txid} className={`tx tx-${tx.type}`}>
              <div className="tx-main">
                <span className="tx-type">{t(`history.type.${tx.type}`)}</span>
                <span className={tx.valueZats < 0n ? 'tx-amount out' : 'tx-amount in'}>
                  {tx.valueZats > 0n ? '+' : ''}
                  {fmt(tx.valueZats)} ZEC
                </span>
              </div>
              <div className="tx-meta muted small">
                <span className={`status status-${tx.status}`}>{t(`history.status.${tx.status}`)}</span>
                {tx.timestamp && <span>{dateFmt.format(new Date(tx.timestamp * 1000))}</span>}
                {tx.feeZats !== null && tx.feeZats > 0n && <span>{t('history.fee', { amount: fmt(tx.feeZats) })}</span>}
              </div>
              {tx.memo && <p className="tx-memo">“{tx.memo}”</p>}
              <CopyButton value={tx.txid} label={t('history.copyTxid')} />
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
