import { useEffect, useRef, useState } from 'react';

import { useI18n, type Lang, type MessageKey, type Translate } from '../i18n';
import { syncView, type SyncView } from '../lib/syncView';
import { useController, useWallet } from '../state/wallet';
import { History } from './History';
import { Home } from './Home';
import { Receive } from './Receive';
import { Send } from './Send';
import { Settings } from './Settings';
import { Shield } from './Shield';

export type Tab = 'home' | 'receive' | 'send' | 'history' | 'settings' | 'shield';

const NAV: { tab: Exclude<Tab, 'shield'>; label: MessageKey; icon: string }[] = [
  { tab: 'home', label: 'nav.home', icon: '◎' },
  { tab: 'receive', label: 'nav.receive', icon: '↓' },
  { tab: 'send', label: 'nav.send', icon: '↑' },
  { tab: 'history', label: 'nav.history', icon: '☰' },
  { tab: 'settings', label: 'nav.settings', icon: '⚙' },
];

export function useSyncView(): SyncView {
  const { sync, summary, meta } = useWallet();
  return syncView(sync, summary, meta?.birthday ?? null);
}

/** The indicator's text, shared by the top-bar pill and the Home progress bar. */
export function syncLabel(view: SyncView, t: Translate, lang: Lang): string {
  const n = (x: number) => x.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US');
  switch (view.kind) {
    case 'error':
      return t('sync.error');
    case 'syncing':
      return t('sync.syncing', { blocks: n(view.blocksLeft) });
    case 'upToDate':
      return t('sync.upToDate', { height: n(view.height) });
    case 'connecting':
      return t('sync.starting');
  }
}

const SYNC_TONE: Record<SyncView['kind'], string> = {
  connecting: 'busy',
  error: 'error',
  syncing: 'busy',
  upToDate: 'ok',
};

function SyncPill() {
  const { t, lang } = useI18n();
  const { sync } = useWallet();
  const view = useSyncView();
  return (
    <span
      className={`pill pill-${SYNC_TONE[view.kind]}`}
      role="status"
      data-testid="sync-status"
      data-sync={sync.status}
      title={sync.error ?? undefined}
    >
      {syncLabel(view, t, lang)}
    </span>
  );
}

export function Main() {
  const { t } = useI18n();
  const controller = useController();
  // Leaving the screen mid-spend would hide its outcome, so navigation waits for it.
  const { spending } = useWallet();
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
  // with the keyboard is never scrolled underneath them.
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
    <div className="main">
      <header className="topbar" ref={topbar}>
        <div className="topbar-brand">
          <img src="/celari.svg" alt="" width={28} height={28} />
          <span>Celari</span>
        </div>
        <SyncPill />
        <button type="button" className="link" disabled={spending} onClick={() => controller.lock()}>
          {t('nav.lock')}
        </button>
      </header>
      <main className="content">
        {tab === 'home' && <Home onNavigate={navigate} />}
        {tab === 'receive' && <Receive />}
        {tab === 'send' && <Send onNavigate={navigate} />}
        {tab === 'history' && <History />}
        {tab === 'settings' && <Settings />}
        {tab === 'shield' && <Shield onNavigate={navigate} onClose={() => setTab(shieldFrom)} />}
      </main>
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
            <span className="tab-icon" aria-hidden="true">
              {n.icon}
            </span>
            {t(n.label)}
          </button>
        ))}
      </nav>
    </div>
  );
}
