import { useId, useState } from 'react';

import { Icon } from '../components/icons';
import { TxRow, useFractionWidth } from '../components/TxRow';
import { CopyButton, Screen } from '../components/ui';
import type { HistoryItem } from '../engine';
import { useI18n } from '../i18n';
import { useWallet } from '../state/wallet';

interface Month {
  key: string;
  label: string;
  txs: HistoryItem[];
}

/**
 * The list cut into months, in the engine's order: a month starts wherever
 * the previous row was in another one, so no row ever moves. Rows with no
 * block time yet (not mined) get a group of their own.
 */
function useMonths(history: HistoryItem[]): Month[] {
  const { t, lang } = useI18n();
  const fmt = new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { month: 'long', year: 'numeric' });
  const months: Month[] = [];
  for (const tx of history) {
    const date = tx.timestamp ? new Date(tx.timestamp * 1000) : null;
    const key = date ? `${date.getFullYear()}-${date.getMonth()}` : 'undated';
    const last = months.at(-1);
    if (last?.key === key) last.txs.push(tx);
    else months.push({ key, label: date ? fmt.format(date) : t('history.undated'), txs: [tx] });
  }
  return months;
}

/** A History row, with its transaction ID (and the button that copies it) one click away. */
function HistoryRow({ tx }: { tx: HistoryItem }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <TxRow tx={tx}>
      <button
        type="button"
        className="tx-more"
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={t('history.txid')}
        title={t('history.txid')}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          className="icon"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m6 9.5 6 6 6-6" />
        </svg>
      </button>
      <div id={detailId} className="tx-detail" hidden={!open}>
        <p className="txid">
          <span className="txid-label">{t('history.txid')}</span>
          <code>{tx.txid}</code>
        </p>
        <CopyButton value={tx.txid} label={t('history.copyTxid')} />
      </div>
    </TxRow>
  );
}

export function History() {
  const { t } = useI18n();
  const { history } = useWallet();
  const noteId = useId();
  const fraction = useFractionWidth(history);
  const months = useMonths(history);

  if (history.length === 0) {
    return (
      <Screen title={t('history.title')}>
        <div className="card history-empty">
          <span className="history-empty-icon" aria-hidden="true">
            <Icon name="history" />
          </span>
          <p>{t('history.empty')}</p>
          <p className="muted small">{t('history.emptyHelp')}</p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title={t('history.title')} subtitle={<span id={noteId}>{t('history.privacyNote')}</span>}>
      <div className="card history-card">
        {/* Column names for the eye on a wide screen; every row says the same in its own words. */}
        <div className="tx-head" aria-hidden="true">
          <span />
          <span>{t('history.col.transaction')}</span>
          <span>{t('history.col.date')}</span>
          <span>{t('history.col.privacy')}</span>
          <span className="tx-head-amount">{t('history.col.amount')}</span>
          <span />
        </div>
        {/* The note scopes every label; a list announces its description on entry, a span would not. */}
        <ul className="history" data-testid="history" aria-describedby={noteId} style={fraction}>
          {months.map((month, i) => (
            <li key={`${month.key}-${i}`} className="tx-month">
              <h2 className="month-head">{month.label}</h2>
              <ul className="tx-list">
                {month.txs.map((tx) => (
                  <HistoryRow key={tx.txid} tx={tx} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </Screen>
  );
}
