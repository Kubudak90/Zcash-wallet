import { useEffect, useState } from 'react';

import { Spinner } from './components/ui';
import { LangProvider, useI18n } from './i18n';
import { HIDDEN_LOCK_MS, dueAutoLock } from './lib/autoLock';
import { CreateWallet } from './screens/CreateWallet';
import { Main } from './screens/Main';
import { RestoreWallet } from './screens/RestoreWallet';
import { Unlock } from './screens/Unlock';
import { Welcome } from './screens/Welcome';
import { markAutoLocked } from './state/autoLockNotice';
import { useController, useWallet } from './state/wallet';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const WAKE_EVENTS = ['focus', 'pageshow'] as const;
const WAKE_CHECK_MS = 15_000;

/**
 * Locks the wallet after `minutes` without user interaction, or once the tab
 * has stayed in the background for a minute. Both go through controller.lock,
 * so a running spend still finishes first. Timers stand still while the
 * device sleeps or the tab is frozen, so the elapsed wall-clock time is also
 * checked when the page wakes up, on input and every 15 s.
 */
function useAutoLock(active: boolean, minutes: number) {
  const controller = useController();
  useEffect(() => {
    if (!active) return;
    let last = Date.now();
    let hiddenSince: number | null = document.hidden ? last : null;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    let locked = false;
    const check = () => {
      if (locked) return;
      const reason = dueAutoLock({ now: Date.now(), lastActivity: last, minutes, hiddenSince });
      if (!reason) return;
      locked = true;
      markAutoLocked(reason);
      controller.lock();
    };
    const reset = () => {
      last = Date.now();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(check, minutes * 60_000);
    };
    // The first tap after a long sleep must lock, not restart the countdown.
    const onActivity = () => {
      check();
      if (!locked) reset();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince ??= Date.now();
        clearTimeout(hiddenTimer);
        hiddenTimer = setTimeout(check, HIDDEN_LOCK_MS);
      } else {
        // Back after a sleep, the timers may not have run: the clock decides.
        check();
        hiddenSince = null;
        clearTimeout(hiddenTimer);
      }
    };
    reset();
    if (hiddenSince !== null) hiddenTimer = setTimeout(check, HIDDEN_LOCK_MS);
    const interval = setInterval(check, WAKE_CHECK_MS);
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    WAKE_EVENTS.forEach((e) => window.addEventListener(e, check));
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(idleTimer);
      clearTimeout(hiddenTimer);
      clearInterval(interval);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      WAKE_EVENTS.forEach((e) => window.removeEventListener(e, check));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, minutes, controller]);
}

function Booting() {
  const { t } = useI18n();
  return (
    <section className="screen center">
      <img src="/celari.svg" alt="" width={64} height={64} className="logo pulse" />
      <p className="muted">
        <Spinner /> {t('boot.loading')}
      </p>
    </section>
  );
}

function BootError({ error }: { error: string | null }) {
  const { t } = useI18n();
  return (
    <section className="screen center">
      <h1>{t('boot.errorTitle')}</h1>
      <p>{error === 'isolation' ? t('boot.errorIsolation') : t('common.genericError')}</p>
      {error && error !== 'isolation' && <code className="error-code">{error}</code>}
      <button type="button" className="primary" onClick={() => window.location.reload()}>
        {t('boot.retry')}
      </button>
    </section>
  );
}

function Onboarding() {
  const [flow, setFlow] = useState<'welcome' | 'create' | 'restore'>('welcome');
  if (flow === 'create') return <CreateWallet onCancel={() => setFlow('welcome')} />;
  if (flow === 'restore') return <RestoreWallet onCancel={() => setFlow('welcome')} />;
  return <Welcome onCreate={() => setFlow('create')} onRestore={() => setFlow('restore')} />;
}

export function App() {
  const { phase, bootError, settings } = useWallet();
  useAutoLock(phase === 'ready', settings.autoLockMinutes);

  useEffect(() => {
    document.documentElement.lang = settings.lang;
  }, [settings.lang]);

  return (
    <LangProvider lang={settings.lang}>
      <div className="app">
        {phase === 'booting' && <Booting />}
        {phase === 'bootError' && <BootError error={bootError} />}
        {phase === 'welcome' && <Onboarding />}
        {phase === 'locked' && <Unlock />}
        {phase === 'ready' && <Main />}
      </div>
    </LangProvider>
  );
}
