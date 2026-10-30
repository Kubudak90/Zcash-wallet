import { useCallback, useId, useLayoutEffect, useRef, useState, type FocusEvent, type MutableRefObject } from 'react';

import { Icon } from '../components/icons';
import { TxRow, useFractionWidth, useTxDate } from '../components/TxRow';
import { CopyButton, Screen, useHideBalances } from '../components/ui';
import type { HistoryItem } from '../engine';
import { useI18n } from '../i18n';
import { useWallet } from '../state/wallet';

interface Month {
  key: string;
  label: string;
  txs: HistoryItem[];
}

/** Where focus was inside the list: a row's toggle, or the Copy button in its detail. */
type RowFocus = { txid: string; copy: boolean } | null;

/**
 * The list cut into months, in the engine's order: a month starts wherever
 * the previous row was in another one, so no row ever moves. Rows with no
 * block time (pending or expired) get a group of their own.
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

/**
 * A History row, with its transaction ID (and the button that copies it) one
 * click away. Whether it is open lives in History, keyed by txid: a row that
 * moves to another group (mined) is a new element, and keeps its state.
 */
function HistoryRow({
  tx,
  open,
  onToggle,
  focus,
}: {
  tx: HistoryItem;
  open: boolean;
  onToggle: (txid: string) => void;
  focus: MutableRefObject<RowFocus>;
}) {
  const { t } = useI18n();
  const balances = useHideBalances();
  const date = useTxDate()(tx);
  const detailId = useId();
  const descId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // A row that moved between groups was mounted anew, and the control that had
  // focus went with the old one: give focus back to the same control here.
  useLayoutEffect(() => {
    const f = focus.current;
    if (f?.txid !== tx.txid || document.activeElement !== document.body) return;
    (f.copy ? detailRef.current?.querySelector('button') : toggleRef.current)?.focus();
    // On mount only: it is a moved row's first render that has to take focus.
  }, []);

  // Never the dots, and never the real amount while balances are hidden.
  const amount = balances.hidden
    ? t('common.amountHidden')
    : `${tx.valueZats > 0n ? '+' : ''}${balances.fmt(tx.valueZats)} ZEC`;
  const remember = (copy: boolean) => () => {
    focus.current = { txid: tx.txid, copy };
  };
  const forget = (e: FocusEvent) => {
    if (e.relatedTarget) focus.current = null;
  };

  return (
    <TxRow tx={tx}>
      <button
        ref={toggleRef}
        type="button"
        className="tx-more"
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={t('history.txid')}
        // Every row's toggle has this name; the description says which payment it opens.
        aria-describedby={descId}
        title={t('history.txid')}
        onClick={() => onToggle(tx.txid)}
        onFocus={remember(false)}
        onBlur={forget}
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
        <span id={descId} hidden>
          {[t(`history.type.${tx.type}`), date ?? t(`history.status.${tx.status}`), amount].join(', ')}
        </span>
      </button>
      <div ref={detailRef} id={detailId} className="tx-detail" hidden={!open} onFocus={remember(true)} onBlur={forget}>
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
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback(
    (txid: string) =>
      setOpen((s) => {
        const next = new Set(s);
        if (!next.delete(txid)) next.add(txid);
        return next;
      }),
    [],
  );
  const focus = useRef<RowFocus>(null);

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
      {/* The column widths (money.css) follow the amounts, so the header and the rows share them. */}
      <div className="card history-card" style={fraction}>
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
        <ul className="history" data-testid="history" aria-describedby={noteId}>
          {months.map((month) => (
            // Keyed by its oldest row, which stays put when rows join at the top,
            // the pending group goes away or a new month starts: the list is not remounted.
            <li key={month.txs.at(-1)!.txid} className="tx-month">
              <h2 className="month-head">{month.label}</h2>
              <ul className="tx-list">
                {month.txs.map((tx) => (
                  <HistoryRow key={tx.txid} tx={tx} open={open.has(tx.txid)} onToggle={toggle} focus={focus} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </Screen>
  );
}
