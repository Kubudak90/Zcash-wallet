import { useId } from 'react';

import { Icon } from '../components/icons';
import { TxRow, useFractionWidth } from '../components/TxRow';
import { AmountParts, Notice, useHideBalances } from '../components/ui';
import { SHIELDING_THRESHOLD_ZATS, TYPICAL_FEE_ZATS, grandTotal, shieldedTotal, type Balances } from '../engine';
import { useI18n } from '../i18n';
import { spendingDisabled } from '../lib/network';
import { syncLabel } from '../lib/syncView';
import { formatZec } from '../lib/zec';
import { useWallet } from '../state/wallet';
import type { Tab } from './Main';
import { useSyncView } from './Main';
import { disabledMessage, useNetworkView } from './NetworkBanner';

/** How many transactions Recent activity shows; History has them all. */
const RECENT = 5;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The shielded and transparent shares as one rule. Hidden balances show a
 * plain rule: the split would give the ratio away. An empty wallet has no
 * ratio (no NaN, no zero-width segment): Home draws no rule for it, nor
 * before the wallet's first summary, unless balances are hidden.
 */
function SplitRule({ b, hidden }: { b: Balances; hidden: boolean }) {
  const shielded = shieldedTotal(b);
  const transparent = b.transparent;
  const total = shielded + transparent;
  if (hidden || total <= 0n) {
    return (
      <div className="split" aria-hidden="true">
        <span className="split-none" />
      </div>
    );
  }
  // Integer shares out of 10 000: no float ever holds a balance.
  const s = Number((shielded * 10_000n) / total);
  return (
    <div className="split" aria-hidden="true">
      {shielded > 0n && <span className="split-shielded" style={{ flexGrow: s }} />}
      {transparent > 0n && <span className="split-transparent" style={{ flexGrow: 10_000 - s }} />}
    </div>
  );
}

/** A pool's amount and unit, or a quiet dash before the wallet's first summary. */
function PoolAmount({ zats }: { zats: bigint | undefined }) {
  if (zats === undefined) return <span className="amt amt-none">—</span>;
  return (
    <>
      <span className="amt">
        <AmountParts zats={zats} />
      </span>{' '}
      <span className="unit">ZEC</span>
    </>
  );
}

