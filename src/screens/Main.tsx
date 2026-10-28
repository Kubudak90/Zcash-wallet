import { useState } from 'react';

import { useI18n, type MessageKey } from '../i18n';
import { syncProgress } from '../lib/birthday';
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

export function useSyncPercent(): number | null {
  const { summary, meta } = useWallet();
  if (!summary || !meta) return null;
  return Math.floor(syncProgress(meta.birthday, summary.scannedHeight, summary.tipHeight) * 100);
}

function SyncPill() {
  const { t } = useI18n();
  const { sync, summary } = useWallet();
  const pct = useSyncPercent();

  let label: string;
  let tone: string;
  if (sync.status === 'error') {
    label = t('sync.error');
    tone = 'error';
  } else if (pct !== null && pct < 100) {
    label = t('sync.syncing', { pct });
    tone = 'busy';
  } else if (summary && sync.status !== 'starting') {
    label = t('sync.upToDate', { height: summary.tipHeight.toLocaleString() });
    tone = 'ok';
  } else {
    label = t('sync.starting');
    tone = 'busy';
  }
  return (
    <span
      className={`pill pill-${tone}`}
      role="status"
      data-testid="sync-status"
      data-sync={sync.status}
      title={sync.error ?? undefined}
    >
      {label}
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
