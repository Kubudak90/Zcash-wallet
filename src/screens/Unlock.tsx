import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { BrandLockup } from '../components/Brand';
import { Icon } from '../components/icons';
import { ErrorDetails, Notice, PasswordField, Spinner } from '../components/ui';
import { NewerDatabaseFormatError } from '../engine';
import { useI18n, type MessageKey } from '../i18n';
import { UnsupportedVaultError, WrongPasswordError } from '../lib/vault';
import { clearAutoLocked, useAutoLockReason } from '../state/autoLockNotice';
import { OtherTabError, WalletDataError } from '../state/controller';
import { useController, useWallet } from '../state/wallet';
import { EngravedC } from './AccountLayout';
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
  const titleId = useId();

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
    error instanceof OtherTabError
      ? 'common.otherTab'
      : error instanceof NewerDatabaseFormatError || error instanceof UnsupportedVaultError
      ? 'unlock.dbNewer'
      : error instanceof WalletDataError
        ? meta?.kind === 'view'
          ? 'unlock.dbUnreadableView'
          : 'unlock.dbUnreadable'
        : null;

  // "Press Enter ↵ to unlock", with the key set as a key cap.
  const [hintBefore, hintAfter = ''] = t('unlock.enterHint', { key: '\u0000' }).split('\u0000');

  // Nothing of the wallet shows here (no balance, sync status or navigation): only the
  // brand, the language and what is needed to unlock or to start over.
  return (
    <div className="lock-page">
      <EngravedC className="lock-motif" />
      <header className="lock-top">
        <BrandLockup />
        <LanguageSwitch withIcon />
      </header>
      <div className="lock-center">
        <section className="lock-card" aria-labelledby={titleId}>
          <span className="lock-mark" aria-hidden="true">
            <Icon name="lock" />
          </span>
          <h1 id={titleId}>{t('unlock.title')}</h1>
          {(autoLocked !== null || softLocked) && (
            <div className="lock-reasons">
              {autoLocked !== null && (
                <p className="lock-reason" role="status">
                  <Icon name="clock" />
                  <span>
                    {autoLocked.kind === 'hidden'
                      ? t('unlock.autoLockedHidden')
                      : t('unlock.autoLocked', { n: autoLocked.minutes })}
                  </span>
                </p>
              )}
              {softLocked && (
                <p className="lock-reason">
                  <Icon name="sync" />
                  <span>{t('unlock.softLocked')}</span>
                </p>
              )}
            </div>
          )}
          <NetworkBanner />
          {upgradeRescan && (
            <Notice tone="info">
              <p data-testid="upgrade-rescan-locked">{t('unlock.upgradeRescan')}</p>
            </Notice>
          )}
          <form className="stack lock-form" onSubmit={submit}>
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
            {/* For the eye only: the form says it already, and screen readers know Enter. */}
            <p className="lock-hint" aria-hidden="true">
              {hintBefore}
              <kbd>Enter ↵</kbd>
              {hintAfter}
            </p>
          </form>
          <button
            type="button"
            className="link lock-forgot"
            aria-expanded={forgot}
            onClick={() => setForgot((f) => !f)}
          >
            {t('unlock.forgot')}
          </button>
          {forgot && (
            <div className="stack danger-panel">
              <p>{t(meta?.kind === 'view' ? 'unlock.forgotHelpView' : 'unlock.forgotHelp')}</p>
              <WipeWallet />
            </div>
          )}
        </section>
      </div>
      <footer className="lock-foot">
        <p>
          <Icon name="key" />
          <span>{t('welcome.pillar1')}</span>
        </p>
      </footer>
    </div>
  );
}
