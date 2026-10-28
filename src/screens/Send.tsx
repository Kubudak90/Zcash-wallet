import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import { Notice, Screen, useHideBalances } from '../components/ui';
import { MEMO_MAX_BYTES, SHIELDING_THRESHOLD_ZATS, TYPICAL_FEE_ZATS, shieldedTotal, type SendStage } from '../engine';
import { useI18n, type MessageKey } from '../i18n';
import {
  acceptsMemo,
  checkAddress,
  parsePaymentInput,
  shortAddress,
  type AddressCheck,
  type PaymentRequest,
} from '../lib/address';
import { memoBytes, memoProblem } from '../lib/memo';
import { spendingDisabled } from '../lib/network';
import { AmountError, formatZec, formatZecInput, parseZec } from '../lib/zec';
import { useController, useWallet } from '../state/wallet';
import type { Tab } from './Main';
import { useNetworkView } from './NetworkBanner';
import { SpendConfirm } from './SpendSteps';

type Step = 'form' | 'confirm' | 'done';

interface Draft {
  to: string;
  zats: bigint;
  kind: Extract<AddressCheck, { ok: true }>['kind'];
  /** Only set for a recipient that can take one. */
  memo?: string;
}

/** What a payment link filled in, and for which recipient. */
interface LinkFill {
  to: string;
  amount: boolean;
  memo: boolean;
}

