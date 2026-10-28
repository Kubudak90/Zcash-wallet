import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import { Notice, Screen } from '../components/ui';
import { SHIELDING_THRESHOLD_ZATS, TYPICAL_FEE_ZATS, shieldedTotal } from '../engine';
import { useI18n, type MessageKey } from '../i18n';
import { checkAddress, parsePaymentInput, shortAddress, type AddressCheck, type PaymentRequest } from '../lib/address';
import { AmountError, formatZec, formatZecInput, parseZec } from '../lib/zec';
import { useController, useWallet } from '../state/wallet';
import type { Tab } from './Main';
import { SpendConfirm } from './SpendSteps';

type Step = 'form' | 'confirm' | 'done';

interface Draft {
  to: string;
  zats: bigint;
  kind: Extract<AddressCheck, { ok: true }>['kind'];
}

/** Why a payment link cannot be paid as it stands, or null if it can. */
function linkProblem(request: PaymentRequest): MessageKey | null {
  if (request.unsupported) return `send.err.link.${request.unsupported}`;
  // Paying without the memo can leave the payment unmatched, e.g. an exchange deposit.
  if (request.memo !== undefined) return 'send.err.link.memo';
  return null;
}

function tryParseZec(input: string): bigint | null {
  try {
    return parseZec(input);
  } catch {
    return null;
  }
}

