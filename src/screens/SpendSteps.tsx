import { useRef, useState, type FormEvent, type ReactNode } from 'react';

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
  onViewHistory,
}: {
  submitLabel: string;
  run: (password: string, onStage: (s: SendStage) => void) => Promise<void>;
  /** Shown when building the transaction failed, before anything was signed. */
  failureHint?: string;
  onViewHistory: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<SendStage | null>(null);
  const [error, setError] = useState<{ cause: unknown; stage: SendStage | null } | null>(null);
  // Refs, not state: a second click in the same tick must already see them.
  const running = useRef(false);
  const lastStage = useRef<SendStage | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (running.current) return;
    running.current = true;
    lastStage.current = null;
    setBusy(true);
    setError(null);
    try {
      await run(password, (s) => {
        lastStage.current = s;
        setStage(s);
      });
    } catch (err) {
      setError({ cause: err, stage: lastStage.current });
      setStage(null);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  // Once broadcasting started the network may already have the transaction,
  // so a retry could pay twice.
  const maybeSent = error?.stage === 'broadcasting';
  let hint: string | undefined;
  if (error?.stage === 'building') hint = failureHint ?? t('send.failedRetry');
  else if (error?.stage) hint = t('send.failedRetry');

  let body: ReactNode;
  if (stage) {
    const current = STAGES.indexOf(stage);
    body = (
      <div className="stack">
        <ol className="stages">
          {STAGES.map((s, i) => (
            <li
              key={s}
              className={i < current ? 'done' : i === current ? 'current' : ''}
              aria-current={i === current ? 'step' : undefined}
            >
              <span className="stage-icon" aria-hidden="true">
                {i < current ? '✓' : i === current ? <Spinner /> : null}
              </span>
              <span>
                {t(`send.stage.${s}`)}
                {i < current && <span className="visually-hidden"> ({t('send.stageDone')})</span>}
              </span>
            </li>
          ))}
        </ol>
        <p className="muted small">{t('send.doNotClose')}</p>
      </div>
    );
  } else if (error && maybeSent) {
    body = (
      <>
        <Notice tone="error">
          <strong>{t('send.failed')}</strong>
          <p>{t('send.maybeSent')}</p>
          <ErrorDetails error={error.cause} />
        </Notice>
        <button type="button" className="primary" onClick={onViewHistory}>
          {t('common.viewHistory')}
        </button>
      </>
    );
  } else {
    body = (
      <form className="stack" onSubmit={submit}>
        <PasswordField label={t('send.confirmPassword')} name="password" value={password} onChange={setPassword} autoFocus />
        {error?.cause instanceof WrongPasswordError && <Notice tone="error">{t('unlock.wrongPassword')}</Notice>}
        {error && !(error.cause instanceof WrongPasswordError) && (
          <Notice tone="error">
            <strong>{t('send.failed')}</strong>
            {hint && <p>{hint}</p>}
            <ErrorDetails error={error.cause} />
          </Notice>
        )}
        <button type="submit" className="primary" disabled={password === ''}>
          {busy ? (
            <>
              <Spinner /> {submitLabel}
            </>
          ) : (
            submitLabel
          )}
        </button>
      </form>
    );
  }

  return (
    <>
      {/* Mounted before the spend starts, so screen readers announce every stage change. */}
      <p role="status" className="visually-hidden">
        {stage ? t(`send.stage.${stage}`) : ''}
      </p>
      {body}
    </>
  );
}
