import { useEffect, useId, useState, type FormEvent } from 'react';

import { ErrorDetails, Notice, Screen, Spinner } from '../components/ui';
import { useI18n } from '../i18n';
import {
  LONG_SCAN_BLOCKS,
  SAPLING_ACTIVATION_HEIGHT,
  SAPLING_MONTH,
  blocksToScan,
  currentMonth,
  estimateBirthday,
  parseBirthdayMonth,
} from '../lib/birthday';
import { isValidSeedPhrase, normalizeSeedPhrase } from '../lib/seed';
import type { Secret } from '../lib/vault';
import { useController, useWallet } from '../state/wallet';
import { PasswordSetup } from './PasswordSetup';

type Step = 'secret' | 'birthday' | 'password';
type Mode = 'seed' | 'view';

export function RestoreWallet({ onCancel }: { onCancel: () => void }) {
  const { t, lang } = useI18n();
  const controller = useController();
  const { settings } = useWallet();
  const [step, setStep] = useState<Step>('secret');
  const [mode, setMode] = useState<Mode>('seed');
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState(false);
  const [secret, setSecret] = useState<Secret | null>(null);

  const [month, setMonth] = useState('');
  const [monthTouched, setMonthTouched] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [birthday, setBirthday] = useState<number | null>(null);
  /** The network tip, read once the month step shows, for the long-scan notice; null until it answers. */
  const [tip, setTip] = useState<number | null>(null);
  const monthErrorId = useId();
  const longScanId = useId();
  const historyHelpId = useId();
  /**
   * "Fetch full transactions for History" for this restore (final review V2-4): the first pass
   * would otherwise ask the server for the wallet's past transactions before Settings could be
   * reached. Null until changed here; saved with the browser's settings when the wallet is
   * created, before its first pass.
   */
  const [historyChoice, setHistoryChoice] = useState<boolean | null>(null);
  const historyEnhancement = historyChoice ?? settings.historyEnhancement;

  useEffect(() => {
    if (step !== 'birthday' || tip !== null) return;
    let live = true;
    controller.latestHeight().then(
      (h) => live && setTip(h),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [step, tip, controller]);

  // Browsers without a month picker show a text box, where people type '05.2023'.
  const parsedMonth = parseBirthdayMonth(month);
  const monthError = !unknown && monthTouched && month.trim() !== '' && parsedMonth === null;
  // A start this old means hours of scanning: say so, without stopping anyone who is sure.
  const longScan = !unknown && parsedMonth !== null ? blocksToScan(parsedMonth, tip) : 0;
  const showLongScan = longScan > LONG_SCAN_BLOCKS;

  async function submitSecret(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'seed') {
        const ok = isValidSeedPhrase(input);
        setInputError(!ok);
        if (ok) {
          setSecret({ kind: 'seed', phrase: normalizeSeedPhrase(input) });
          setStep('birthday');
        }
      } else {
        const ufvk = input.trim();
        const ok = await controller.isValidViewingKey(ufvk);
        setInputError(!ok);
        if (ok) {
          setSecret({ kind: 'ufvk', ufvk });
          setStep('birthday');
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitBirthday(e: FormEvent) {
    e.preventDefault();
    if (!secret) return;
    setBusy(true);
    setError(null);
    try {
      let height: number;
      if (unknown) {
        const detected = await controller.detectBirthday(
          secret.kind === 'seed' ? { phrase: secret.phrase } : { ufvk: secret.ufvk },
        );
        height = detected ?? SAPLING_ACTIVATION_HEIGHT;
      } else {
        if (!parsedMonth) return;
        height = estimateBirthday(new Date(`${parsedMonth}-01T00:00:00Z`), await controller.latestHeight());
      }
      setBirthday(height);
      setStep('password');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (step === 'secret') {
    return (
      <Screen title={t('restore.title')} onBack={onCancel}>
        <div className="segmented" role="tablist">
          {(['seed', 'view'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'active' : ''}
              onClick={() => {
                setMode(m);
                setInputError(false);
              }}
            >
              {t(m === 'seed' ? 'restore.modeSeed' : 'restore.modeView')}
            </button>
          ))}
        </div>
        <form className="stack" onSubmit={submitSecret}>
          {mode === 'view' && <p className="muted">{t('restore.viewHelp')}</p>}
          <label className="field">
            <span>{t(mode === 'seed' ? 'restore.seedLabel' : 'restore.viewLabel')}</span>
            <textarea
              name={mode === 'seed' ? 'seed-phrase' : 'viewing-key'}
              rows={mode === 'seed' ? 4 : 5}
              value={input}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>
          {inputError && (
            <Notice tone="error">{t(mode === 'seed' ? 'restore.seedInvalid' : 'restore.viewInvalid')}</Notice>
          )}
          <button type="submit" className="primary" disabled={busy || input.trim() === ''}>
            {t('common.continue')}
          </button>
        </form>
      </Screen>
    );
  }

  if (step === 'birthday') {
    return (
      <Screen title={t('restore.birthdayTitle')} onBack={busy ? undefined : () => setStep('secret')}>
        <p className="muted">{t('restore.birthdayHelp')}</p>
        <form className="stack" onSubmit={submitBirthday}>
          <label className="field">
            <span>{t('restore.birthdayMonth')}</span>
            <input
              type="month"
              name="birthday-month"
              min={SAPLING_MONTH}
              max={currentMonth()}
              placeholder={t('restore.birthdayPlaceholder')}
              value={month}
              disabled={unknown}
              aria-invalid={monthError}
              aria-describedby={monthError ? monthErrorId : showLongScan ? longScanId : undefined}
              onChange={(e) => setMonth(e.target.value)}
              onBlur={() => setMonthTouched(true)}
            />
          </label>
          {monthError && (
            <p id={monthErrorId} className="field-error">
              {t('restore.birthdayInvalid')}
            </p>
          )}
          {showLongScan && parsedMonth && (
            <Notice tone="warn">
              <span id={longScanId} data-testid="long-scan">
                {t('restore.longScan', {
                  month: parsedMonth,
                  blocks: (Math.round(longScan / 10_000) * 10_000).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US'),
                })}
              </span>
            </Notice>
          )}
          <label className="check">
            <input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} />
            {t('restore.birthdayUnknown')}
          </label>
          {unknown && <Notice tone="warn">{t('restore.birthdayUnknownHelp')}</Notice>}
          <label className="check">
            <input
              type="checkbox"
              name="history-enhancement"
              checked={historyEnhancement}
              aria-describedby={historyHelpId}
              onChange={(e) => setHistoryChoice(e.target.checked)}
            />
            {t('settings.historyEnhancement')}
          </label>
          <p id={historyHelpId} className="muted small">
            {t('restore.historyEnhancementHelp')}
          </p>
          {error != null && (
            <Notice tone="error">
              {t('common.genericError')}
              <ErrorDetails error={error} />
            </Notice>
          )}
          <button type="submit" className="primary" disabled={busy || (!unknown && !parsedMonth)}>
            {busy ? (
              <>
                <Spinner /> {unknown ? t('restore.birthdayDetecting') : t('common.continue')}
              </>
            ) : (
              t('common.continue')
            )}
          </button>
        </form>
      </Screen>
    );
  }

  return (
    <PasswordSetup
      note={
        birthday !== null && (
          <Notice tone="info">
            {t('restore.birthdayHeight', { height: birthday.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US') })}
          </Notice>
        )
      }
      onBack={() => setStep('birthday')}
      onSubmit={async (password) => {
        if (!secret || birthday === null) return;
        // The engine is told at once and applies it to the wallet it opens next.
        if (historyEnhancement !== settings.historyEnhancement) {
          await controller.saveSettings({ ...settings, historyEnhancement });
        }
        await controller.createWallet(secret, birthday, password);
      }}
      viewOnly={secret?.kind === 'ufvk'}
    />
  );
}