export function Home({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { t, lang } = useI18n();
  const { summary, meta, ironwood, history, settings, spending } = useWallet();
  const sync = useSyncView();
  const network = useNetworkView();
  const balances = useHideBalances();
  const fmt = (z: bigint) => formatZec(z, { locale: lang });
  const totalId = useId();
  const privacyId = useId();
  const recentId = useId();
  const recent = history.slice(0, RECENT);
  const fraction = useFractionWidth(recent);

  const b = summary?.balances;
  const viewOnly = meta?.kind === 'view';
  const shieldable = b ? b.transparent >= SHIELDING_THRESHOLD_ZATS + TYPICAL_FEE_ZATS : false;
  const transparentPrompt = !!b && b.transparent > 0n && !viewOnly;
  // The one way into Shield from here; where it cannot go, the prompt says why instead.
  const canShield = transparentPrompt && !spendingDisabled(network) && shieldable;
  // Gold marks the one action the screen leads to. Where no payment can go out now (the
  // network check says no, or the engine stopped and its notice offers the reload) Send is a
  // plain button; a view-only wallet has no Send, so Receive leads.
  const sendLeads = !viewOnly && !spendingDisabled(network) && sync.kind !== 'stopped';
  const receiveLeads = viewOnly && sync.kind !== 'stopped';
  // The split rule needs shares to draw. Hidden, it is drawn plain whatever the wallet holds
  // (an empty wallet must look like any other); shown, an empty wallet has none, and a hairline
  // parts the pools from the figure instead, as before the first summary.
  const split = !!b && (balances.hidden || shieldedTotal(b) + b.transparent > 0n);
  // "49,799 blocks left": the part of the sync label after its first " · ".
  const blocksLeft = sync.kind === 'syncing' ? syncLabel(sync, t, lang).split(' · ').slice(1).join(' · ') : '';

  return (
    <section className="screen home">
      <h1 className="visually-hidden">{t('nav.home')}</h1>
      <div className="dashboard">
        <section className="card hero" aria-labelledby={totalId}>
          <div className="hero-top">
            <span className="eyebrow" id={totalId}>
              {t('home.total')}
            </span>
            {viewOnly && <span className="badge">{t('home.viewOnly')}</span>}
            {/* The name stays the same and aria-pressed says whether it is on. */}
            <button
              type="button"
              className="eye-toggle"
              aria-pressed={balances.hidden}
              title={t('home.hideBalances')}
              onClick={balances.toggle}
            >
              <Icon name={balances.hidden ? 'eyeOff' : 'eye'} />
              <span className="eye-label">{t('home.hideBalances')}</span>
            </button>
          </div>
          <div className={b ? 'balance-total' : 'balance-total balance-waiting'} data-testid="balance-total">
            {b ? (
              <>
                <span className="amt">
                  <AmountParts zats={grandTotal(b)} />
                </span>{' '}
                <span className="unit">ZEC</span>
              </>
            ) : (
              // No figure yet: a calm sentence, not a dash at display size.
              <span className="balance-wait">{t('home.balanceWaiting')}</span>
            )}
          </div>
          {/* Shielded payments since NU6.3 land in Ironwood, which an engine without it does not see. */}
          {!ironwood && (
            <p className="muted small" data-testid="balance-outdated">
              {t('home.outdatedBalance')}
            </p>
          )}
          {sync.kind === 'syncing' && (
            <div className="hero-sync">
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
              <div className="hero-sync-text">
                {/* The bar's name says it already; these words are for the eye, on a phone whose pill has no room for them. */}
                {blocksLeft && (
                  <p className="hero-sync-left" aria-hidden="true">
                    {blocksLeft}
                  </p>
                )}
                <p className="muted small">{t('sync.firstSyncNote')}</p>
              </div>
            </div>
          )}

          <div className={split ? 'composition' : 'composition composition-plain'}>
            {split && b && <SplitRule b={b} hidden={balances.hidden} />}
            <dl className="balance-rows">
              <div className="pool pool-shielded">
                <dt>
                  <span className="pool-mark" aria-hidden="true" />
                  {t('home.shielded')}
                </dt>
                <dd className="pool-amount" data-testid="balance-shielded">
                  <PoolAmount zats={b ? shieldedTotal(b) : undefined} />
                </dd>
                <dd className="pool-help">{t('home.shieldedHelp')}</dd>
              </div>
              <div className="pool pool-transparent">
                <dt>
                  <span className="pool-mark" aria-hidden="true" />
                  {t('home.transparent')}
                </dt>
                <dd className="pool-amount" data-testid="balance-transparent">
                  <PoolAmount zats={b?.transparent} />
                </dd>
                <dd className="pool-help">{t('home.transparentHelp')}</dd>
              </div>
              {b && b.pending > 0n && (
                <div className="pool pool-pending">
                  <dt>
                    <span className="pool-mark" aria-hidden="true" />
                    {t('home.pending')}
                  </dt>
                  <dd className="pool-amount">
                    <PoolAmount zats={b.pending} />
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="hero-actions">
            {!viewOnly && (
              <button
                type="button"
                className={sendLeads ? 'primary' : 'secondary'}
                disabled={spending}
                onClick={() => onNavigate('send')}
              >
                <Icon name="send" />
                {t('nav.send')}
              </button>
            )}
            <button
              type="button"
              className={receiveLeads ? 'primary' : 'secondary'}
              disabled={spending}
              onClick={() => onNavigate('receive')}
            >
              <Icon name="receive" />
              {t('nav.receive')}
            </button>
            {canShield && (
              <button type="button" className="secondary" disabled={spending} onClick={() => onNavigate('shield')}>
                <Icon name="shieldIn" />
                {t('home.shieldButton')}
              </button>
            )}
          </div>
        </section>

        {/* Its own row under the hero, so the hero keeps to the figure and the actions. */}
        {transparentPrompt && (
          <div className="dashboard-note shield-note">
            <Notice tone="warn">
              <strong>{t('home.shieldTitle')}</strong>
              <p>{t('home.shieldText', { amount: balances.fmt(b.transparent) })}</p>
              {spendingDisabled(network) ? (
                <p className="small">{disabledMessage(network, t('shield.disabledOutdated'), t)}</p>
              ) : (
                !shieldable && (
                  // A fixed network minimum, not one of the wallet's amounts.
                  <p className="small">
                    {t('home.shieldBelowThreshold', { amount: fmt(SHIELDING_THRESHOLD_ZATS + TYPICAL_FEE_ZATS) })}
                  </p>
                )
              )}
            </Notice>
          </div>
        )}

        {/*
          NU6.3 (Ironwood) lets nothing new into Orchard. An engine with Ironwood spends Orchard
          notes and puts the change in Ironwood, visibly crossing pools (ZIP 318); one without it
          cannot move them at all.
        */}
        {b && b.orchard > 0n && (
          <div className="dashboard-note">
            <Notice tone="info">
              <p data-testid="orchard-note">
                {ironwood
                  ? t(viewOnly ? 'home.orchardNoteViewOnly' : 'home.orchardNote', { amount: balances.fmt(b.orchard) })
                  : t(viewOnly ? 'home.orchardMigrateNoticeViewOnly' : 'home.orchardMigrateNotice')}
              </p>
            </Notice>
          </div>
        )}

        <section className="card activity" aria-labelledby={recentId}>
          <div className="card-head">
            <h2 id={recentId}>{t('home.recent')}</h2>
            {history.length > 0 && (
              <button type="button" className="quiet-link" disabled={spending} onClick={() => onNavigate('history')}>
                {t('home.allTransactions')}
                <Icon name="arrowRight" />
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="card-empty muted">{t('history.empty')}</p>
          ) : (
            <ul className="tx-list" data-testid="recent-activity" style={fraction}>
              {recent.map((tx) => (
                <TxRow key={tx.txid} tx={tx} />
              ))}
            </ul>
          )}
        </section>

        {/* Sync lives in the shell; this card says what the server learns and how the wallet guards itself. */}
        <aside className="card privacy-card" aria-labelledby={privacyId}>
          <h2 className="eyebrow" id={privacyId}>
            {t('home.privacyTitle')}
          </h2>
          <dl className="kv">
            <div className="kv-stack">
              <dt>{t('home.server')}</dt>
              <dd className="mono">{hostOf(settings.serverUrl)}</dd>
            </div>
            <div>
              <dt>{t('settings.historyEnhancement')}</dt>
              <dd>{t(settings.historyEnhancement ? 'common.on' : 'common.off')}</dd>
            </div>
            <div>
              <dt>{t('settings.autoLock')}</dt>
              <dd>{t('home.autoLockValue', { n: settings.autoLockMinutes })}</dd>
            </div>
            <div>
              <dt>{t('home.freshAddress')}</dt>
              <dd>{t('home.freshAddressValue')}</dd>
            </div>
          </dl>
          <p className="privacy-note">
            <Icon name="info" />
            <span>{t(settings.historyEnhancement ? 'home.serverSeesHistory' : 'home.serverSees')}</span>
          </p>
          <button type="button" className="quiet-link privacy-more" disabled={spending} onClick={() => onNavigate('settings')}>
            {t('home.openSettings')}
            <Icon name="arrowRight" />
          </button>
        </aside>
      </div>
    </section>
  );
}
