import { useId, useState, type FormEvent, type ReactNode } from 'react';

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
  const tooShortId = useId();
  const mismatchId = useId();

  const tooShort = password.length < MIN_PASSWORD_LENGTH;
  const showTooShort = password !== '' && tooShort;
  // Only flag the repeat once it goes wrong, not on every keystroke while it is
  // still being typed; the error is announced as it appears.
  const mismatch = repeat !== '' && !password.startsWith(repeat);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || tooShort || password !== repeat) return;
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
          invalid={showTooShort}
          describedBy={showTooShort ? tooShortId : undefined}
        />
        <StrengthMeter password={password} />
        {/* The error slots stay mounted (empty when valid) so the polite live region exists before its text. */}
        <p id={tooShortId} className="field-error" aria-live="polite">
          {showTooShort && t('password.tooShort', { n: MIN_PASSWORD_LENGTH })}
        </p>
        <PasswordField
          label={t('password.repeat')}
          name="repeat-password"
          autoComplete="new-password"
          value={repeat}
          onChange={setRepeat}
          invalid={mismatch}
          describedBy={mismatch ? mismatchId : undefined}
        />
        <p id={mismatchId} className="field-error" aria-live="polite">
          {mismatch && t('password.mismatch')}
        </p>
        {error != null && (
          <Notice tone="error">
            {t('common.genericError')}
            <ErrorDetails error={error} />
          </Notice>
        )}
        {/* aria-disabled while busy: a disabled button would drop focus to <body>. */}
        <button
          type="submit"
          className="primary"
          disabled={tooShort || password !== repeat}
          aria-disabled={busy || undefined}
        >
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