/** Why a payment link cannot be paid as it stands, or null if it can. */
function linkProblem(request: PaymentRequest): MessageKey | null {
  return request.refused ? `send.err.link.${request.refused}` : null;
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
  const network = useNetworkView();
  const balances = useHideBalances();
  const fmt = (z: bigint) => formatZec(z, { locale: lang });

  const [step, setStep] = useState<Step>('form');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [linkFill, setLinkFill] = useState<LinkFill | null>(null);
  const [toError, setToError] = useState<MessageKey | null>(null);
  const [amountError, setAmountError] = useState<MessageKey | null>(null);
  const [memoError, setMemoError] = useState<MessageKey | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const toErrorId = useId();
  const amountErrorId = useId();
  const amountEchoId = useId();
  const memoErrorId = useId();
  const memoInfoId = useId();
  const toRef = useRef<HTMLTextAreaElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const memoRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (step === 'done') resultRef.current?.focus();
  }, [step]);

  const available = summary ? shieldedTotal(summary.balances) : 0n;
  const transparent = summary?.balances.transparent ?? 0n;
  const shieldable = transparent >= SHIELDING_THRESHOLD_ZATS + TYPICAL_FEE_ZATS;
  const max = available > TYPICAL_FEE_ZATS ? available - TYPICAL_FEE_ZATS : 0n;
  const addressCheck = to.trim() ? checkAddress(to) : null;
  // null until the recipient is a valid address.
  const takesMemo = addressCheck?.ok ? acceptsMemo(to) : null;
  const memoUsed = memoBytes(memo);
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
    const fills = !problem && (request.amountZats !== undefined || request.memo !== undefined);
    // What a link filled in was asked for its own recipient: a new link or recipient drops it.
    if (linkFill && (fills || problem || request.address !== linkFill.to)) {
      if (linkFill.amount) setAmount('');
      if (linkFill.memo) setMemo('');
      setLinkFill(null);
    }
    if (fills) {
      if (request.amountZats !== undefined) {
        setAmount(formatZecInput(request.amountZats, lang));
        setAmountError(null);
      }
      if (request.memo !== undefined) {
        setMemo(request.memo);
        setMemoError(null);
      }
      setLinkFill({ to: request.address, amount: request.amountZats !== undefined, memo: request.memo !== undefined });
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

    // A recipient that cannot take a memo shows a note instead of the field, so none is sent.
    const sendMemo = check.ok && acceptsMemo(to) && memo !== '' ? memo : undefined;
    const problem = sendMemo === undefined ? null : memoProblem(sendMemo);
    const nextMemoError: MessageKey | null = problem && `send.err.memo.${problem}`;

    if (check.ok && nextToError === null && zats !== null && nextMemoError === null) {
      setToError(null);
      setAmountError(null);
      setMemoError(null);
      setDraft({ to: to.trim(), zats, kind: check.kind, memo: sendMemo });
      setStep('confirm');
      return;
    }
    // Render the errors before moving focus, so the field is announced with its description.
    flushSync(() => {
      setToError(nextToError);
      setAmountError(nextAmountError);
      setMemoError(nextMemoError);
    });
    (nextToError ? toRef : nextAmountError ? amountRef : memoRef).current?.focus();
  }

  function clearForm() {
    setTo('');
    setAmount('');
    setMemo('');
    setLinkFill(null);
    setToError(null);
    setAmountError(null);
    setMemoError(null);
  }

  function newPayment() {
    flushSync(() => {
      clearForm();
      setDraft(null);
      setStep('form');
    });
    // The form has the result's title, so Screen keeps focus where it is: it would fall to <body>.
    toRef.current?.focus();
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
          disabledText={t('send.disabledOutdated')}
          failureHint={t('send.failedHint')}
          onViewHistory={() => onNavigate('history')}
          run={async (password, onStage) => {
            const stage = (s: SendStage) => {
              // From here the payment may go out even if the step fails, so Back must not offer it again.
              if (s === 'broadcasting') clearForm();
              onStage(s);
            };
            await controller.send(draft.to, draft.zats, password, stage, draft.memo);
            setStep('done');
          }}
        />
      </Screen>
    );
  }

  // Nothing this version builds would be accepted, so there is no form to fill in.
  if (spendingDisabled(network)) {
    return (
      <Screen title={t('send.title')}>
        <Notice tone="warn">
          <p data-testid="spend-disabled">
            {t(network.kind === 'outdated' ? 'send.disabledOutdated' : 'network.unreachable')}
          </p>
        </Notice>
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
                setLinkFill((f) => f && { ...f, amount: false });
              }}
            />
            <button
              type="button"
              className="secondary"
              disabled={max === 0n}
              onClick={() => {
                setAmount(formatZecInput(max, lang));
                setAmountError(null);
                setLinkFill((f) => f && { ...f, amount: false });
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
        {linkFill?.amount && <p className="muted small">{t('send.uriFilled')}</p>}
        <p className="muted small">
          {t('send.available', { amount: balances.fmt(available) })} · {t('send.fee', { amount: fmt(TYPICAL_FEE_ZATS) })}
        </p>

        {takesMemo === true && (
          <>
            <label className="field">
              <span>{t('send.memo')}</span>
              <textarea
                ref={memoRef}
                name="memo"
                className="memo"
                rows={2}
                value={memo}
                autoComplete="off"
                // Some browsers' enhanced spell check sends the text to a server.
                spellCheck={false}
                aria-invalid={memoError !== null}
                aria-describedby={[memoError && memoErrorId, memoInfoId].filter(Boolean).join(' ')}
                onChange={(e) => {
                  setMemo(e.target.value);
                  setMemoError(null);
                  setLinkFill((f) => f && { ...f, memo: false });
                }}
              />
            </label>
            {memoError && (
              <p id={memoErrorId} className="field-error">
                {t(memoError)}
              </p>
            )}
            <p id={memoInfoId} className="memo-info small">
              <span className="muted">{t('send.memoHelp')}</span>
              <span className={memoUsed > MEMO_MAX_BYTES ? 'memo-count over' : 'memo-count muted'} data-testid="memo-count">
                {t('send.memoCount', { used: memoUsed, max: MEMO_MAX_BYTES })}
              </span>
            </p>
            {linkFill?.memo && <p className="muted small">{t('send.memoFromLink')}</p>}
          </>
        )}
        {takesMemo === false && <p className="muted small">{t('send.memoUnavailable')}</p>}

        {shieldable && (
          <Notice tone="info">
            <p>{t('send.shieldFirst', { amount: balances.fmt(transparent) })}</p>
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
      {draft.memo && (
        <div className="summary-memo">
          <dt>{t('send.confirmMemo')}</dt>
          <dd data-testid="confirm-memo">{draft.memo}</dd>
        </div>
      )}
    </dl>
  );
}
