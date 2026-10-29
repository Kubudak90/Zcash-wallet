import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { ErrorDetails, Notice, PasswordField, Spinner } from '../components/ui';
import { NewerDatabaseFormatError } from '../engine';
import { useI18n, type MessageKey } from '../i18n';
import { WrongPasswordError } from '../lib/vault';
import { clearAutoLocked, useAutoLockReason } from '../state/autoLockNotice';
import { WalletDataError } from '../state/controller';
import { useController, useWallet } from '../state/wallet';
import { LanguageSwitch } from './LanguageSwitch';
import { NetworkBanner } from './NetworkBanner';
import { WipeWallet } from './Settings';

export function Unlock() {
  const { t } = useI18n();
  const controller = useController();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [forgot, setForgot] = useState(false);
  const { meta, softLocked, upgradeRescan } = useWallet();
  const autoLocked = useAutoLockReason();
  const field = useRef<HTMLInputElement>(null);
  const errorId = useId();

  // After a failed attempt, back to the field, selected so it can simply be
  // retyped. Done after render so the field already carries its error.
  useEffect(() => {
    if (error == null) return;
    field.current?.focus();
    field.current?.select();
  }, [error]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await controller.unlock(password);
      clearAutoLocked();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const wrongPassword = error instanceof WrongPasswordError;
  // Unlocking changed nothing stored in these cases; say so rather than only that it failed.
  const openFailure: MessageKey | null =
    error instanceof NewerDatabaseFormatError
      ? 'unlock.dbNewer'
      : error instanceof WalletDataError
        ? meta?.kind === 'view'
          ? 'unlock.dbUnreadableView'
          : 'unlock.dbUnreadable'
        : null;

  return (
    <section className="screen welcome">
      <div className="welcome-top">
        <LanguageSwitch />
      </div>
      <img src="/celari.svg" alt="" width={56} height={56} className="logo" />
      <h1>{t('unlock.title')}</h1>
      <NetworkBanner />
      {autoLocked !== null && (
        <Notice tone="info">
          {autoLocked.kind === 'hidden' ? t('unlock.autoLockedHidden') : t('unlock.autoLocked', { n: autoLocked.minutes })}
        </Notice>
      )}
      {upgradeRescan && (
        <Notice tone="info">
          <p data-testid="upgrade-rescan-locked">{t('unlock.upgradeRescan')}</p>
        </Notice>
      )}
      {softLocked && <p className="muted small">{t('unlock.softLocked')}</p>}
      <form className="stack" onSubmit={submit}>
        <PasswordField
          ref={field}
          label={t('common.password')}
          name="password"
          value={password}
          onChange={setPassword}
          autoFocus
          invalid={wrongPassword}
          describedBy={wrongPassword ? errorId : undefined}
        />
        {wrongPassword && (
          <Notice tone="error">
            <p id={errorId}>{t('unlock.wrongPassword')}</p>
          </Notice>
        )}
        {error != null && !wrongPassword && (
          <Notice tone="error">
            {openFailure ? <p>{t(openFailure)}</p> : t('common.genericError')}
            <ErrorDetails error={error} />
          </Notice>
        )}
        {/* aria-disabled while busy: a disabled button would drop focus to <body>. */}
        <button type="submit" className="primary" disabled={password === ''} aria-disabled={busy || undefined}>
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
          <p className="muted">{t(meta?.kind === 'view' ? 'unlock.forgotHelpView' : 'unlock.forgotHelp')}</p>
          <WipeWallet />
        </div>
      )}
    </section>
  );
}
