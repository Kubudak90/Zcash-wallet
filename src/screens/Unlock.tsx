import { useState, type FormEvent } from 'react';

import { ErrorDetails, Notice, PasswordField, Spinner } from '../components/ui';
import { useI18n } from '../i18n';
import { WrongPasswordError } from '../lib/vault';
import { useController } from '../state/wallet';
import { LanguageSwitch } from './LanguageSwitch';
import { WipeWallet } from './Settings';

export function Unlock() {
  const { t } = useI18n();
  const controller = useController();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [forgot, setForgot] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await controller.unlock(password);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <section className="screen welcome">
      <div className="welcome-top">
        <LanguageSwitch />
      </div>
      <img src="/celari.svg" alt="" width={56} height={56} className="logo" />
      <h1>{t('unlock.title')}</h1>
      <form className="stack" onSubmit={submit}>
        <PasswordField label={t('common.password')} name="password" value={password} onChange={setPassword} autoFocus />
        {error instanceof WrongPasswordError && <Notice tone="error">{t('unlock.wrongPassword')}</Notice>}
        {error != null && !(error instanceof WrongPasswordError) && (
          <Notice tone="error">
            {t('common.genericError')}
            <ErrorDetails error={error} />
          </Notice>
        )}
        <button type="submit" className="primary" disabled={busy || password === ''}>
          {busy ? (
            <>
              <Spinner /> {t('unlock.unlocking')}
            </>
          ) : (
            t('unlock.button')
          )}
        </button>
      </form>
      <button type="button" className="link" onClick={() => setForgot((f) => !f)}>
        {t('unlock.forgot')}
      </button>
      {forgot && (
        <div className="stack">
          <p className="muted">{t('unlock.forgotHelp')}</p>
          <WipeWallet />
        </div>
      )}
    </section>
  );
}
