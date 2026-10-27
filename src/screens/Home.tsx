import { Notice } from '../components/ui';
import { SHIELDING_THRESHOLD_ZATS, TYPICAL_FEE_ZATS, grandTotal, shieldedTotal } from '../engine';
import { useI18n } from '../i18n';
import { formatZec } from '../lib/zec';
import { useWallet } from '../state/wallet';
import type { Tab } from './Main';
import { useSyncPercent } from './Main';

export function Home({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { t, lang } = useI18n();
  const { summary, meta } = useWallet();
  const pct = useSyncPercent();
  const fmt = (z: bigint) => formatZec(z, { locale: lang });

  const b = summary?.balances;
  const viewOnly = meta?.kind === 'view';
  const shieldable = b ? b.transparent >= SHIELDING_THRESHOLD_ZATS + TYPICAL_FEE_ZATS : false;

  return (
    <section className="screen">
      <div className="balance-card">
        <div className="balance-label">
          {t('home.total')}
          {viewOnly && <span className="badge">{t('home.viewOnly')}</span>}
        </div>
        <div className="balance-total" data-testid="balance-total">
          {b ? fmt(grandTotal(b)) : '—'} <small>ZEC</small>
        </div>
        {pct !== null && pct < 100 && (
          <div className="progress" aria-label={t('sync.syncing', { pct })}>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      {pct !== null && pct < 100 && <p className="muted small">{t('sync.firstSyncNote')}</p>}

      <dl className="balance-rows">
        <div>
          <dt>
            <span className="dot dot-shielded" /> {t('home.shielded')}
          </dt>
          <dd data-testid="balance-shielded">{b ? fmt(shieldedTotal(b)) : '—'} ZEC</dd>
          <p className="muted small">{t('home.shieldedHelp')}</p>
        </div>
        <div>
          <dt>
            <span className="dot dot-transparent" /> {t('home.transparent')}
          </dt>
          <dd data-testid="balance-transparent">{b ? fmt(b.transparent) : '—'} ZEC</dd>
          <p className="muted small">{t('home.transparentHelp')}</p>
        </div>
        {b && b.pending > 0n && (
          <div>
            <dt>
              <span className="dot dot-pending" /> {t('home.pending')}
            </dt>
            <dd>{fmt(b.pending)} ZEC</dd>
          </div>
        )}
      </dl>

      {b && b.transparent > 0n && !viewOnly && (
        <Notice tone="warn">
          <strong>{t('home.shieldTitle')}</strong>
          <p>{t('home.shieldText', { amount: fmt(b.transparent) })}</p>
          {shieldable ? (
            <button type="button" className="primary" onClick={() => onNavigate('shield')}>
              {t('home.shieldButton')}
            </button>
          ) : (
            <p className="small">
              {t('home.shieldBelowThreshold', { amount: fmt(SHIELDING_THRESHOLD_ZATS + TYPICAL_FEE_ZATS) })}
            </p>
          )}
        </Notice>
      )}
    </section>
  );
}
