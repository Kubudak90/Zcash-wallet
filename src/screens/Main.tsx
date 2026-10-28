import { useState } from 'react';

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
  const [tab, setTab] = useState<Tab>('home');

  return (
    <div className="main">
      <header className="topbar">
        <div className="topbar-brand">
          <img src="/celari.svg" alt="" width={28} height={28} />
          <span>Celari</span>
        </div>
        <SyncPill />
        <button type="button" className="link" onClick={() => controller.lock()}>
          {t('nav.lock')}
        </button>
      </header>
      <main className="content">
        {tab === 'home' && <Home onNavigate={setTab} />}
        {tab === 'receive' && <Receive />}
        {tab === 'send' && <Send />}
        {tab === 'history' && <History />}
        {tab === 'settings' && <Settings />}
        {tab === 'shield' && <Shield onDone={() => setTab('home')} />}
      </main>
      <nav className="tabbar" aria-label="Celari">
        {NAV.map((n) => (
          <button
            key={n.tab}
            type="button"
            className={tab === n.tab ? 'active' : ''}
            aria-current={tab === n.tab ? 'page' : undefined}
            onClick={() => setTab(n.tab)}
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
