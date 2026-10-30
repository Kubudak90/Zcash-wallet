import { useEffect, useRef, useState } from 'react';

import { Icon, type IconName } from '../components/icons';
import { Notice } from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';
import { syncLabel, syncView, type SyncView } from '../lib/syncView';
import { useController, useWallet } from '../state/wallet';
import { History } from './History';
import { Home } from './Home';
import { NetworkBanner, useNetworkView } from './NetworkBanner';
import { Receive } from './Receive';
import { Send } from './Send';
import { Settings } from './Settings';
import { Shield } from './Shield';

export type Tab = 'home' | 'receive' | 'send' | 'history' | 'settings' | 'shield';

// Settings stays last (the tab bar's last button, tests/e2e/a11y.spec.ts).
const NAV: { tab: Exclude<Tab, 'shield'>; label: MessageKey; icon: IconName }[] = [
  { tab: 'home', label: 'nav.home', icon: 'balance' },
  { tab: 'send', label: 'nav.send', icon: 'send' },
  { tab: 'receive', label: 'nav.receive', icon: 'receive' },
  { tab: 'history', label: 'nav.history', icon: 'history' },
  { tab: 'settings', label: 'nav.settings', icon: 'settings' },
];

export function useSyncView(): SyncView {
  const { sync, summary, meta } = useWallet();
  return syncView(sync, summary, meta?.birthday ?? null);
}

const SYNC_TONE: Record<SyncView['kind'], string> = {
  connecting: 'busy',
  error: 'error',
  stopped: 'error',
  syncing: 'busy',
  upToDate: 'ok',
};

/**
 * The one sync status of the app: a pill in the phone's top bar, a status card
 * at the foot of the desktop sidebar. Its text is the whole label; the parts
 * around the first " · " get their own spans so the card can set them on two
 * lines and the pill can cut the line short (the full label stays in the text
 * and in the tooltip).
 */
function SyncPill() {
  const { t, lang } = useI18n();
  const { sync } = useWallet();
  const view = useSyncView();
  const network = useNetworkView();
  // Scanned to the tip, but under rules that miss what the network now carries.
  const behind = view.kind === 'upToDate' && network.kind === 'outdated';
  const label =
    view.kind === 'upToDate' && behind
      ? t('sync.behindNetwork', { height: view.height.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US') })
      : syncLabel(view, t, lang);
  const [head, ...rest] = label.split(' · ');
  return (
    <span
      className={`pill pill-${behind ? 'warn' : SYNC_TONE[view.kind]}`}
      role="status"
      data-testid="sync-status"
      data-sync={sync.status}
      title={sync.error ?? label}
    >
      <span className="pill-dot" aria-hidden="true" />
      <span className="pill-text">
        <span className="pill-head">{head}</span>
        {rest.length > 0 && (
          <>
            <span className="pill-sep"> · </span>
            <span className="pill-sub">{rest.join(' · ')}</span>
          </>
        )}
      </span>
    </span>
  );
}

export function Main() {
  const { t } = useI18n();
  const controller = useController();
  // Leaving the screen mid-spend would hide its outcome, so navigation waits for it.
  const { spending, upgradeRescan, sync, settings } = useWallet();
  const network = useNetworkView();
  const [tab, setTab] = useState<Tab>('home');
  // Shield opens from Balance or from Send: that tab stays marked, and Back and Close return to it.
  const [shieldFrom, setShieldFrom] = useState<'home' | 'send'>('home');
  const topbar = useRef<HTMLElement>(null);
  const tabbar = useRef<HTMLElement>(null);
  const navTab = tab === 'shield' ? shieldFrom : tab;

  const navigate = (next: Tab) => {
    if (next === 'shield') setShieldFrom(tab === 'send' ? 'send' : 'home');
    setTab(next);
  };

  // Tab switches keep focus on the tab button, so the title is what tells
  // assistive tech that the screen changed.
  const titleKey: MessageKey = NAV.find((n) => n.tab === tab)?.label ?? 'shield.title';
  useEffect(() => {
    document.title = `${t(titleKey)} · Celari`;
    return () => {
      document.title = 'Celari';
    };
  }, [t, titleKey]);

  // The bars' heights feed scroll-padding (styles.css), so a control focused
  // with the keyboard is never scrolled underneath them. On a wide screen the
  // same elements make up the sidebar and styles.css sets the padding itself.
  useEffect(() => {
    const root = document.documentElement.style;
    const observer = new ResizeObserver(() => {
      root.setProperty('--topbar-h', `${topbar.current?.offsetHeight ?? 0}px`);
      root.setProperty('--tabbar-h', `${tabbar.current?.offsetHeight ?? 0}px`);
    });
    if (topbar.current) observer.observe(topbar.current);
    if (tabbar.current) observer.observe(tabbar.current);
    return () => {
      observer.disconnect();
      root.removeProperty('--topbar-h');
      root.removeProperty('--tabbar-h');
    };
  }, []);

  return (
    // One tree at every width, restyled by CSS: on a phone .side lets its two
    // bars sit at the top and bottom of the screen, on a wide screen it is the
    // sidebar. Nothing here is swapped by width, so a resize or a rotation never
    // remounts a screen (a running spend, Receive's fresh address, a draft).
    // data-network: what the engine says about the network, for the smoke test (tests/e2e-real).
    <div className="main" data-network={network.kind}>
      <div className="side">
        <header className="topbar" ref={topbar}>
          <div className="topbar-brand">
            <img src="/celari.svg" alt="" width={30} height={30} />
            <span>Celari</span>
          </div>
          <SyncPill />
          <button type="button" className="lock-button" disabled={spending} onClick={() => controller.lock()}>
            <Icon name="lock" />
            {t('nav.lock')}
          </button>
        </header>
        <nav className="tabbar" aria-label="Celari" ref={tabbar}>
          {NAV.map((n) => (
            <button
              key={n.tab}
              type="button"
              className={navTab === n.tab ? 'active' : ''}
              aria-current={navTab === n.tab ? 'page' : undefined}
              onClick={() => setTab(n.tab)}
              disabled={spending}
            >
              <Icon name={n.icon} className="tab-icon" />
              <span className="tab-label">{t(n.label)}</span>
            </button>
          ))}
        </nav>
      </div>
      <main className="content">
        <NetworkBanner />
        {/* On every screen: the balance starts at 0 and History is empty until the rescan gets there. */}
        {sync.status === 'stopped' && (
          <Notice tone="error">
            <p data-testid="engine-stopped">{t('engine.stopped')}</p>
            <button type="button" className="primary" onClick={() => controller.restartEngine()}>
              {t('engine.reload')}
            </button>
          </Notice>
        )}
        {sync.status !== 'stopped' && sync.stalled && (
          <Notice tone="warn">
            <p data-testid="sync-stalled">{t('sync.stalled')}</p>
            <button type="button" className="secondary" onClick={() => controller.restartEngine()}>
              {t('engine.reload')}
            </button>
          </Notice>
        )}
        {upgradeRescan && (
          <Notice tone="info">
            <p data-testid="upgrade-rescan">{t('upgrade.rescanning', { minutes: settings.autoLockMinutes })}</p>
          </Notice>
        )}
        {tab === 'home' && <Home onNavigate={navigate} />}
        {tab === 'receive' && <Receive />}
        {tab === 'send' && <Send onNavigate={navigate} />}
        {tab === 'history' && <History />}
        {tab === 'settings' && <Settings />}
        {tab === 'shield' && <Shield onNavigate={navigate} onClose={() => setTab(shieldFrom)} />}
      </main>
    </div>
  );
}
