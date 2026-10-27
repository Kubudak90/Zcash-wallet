import { useState, type FormEvent } from 'react';

import { Notice, Screen } from '../components/ui';
import { TYPICAL_FEE_ZATS, shieldedTotal } from '../engine';
import { useI18n, type MessageKey } from '../i18n';
import { checkAddress, parsePaymentInput, shortAddress, type AddressCheck } from '../lib/address';
import { AmountError, formatZec, parseZec, zatsToPlainZec } from '../lib/zec';
import { useController, useWallet } from '../state/wallet';
import { SpendConfirm } from './SpendSteps';

type Step = 'form' | 'confirm' | 'done';

interface Draft {
  to: string;
  zats: bigint;
  kind: Extract<AddressCheck, { ok: true }>['kind'];
}

export function Send() {
  const { t, lang } = useI18n();
  const controller = useController();
  const { summary, meta } = useWallet();
  const fmt = (z: bigint) => formatZec(z, { locale: lang });

  const [step, setStep] = useState<Step>('form');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [uriFilled, setUriFilled] = useState(false);
  const [toError, setToError] = useState<MessageKey | null>(null);
  const [amountError, setAmountError] = useState<MessageKey | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const available = summary ? shieldedTotal(summary.balances) : 0n;
  const max = available > TYPICAL_FEE_ZATS ? available - TYPICAL_FEE_ZATS : 0n;
  const addressCheck = to.trim() ? checkAddress(to) : null;

  if (meta?.kind === 'view') {
    return (
      <Screen title={t('send.title')}>
        <Notice tone="info">{t('send.viewOnly')}</Notice>
      </Screen>
    );
  }

  function onToChange(value: string) {
    const request = parsePaymentInput(value);
    setTo(request.address);
    setToError(null);
    if (request.amountZats !== undefined) {
      setAmount(zatsToPlainZec(request.amountZats));
      setAmountError(null);
      setUriFilled(true);
    }
  }

  function review(e: FormEvent) {
    e.preventDefault();
    const check = checkAddress(to);
    setToError(check.ok ? null : (`send.err.address.${check.reason}` as MessageKey));

    let zats: bigint | null = null;
    try {
      zats = parseZec(amount);
      if (zats + TYPICAL_FEE_ZATS > available) {
        setAmountError('send.err.amount.insufficient');
        zats = null;
      } else {
        setAmountError(null);
      }
    } catch (err) {
      setAmountError(err instanceof AmountError ? (`send.err.amount.${err.code}` as MessageKey) : 'send.err.amount.invalid');
    }

    if (check.ok && zats !== null) {
      setDraft({ to: to.trim(), zats, kind: check.kind });
      setStep('confirm');
    }
  }

  if (step === 'done') {
    return (
      <Screen title={t('send.title')}>
        <Notice tone="ok">{t('send.success')}</Notice>
        <button
          type="button"
          className="primary"
          onClick={() => {
            setTo('');
            setAmount('');
            setDraft(null);
            setUriFilled(false);
            setStep('form');
          }}
        >
          {t('send.another')}
        </button>
      </Screen>
    );
  }

  if (step === 'confirm' && draft) {
    return (
      <Screen title={t('send.confirmTitle')} onBack={() => setStep('form')}>
        <dl className="summary">
          <div>
            <dt>{t('send.confirmTo')}</dt>
            <dd>
              <code title={draft.to}>{shortAddress(draft.to, 12)}</code>
            </dd>
          </div>
          <div>
            <dt>{t('send.confirmAmount')}</dt>
            <dd data-testid="confirm-amount">{fmt(draft.zats)} ZEC</dd>
          </div>
          <div>
            <dt>{t('send.confirmFee')}</dt>
            <dd>~{fmt(TYPICAL_FEE_ZATS)} ZEC</dd>
          </div>
        </dl>
        {draft.kind === 'transparent' && <Notice tone="warn">{t('send.transparentWarn')}</Notice>}
        {draft.kind === 'tex' && <Notice tone="warn">{t('send.texWarn')}</Notice>}
        <SpendConfirm
          submitLabel={t('send.sendNow')}
          failureHint={t('send.failedHint')}
          run={async (password, onStage) => {
            await controller.send(draft.to, draft.zats, password, onStage);
            setStep('done');
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen title={t('send.title')}>
      <form className="stack" onSubmit={review} noValidate>
        <label className="field">
          <span>{t('send.to')}</span>
          <textarea
            name="to"
            rows={3}
            placeholder={t('send.toPlaceholder')}
            value={to}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => onToChange(e.target.value)}
          />
        </label>
        {toError && <p className="field-error">{t(toError)}</p>}
        {!toError && addressCheck?.ok && addressCheck.kind === 'transparent' && (
          <p className="field-warn">{t('send.transparentWarn')}</p>
        )}

        <label className="field">
          <span>{t('send.amount')}</span>
          <div className="input-row">
            <input
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              autoComplete="off"
              onChange={(e) => {
                setAmount(e.target.value);
                setAmountError(null);
                setUriFilled(false);
              }}
            />
            <button
              type="button"
              className="secondary"
              disabled={max === 0n}
              onClick={() => {
                setAmount(zatsToPlainZec(max));
                setAmountError(null);
              }}
            >
              {t('send.max')}
            </button>
          </div>
        </label>
        {amountError && <p className="field-error">{t(amountError)}</p>}
        {uriFilled && <p className="muted small">{t('send.uriFilled')}</p>}
        <p className="muted small">
          {t('send.available', { amount: fmt(available) })} · {t('send.fee', { amount: fmt(TYPICAL_FEE_ZATS) })}
        </p>
        <button type="submit" className="primary">
          {t('send.review')}
        </button>
      </form>
    </Screen>
  );
}
