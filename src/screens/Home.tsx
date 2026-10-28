import { Amount, Notice, useHideBalances } from '../components/ui';
import { SHIELDING_THRESHOLD_ZATS, TYPICAL_FEE_ZATS, grandTotal, shieldedTotal } from '../engine';
import { useI18n } from '../i18n';
import { spendingDisabled } from '../lib/network';
import { formatZec } from '../lib/zec';
import { useWallet } from '../state/wallet';
import type { Tab } from './Main';
import { syncLabel, useSyncView } from './Main';
import { disabledMessage, useNetworkView } from './NetworkBanner';

/** An eye, struck through while balances are hidden. */
function EyeIcon({ struck }: { struck: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {struck && <path d="M4 4l16 16" />}
    </svg>
  );
}

export function Home({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { t, lang } = useI18n();
  const { summary, meta } = useWallet();
  const sync = useSyncView();
  const network = useNetworkView();
  const balances = useHideBalances();
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
          {/* The name stays the same and aria-pressed says whether it is on. */}
          <button
            type="button"
            className="icon-button"
            aria-pressed={balances.hidden}
            aria-label={t('home.hideBalances')}
            title={t('home.hideBalances')}
            onClick={balances.toggle}
          >
            <EyeIcon struck={balances.hidden} />
          </button>
        </div>
        <div className="balance-total" data-testid="balance-total">
          {b ? <Amount zats={grandTotal(b)} /> : '—'} <small>ZEC</small>
        </div>
        {/* Payments under rules the engine lacks (Ironwood today) are invisible to it. */}
        {network.kind === 'outdated' && (
          <p className="muted small" data-testid="balance-outdated">
            {t('home.outdatedBalance', { upgrade: network.upgrade })}
          </p>
        )}
        {sync.kind === 'syncing' && (
          <div
            className={sync.pct === null ? 'progress indeterminate' : 'progress'}
            role="progressbar"
            aria-label={syncLabel(sync, t, lang)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={sync.pct ?? undefined}
          >
            <span style={sync.pct === null ? undefined : { width: `${sync.pct}%` }} />
          </div>
        )}
      </div>

      {sync.kind === 'syncing' && <p className="muted small">{t('sync.firstSyncNote')}</p>}

      <dl className="balance-rows">
        <div>
          <dt>
            <span className="dot dot-shielded" /> {t('home.shielded')}
          </dt>
          <dd data-testid="balance-shielded">{b ? <Amount zats={shieldedTotal(b)} /> : '—'} ZEC</dd>
          <p className="muted small">{t('home.shieldedHelp')}</p>
        </div>
        <div>
          <dt>
            <span className="dot dot-transparent" /> {t('home.transparent')}
          </dt>
          <dd data-testid="balance-transparent">{b ? <Amount zats={b.transparent} /> : '—'} ZEC</dd>
          <p className="muted small">{t('home.transparentHelp')}</p>
        </div>
        {b && b.pending > 0n && (
          <div>
            <dt>
              <span className="dot dot-pending" /> {t('home.pending')}
            </dt>
            <dd>
              <Amount zats={b.pending} /> ZEC
            </dd>
          </div>
        )}
      </dl>

      {b && b.transparent > 0n && !viewOnly && (
        <Notice tone="warn">
          <strong>{t('home.shieldTitle')}</strong>
          <p>{t('home.shieldText', { amount: balances.fmt(b.transparent) })}</p>
          {spendingDisabled(network) ? (
            <p className="small">{disabledMessage(network, t('shield.disabledOutdated'), t)}</p>
          ) : shieldable ? (
            <button type="button" className="primary" onClick={() => onNavigate('shield')}>
              {t('home.shieldButton')}
            </button>
          ) : (
            // A fixed network minimum, not one of the wallet's amounts.
            <p className="small">
              {t('home.shieldBelowThreshold', { amount: fmt(SHIELDING_THRESHOLD_ZATS + TYPICAL_FEE_ZATS) })}
            </p>
          )}
        </Notice>
      )}

      {/* NU6.3 (Ironwood) lets nothing new into Orchard; this engine cannot move funds out of it yet. */}
      {b && b.orchard > 0n && (
        <Notice tone="info">{t(viewOnly ? 'home.orchardMigrateNoticeViewOnly' : 'home.orchardMigrateNotice')}</Notice>
      )}
    </section>
  );
}
