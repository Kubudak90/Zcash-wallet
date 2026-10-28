import { useState, type FormEvent, type ReactNode } from 'react';

import { ErrorDetails, Notice, PasswordField, Screen, Spinner, StrengthMeter } from '../components/ui';
import { useI18n } from '../i18n';
import { MIN_PASSWORD_LENGTH } from '../lib/vault';

export function PasswordSetup({
  onSubmit,
  onBack,
  note,
  viewOnly = false,
}: {
  onSubmit: (password: string) => Promise<void>;
  onBack: () => void;
  note?: ReactNode;
  /** A view-only wallet is restored from its viewing key, not a recovery phrase. */
  viewOnly?: boolean;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const tooShort = password.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat !== '' && repeat !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (tooShort || password !== repeat) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Screen title={t('password.title')} onBack={busy ? undefined : onBack}>
      <p className="muted">{t(viewOnly ? 'password.introView' : 'password.intro')}</p>
      {note}
      <form onSubmit={submit} className="stack">
        <PasswordField
          label={t('common.password')}
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          autoFocus
        />
        <StrengthMeter password={password} />
        {password && tooShort && <p className="field-error">{t('password.tooShort', { n: MIN_PASSWORD_LENGTH })}</p>}
        <PasswordField
          label={t('password.repeat')}
          name="repeat-password"
          autoComplete="new-password"
          value={repeat}
          onChange={setRepeat}
        />
        {mismatch && <p className="field-error">{t('password.mismatch')}</p>}
        {error != null && (
          <Notice tone="error">
            {t('common.genericError')}
            <ErrorDetails error={error} />
          </Notice>
        )}
        <button type="submit" className="primary" disabled={busy || tooShort || password !== repeat}>
          {busy ? (
            <>
              <Spinner /> {t('password.creating')}
            </>
          ) : (
            t('password.finish')
          )}
        </button>
      </form>
    </Screen>
  );
}
