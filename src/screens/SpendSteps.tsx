import { useState, type FormEvent } from 'react';

import { ErrorDetails, Notice, PasswordField, Spinner } from '../components/ui';
import type { SendStage } from '../engine';
import { useI18n } from '../i18n';
import { WrongPasswordError } from '../lib/vault';

const STAGES: SendStage[] = ['building', 'signing', 'proving', 'broadcasting'];

/** Password confirmation plus live progress for a spend (send or shield). */
export function SpendConfirm({
  submitLabel,
  run,
  failureHint,
}: {
  submitLabel: string;
  run: (password: string, onStage: (s: SendStage) => void) => Promise<void>;
  failureHint?: string;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<SendStage | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await run(password, setStage);
    } catch (err) {
      setError(err);
      setStage(null);
    }
  }

  if (stage) {
    const current = STAGES.indexOf(stage);
    return (
      <div className="stack" aria-live="polite">
        <ol className="stages">
          {STAGES.map((s, i) => (
            <li key={s} className={i < current ? 'done' : i === current ? 'current' : ''}>
              {i === current && <Spinner />} {t(`send.stage.${s}`)}
            </li>
          ))}
        </ol>
        <p className="muted small">{t('send.doNotClose')}</p>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      <PasswordField label={t('send.confirmPassword')} name="password" value={password} onChange={setPassword} autoFocus />
      {error instanceof WrongPasswordError && <Notice tone="error">{t('unlock.wrongPassword')}</Notice>}
      {error != null && !(error instanceof WrongPasswordError) && (
        <Notice tone="error">
          <strong>{t('send.failed')}</strong>
          {failureHint && <p>{failureHint}</p>}
          <ErrorDetails error={error} />
        </Notice>
      )}
      <button type="submit" className="primary" disabled={password === ''}>
        {submitLabel}
      </button>
    </form>
  );
}