export function Send({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { t, lang } = useI18n();
  const controller = useController();
  const { summary, meta, spending } = useWallet();
  const fmt = (z: bigint) => formatZec(z, { locale: lang });

  const [step, setStep] = useState<Step>('form');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [uriFilled, setUriFilled] = useState(false);
  const [toError, setToError] = useState<MessageKey | null>(null);
  const [amountError, setAmountError] = useState<MessageKey | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const toErrorId = useId();
  const amountErrorId = useId();
  const amountEchoId = useId();
  const toRef = useRef<HTMLTextAreaElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (step === 'done') resultRef.current?.focus();
  }, [step]);

  const available = summary ? shieldedTotal(summary.balances) : 0n;
  const transparent = summary?.balances.transparent ?? 0n;
  const shieldable = transparent >= SHIELDING_THRESHOLD_ZATS + TYPICAL_FEE_ZATS;
  const max = available > TYPICAL_FEE_ZATS ? available - TYPICAL_FEE_ZATS : 0n;
  const addressCheck = to.trim() ? checkAddress(to) : null;
  // Echoed under the field: a lone separator is always decimal, so "1.000" reads as 1 ZEC.
  const typedZats = tryParseZec(amount);

  if (meta?.kind === 'view') {
    return (
      <Screen title={t('send.title')}>
        <Notice tone="info">{t('send.viewOnly')}</Notice>
      </Screen>
    );
  }

  function onToChange(value: string) {
    const request = parsePaymentInput(value);
    const problem = linkProblem(request);
    // A link that cannot be paid as asked stays as typed, so the user sees what it asked for.
    setTo(problem ? value : request.address);
    setToError(problem);
    if (!problem && request.amountZats !== undefined) {
      setAmount(formatZecInput(request.amountZats, lang));
      setAmountError(null);
      setUriFilled(true);
    }
  }

  function review(e: FormEvent) {
    e.preventDefault();
    const check = checkAddress(to);
    const nextToError: MessageKey | null =
      linkProblem(parsePaymentInput(to)) ?? (check.ok ? null : `send.err.address.${check.reason}`);

    let zats: bigint | null = null;
    let nextAmountError: MessageKey | null = null;
    try {
      zats = parseZec(amount);
      if (zats + TYPICAL_FEE_ZATS > available) {
        // Shielding first costs one more fee before the funds become spendable.
        const afterShielding = shieldable ? available + transparent - TYPICAL_FEE_ZATS : available;
        nextAmountError =
          zats + TYPICAL_FEE_ZATS <= afterShielding
            ? 'send.err.amount.insufficientShieldFirst'
            : 'send.err.amount.insufficient';
        zats = null;
      }
    } catch (err) {
      nextAmountError = err instanceof AmountError ? `send.err.amount.${err.code}` : 'send.err.amount.invalid';
    }

    if (check.ok && nextToError === null && zats !== null) {
      setToError(null);
      setAmountError(null);
      setDraft({ to: to.trim(), zats, kind: check.kind });
      setStep('confirm');
      return;
    }
    // Render the errors before moving focus, so the field is announced with its description.
    flushSync(() => {
      setToError(nextToError);
      setAmountError(nextAmountError);
    });
    (nextToError ? toRef : amountRef).current?.focus();
  }

  function newPayment() {
    setTo('');
    setAmount('');
    setDraft(null);
    setUriFilled(false);
    setStep('form');
  }

  if (step === 'done' && draft) {
    return (
      <Screen title={t('send.title')}>
        <div className="result">
          <span className="result-icon" aria-hidden="true">
            ✓
          </span>
          <h2 ref={resultRef} tabIndex={-1}>
            {t('send.sentTitle', { amount: fmt(draft.zats) })}
          </h2>
          <p className="muted">{t('send.success')}</p>
        </div>
        <DraftSummary draft={draft} />
        <div className="row">
          <button type="button" className="secondary" onClick={() => onNavigate('history')}>
            {t('common.viewHistory')}
          </button>
          <button type="button" className="primary" onClick={newPayment}>
            {t('send.another')}
          </button>
        </div>
      </Screen>
    );
  }

  if (step === 'confirm' && draft) {
    return (
      <Screen title={t('send.confirmTitle')} onBack={spending ? undefined : () => setStep('form')}>
        <DraftSummary draft={draft} />
        {draft.kind === 'transparent' && <Notice tone="warn">{t('send.transparentWarn')}</Notice>}
        {draft.kind === 'tex' && <Notice tone="warn">{t('send.texWarn')}</Notice>}
        <SpendConfirm
          submitLabel={t('send.sendNow')}
          failureHint={t('send.failedHint')}
          onViewHistory={() => onNavigate('history')}
          run={async (password, onStage) => {
            await controller.send(draft.to, draft.zats, password, onStage);
            setStep('done');
          }}
        />
      </Screen>
    );
  }

  const amountDescribedBy = [amountError && amountErrorId, typedZats !== null && amountEchoId]
    .filter(Boolean)
    .join(' ');

  return (
    <Screen title={t('send.title')}>
      <form className="stack" onSubmit={review} noValidate>
        <label className="field">
          <span>{t('send.to')}</span>
          <textarea
            ref={toRef}
            name="to"
            rows={3}
            placeholder={t('send.toPlaceholder')}
            value={to}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={toError !== null}
            aria-describedby={toError ? toErrorId : undefined}
            onChange={(e) => onToChange(e.target.value)}
          />
        </label>
        {toError && (
          <p id={toErrorId} className="field-error">
            {t(toError)}
          </p>
        )}
        {!toError && addressCheck?.ok && addressCheck.kind === 'transparent' && (
          <p className="field-warn">{t('send.transparentWarn')}</p>
        )}

        <label className="field">
          <span>{t('send.amount')}</span>
          <div className="input-row">
            <input
              ref={amountRef}
              name="amount"
              inputMode="decimal"
              placeholder={fmt(0n)}
              value={amount}
              autoComplete="off"
              aria-invalid={amountError !== null}
              aria-describedby={amountDescribedBy || undefined}
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
                setAmount(formatZecInput(max, lang));
                setAmountError(null);
              }}
            >
              {t('send.max')}
            </button>
          </div>
        </label>
        {amountError && (
          <p id={amountErrorId} className="field-error">
            {t(amountError)}
          </p>
        )}
        {typedZats !== null && (
          <p id={amountEchoId} className="muted small">
            = {fmt(typedZats)} ZEC
          </p>
        )}
        {uriFilled && <p className="muted small">{t('send.uriFilled')}</p>}
        <p className="muted small">
          {t('send.available', { amount: fmt(available) })} · {t('send.fee', { amount: fmt(TYPICAL_FEE_ZATS) })}
        </p>
        {shieldable && (
          <Notice tone="info">
            <p>{t('send.shieldFirst', { amount: fmt(transparent) })}</p>
            <button type="button" className="secondary" onClick={() => onNavigate('shield')}>
              {t('home.shieldButton')}
            </button>
          </Notice>
        )}
        <button type="submit" className="primary">
          {t('send.review')}
        </button>
      </form>
    </Screen>
  );
}

function DraftSummary({ draft }: { draft: Draft }) {
  const { t, lang } = useI18n();
  const fmt = (z: bigint) => formatZec(z, { locale: lang });
  return (
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
  );
}
