import type { CSSProperties, ReactNode } from 'react';

import type { HistoryItem, TxType } from '../engine';
import { useI18n } from '../i18n';
import { txPrivacy, type Privacy } from '../lib/privacy';
import { formatZec } from '../lib/zec';
import { Icon, type IconName } from './icons';
import { AmountParts, CopyButton, useHideBalances } from './ui';

/**
 * Full, half and empty marks back the words up without colour (CSS draws them
 * from the class, the glyph is the same shape for anything that reads text);
 * the two half-shielded labels differ in words.
 */
const PRIVACY_MARK: Record<Privacy, string> = { shielded: '●', shielding: '◐', partial: '◐', transparent: '○' };

const TYPE_ICON: Record<TxType, IconName> = { received: 'receive', sent: 'send', shielded: 'shieldIn' };

/** Dates as History shows them, in the interface language. */
export function useTxDate(): (tx: HistoryItem) => string | null {
  const { lang } = useI18n();
  const fmt = new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  return (tx) => (tx.timestamp ? fmt.format(new Date(tx.timestamp * 1000)) : null);
}

/**
 * The style a list of rows needs so their decimal points line up: every
 * fraction is as wide (in ch) as the longest one in the list, separator
 * included, so short ones leave no gap where none is needed.
 */
export function useFractionWidth(txs: HistoryItem[]): CSSProperties {
  const { lang } = useI18n();
  const point = lang === 'tr' ? ',' : '.';
  let widest = 3;
  for (const tx of txs) {
    const digits = formatZec(tx.valueZats < 0n ? -tx.valueZats : tx.valueZats, { locale: lang });
    const at = digits.indexOf(point);
    if (at >= 0) widest = Math.max(widest, digits.length - at);
  }
  return { '--tx-frac': `${widest}ch` } as CSSProperties;
}

/**
 * One transaction in a list: what it was, when, how private, and its signed
 * amount, decimal points lined up down the list. Shared by History and the
 * Recent activity on Balance; only History offers the transaction ID, either
 * as `copyId` or in its own `children`, which close the row.
 */
export function TxRow({ tx, copyId = false, children }: { tx: HistoryItem; copyId?: boolean; children?: ReactNode }) {
  const { t } = useI18n();
  const balances = useHideBalances();
  const date = useTxDate()(tx);
  const privacy = txPrivacy(tx);
  return (
    <li className={`tx tx-${tx.type}`}>
      <span className="tx-icon">
        <Icon name={TYPE_ICON[tx.type]} />
      </span>
      <div className="tx-main">
        <span className="tx-type">{t(`history.type.${tx.type}`)}</span>
        {tx.memo && <p className="tx-memo">“{tx.memo}”</p>}
        {tx.feeZats !== null && tx.feeZats > 0n && (
          <span className="tx-fee">{t('history.fee', { amount: balances.fmt(tx.feeZats) })}</span>
        )}
      </div>
      {date && <span className="tx-date">{date}</span>}
      {/* No label where WebZjs could not tell the pool: none is better than a guess. */}
      {privacy && (
        <span className={`privacy privacy-${privacy}`}>
          <span className="privacy-mark" aria-hidden="true">
            {PRIVACY_MARK[privacy]}
          </span>{' '}
          <span className="visually-hidden">{t('history.privacyLabel')}: </span>
          {t(`history.privacy.${privacy}`)}
        </span>
      )}
      <div className="tx-value">
        <span className={tx.valueZats < 0n ? 'tx-amount out' : 'tx-amount in'}>
          <span className="amt">
            <AmountParts zats={tx.valueZats} signed />
          </span>{' '}
          <span className="amt-unit">ZEC</span>
        </span>
        <span className={`status status-${tx.status}`}>{t(`history.status.${tx.status}`)}</span>
      </div>
      {copyId && (
        <div className="tx-actions">
          <CopyButton value={tx.txid} label={t('history.copyTxid')} />
        </div>
      )}
      {children}
    </li>
  );
}
