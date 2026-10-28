import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { ErrorDetails, Notice, PasswordField, Spinner } from '../components/ui';
import type { SendStage } from '../engine';
import { useI18n } from '../i18n';
import { spendingDisabled } from '../lib/network';
import { spendWait } from '../lib/spendWait';
import { WrongPasswordError } from '../lib/vault';
import { useWallet } from '../state/wallet';
import { useSyncView } from './Main';
import { useNetworkView } from './NetworkBanner';

const STAGES: SendStage[] = ['building', 'signing', 'proving', 'broadcasting'];

/** Password confirmation plus live progress for a spend (send or shield). */
export function SpendConfirm({
  submitLabel,
  run,
  disabledText,
  failureHint,
  onViewHistory,
}: {
  submitLabel: string;
  run: (password: string, onStage: (s: SendStage) => void) => Promise<void>;
  /** Shown in place of the form while the network runs rules this version does not support. */
  disabledText: string;
  /** Shown when building the transaction failed, before anything was signed. */
  failureHint?: string;
  onViewHistory: () => void;
}) {
  const { t, lang } = useI18n();
  const view = useSyncView();
  const network = useNetworkView();
  const { sync, summary } = useWallet();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<SendStage | null>(null);
  const [error, setError] = useState<{ cause: unknown; stage: SendStage | null } | null>(null);
  // Refs, not state: a second click in the same tick must already see them.
  const running = useRef(false);
  const lastStage = useRef<SendStage | null>(null);

  // A spend started during a pass, or far behind the tip, would sit on
  // "building" for that long (see spendWait).
  const wait = spendWait(view, sync, summary);
  const blocks = (n: number) => n.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US');
  let waitFor: string | null = null;
  if (wait?.kind === 'syncing') waitFor = t('send.waitForSync', { blocks: blocks(wait.blocksLeft) });
  else if (wait?.kind === 'behind') waitFor = t('send.waitForRetry', { blocks: blocks(wait.blocksLeft) });
  else if (wait?.kind === 'connecting') waitFor = t('send.waitForConnect');
  // The first network check has not answered yet; the controller would wait for it too.
  else if (network.kind === 'checking') waitFor = t('send.waitForConnect');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (running.current || waitFor || spendingDisabled(network)) return;
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
  } else if (spendingDisabled(network)) {
    // The controller refuses too (NetworkNotSupportedError), before anything is built or sent.
    body = (
      <Notice tone="warn">
        <p data-testid="spend-disabled">{network.kind === 'outdated' ? disabledText : t('network.unreachable')}</p>
        {/* A spend the check stopped before the broadcast: say that nothing went out. */}
        {error && <p>{t('send.nothingSent')}</p>}
      </Notice>
    );
  } else {
    body = (
      <form className="stack" onSubmit={submit}>
        {waitFor && (
          <Notice tone="info">
            <span data-testid="spend-wait">{waitFor}</span>
          </Notice>
        )}
        <PasswordField label={t('send.confirmPassword')} name="password" value={password} onChange={setPassword} autoFocus />
        {error?.cause instanceof WrongPasswordError && <Notice tone="error">{t('unlock.wrongPassword')}</Notice>}
        {error && !(error.cause instanceof WrongPasswordError) && (
          <Notice tone="error">
            <strong>{t('send.failed')}</strong>
            {hint && <p>{hint}</p>}
            <ErrorDetails error={error.cause} />
          </Notice>
        )}
        <button type="submit" className="primary" disabled={password === '' || waitFor !== null}>
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
