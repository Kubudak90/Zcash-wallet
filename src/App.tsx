import { useEffect, useState } from 'react';

import { Spinner } from './components/ui';
import { LangProvider, useI18n } from './i18n';
import { CreateWallet } from './screens/CreateWallet';
import { Main } from './screens/Main';
import { RestoreWallet } from './screens/RestoreWallet';
import { Unlock } from './screens/Unlock';
import { Welcome } from './screens/Welcome';
import { useController, useWallet } from './state/wallet';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** Locks the wallet after `minutes` without user interaction. */
function useAutoLock(active: boolean, minutes: number) {
  const controller = useController();
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.lock(), minutes * 60_000);
    };
    reset();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, reset));
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
