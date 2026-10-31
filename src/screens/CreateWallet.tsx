import { forwardRef, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { ClipboardClearNote, Notice, Screen } from '../components/ui';
import { useI18n } from '../i18n';
import { newWalletBirthday } from '../lib/birthday';
import { newSeedPhrase, pickVerificationPositions } from '../lib/seed';
import { Icon } from '../components/icons';
import { useController } from '../state/wallet';
import { Flow } from './AccountLayout';
import { PasswordSetup } from './PasswordSetup';

type Step = 'seed' | 'verify' | 'password';

export const SeedGrid = forwardRef<HTMLOListElement, { phrase: string; hidden?: boolean }>(function SeedGrid(
  { phrase, hidden = false },
  ref,
) {
  return (
    <ol
      ref={ref}
      className={hidden ? 'seed-grid blurred' : 'seed-grid'}
      data-testid="seed-grid"
      // A copy of the words by hand is cleared from the clipboard a minute later, like the
      // viewing key's (lib/clipboard.ts; review round 7, VAULT-4). Copying is not blocked:
      // some users paste them into a password manager.
      data-clipboard-clear="seed"
      aria-hidden={hidden}
      // Focusable from code only, once revealed.
      tabIndex={hidden ? undefined : -1}
    >
      {phrase.split(' ').map((word, i) => (
        <li key={i}>
          <span className="seed-index">{i + 1}</span>
          <span className="seed-word">{word}</span>
        </li>
      ))}
    </ol>
  );
});

export function CreateWallet({ onCancel }: { onCancel: () => void }) {
  const { t } = useI18n();
  const controller = useController();
  const [phrase] = useState(newSeedPhrase);
  const [step, setStep] = useState<Step>('seed');
  const [revealed, setRevealed] = useState(false);
  const [wroteDown, setWroteDown] = useState(false);
  const grid = useRef<HTMLOListElement>(null);

  // The Reveal button disappears when pressed; start reading at the words.
  useEffect(() => {
    if (revealed) grid.current?.focus();
  }, [revealed]);

  const positions = useMemo(() => pickVerificationPositions(3), []);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [verifyFailed, setVerifyFailed] = useState(false);

  if (step === 'seed') {
    return (
      <Flow step={1}>
        <Screen title={t('create.seedTitle')} onBack={onCancel}>
          <p className="muted">{t('create.seedIntro')}</p>
          <Notice tone="warn">
            <ul className="plain">
              <li>{t('create.seedWarn1')}</li>
              <li>{t('create.seedWarn2')}</li>
              <li>{t('create.seedWarn3')}</li>
              <li>{t('create.seedWarn4')}</li>
            </ul>
          </Notice>
          <div className={revealed ? 'seed-wrap' : 'seed-wrap covered'}>
            <SeedGrid ref={grid} phrase={phrase} hidden={!revealed} />
            {!revealed && (
              <button type="button" className="secondary reveal" onClick={() => setRevealed(true)}>
                <Icon name="eye" />
                {t('create.reveal')}
              </button>
            )}
          </div>
          <ClipboardClearNote source="seed" />
          <label className="check">
            <input
              type="checkbox"
              checked={wroteDown}
              disabled={!revealed}
              onChange={(e) => setWroteDown(e.target.checked)}
            />
            {t('create.wroteDown')}
          </label>
          <button
            type="button"
            className="primary"
            disabled={!revealed || !wroteDown}
            onClick={() => setStep('verify')}
          >
            {t('common.continue')}
          </button>
        </Screen>
      </Flow>
    );
  }

  if (step === 'verify') {
    const words = phrase.split(' ');
    const submit = (e: FormEvent) => {
      e.preventDefault();
      const ok = positions.every((p, i) => answers[i]!.trim().toLowerCase() === words[p]);
      setVerifyFailed(!ok);
      if (ok) setStep('password');
    };
    return (
      <Flow step={2}>
        <Screen title={t('create.verifyTitle')} onBack={() => setStep('seed')}>
          <p className="muted">{t('create.verifyIntro')}</p>
          <form className="stack" onSubmit={submit}>
            <div className="verify-words">
              {positions.map((p, i) => (
                <label key={p} className="field">
                  <span>{t('create.wordN', { n: p + 1 })}</span>
                  <input
                    name={`word-${p + 1}`}
                    className="mono"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus={i === 0}
                    value={answers[i]}
                    onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
                  />
                </label>
              ))}
            </div>
            {verifyFailed && <Notice tone="error">{t('create.verifyError')}</Notice>}
            <button type="submit" className="primary" disabled={answers.some((a) => a.trim() === '')}>
              {t('common.continue')}
            </button>
          </form>
        </Screen>
      </Flow>
    );
  }

  return (
    <PasswordSetup
      onBack={() => setStep('verify')}
      onSubmit={async (password) => {
        const birthday = newWalletBirthday(await controller.latestHeight());
        await controller.createWallet({ kind: 'seed', phrase }, birthday, password);
      }}
    />
  );
}
