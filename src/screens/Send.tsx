import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import { GroupedAddress } from '../components/GroupedAddress';
import { Icon } from '../components/icons';
import { Notice, Screen, useHideBalances } from '../components/ui';
import {
  MEMO_MAX_BYTES,
  SHIELDING_THRESHOLD_ZATS,
  TYPICAL_FEE_ZATS,
  shieldedTotal,
  type Balances,
  type SendStage,
} from '../engine';
import { useI18n, type MessageKey } from '../i18n';
import {
  acceptsMemo,
  checkAddress,
  parsePaymentInput,
  shortAddress,
  unifiedReceivers,
  type AddressCheck,
  type AddressKind,
  type PaymentRequest,
} from '../lib/address';
import { memoBytes, memoProblem } from '../lib/memo';
import { olderPoolSpent } from '../lib/poolCrossing';
import { spendingDisabled } from '../lib/network';
import { AmountError, formatZec, formatZecInput, parseZec } from '../lib/zec';
import { useController, useWallet } from '../state/wallet';
import type { Tab } from './Main';
import { disabledMessage, useNetworkView } from './NetworkBanner';
import { SpendConfirm } from './SpendSteps';

type Step = 'form' | 'confirm' | 'done';

interface Draft {
  to: string;
  zats: bigint;
  kind: Extract<AddressCheck, { ok: true }>['kind'];
  /** Only set for a recipient that can take one. */
  memo?: string;
  /** As reviewed: the pools it may be paid from depend on the balances then, not after the send. */
  recipient: Recipient;
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

/**
 * What kind of address a payment goes to, and whether that address keeps it
 * shielded, from the client-side parse (lib/address.ts). 'partial': the
 * payment lands in Sapling, while this wallet's funds and its change are in
 * Ironwood (Orchard before NU6.3), so the amount that crosses into Sapling
 * shows in its value balance; History labels the same payment "Partly
 * shielded". null privacy: a unified address whose receivers do not decode,
 * which the engine refuses whole; no guess is shown for it.
 */
interface Recipient {
  label: MessageKey;
  privacy: 'shielded' | 'partial' | 'public' | null;
  /** The outcome line, when it is not the one its privacy has (outcomeKey). */
  outcome?: MessageKey;
}

/** What the wallet holds, for telling which pools a payment to an Orchard receiver is paid from. */
interface Funds {
  balances: Balances;
  zats: bigint;
  /** The engine sees Ironwood (ZcashEngine.ironwood): Orchard is then an older pool. */
  ironwood: boolean;
}

/**
 * The fee shown beside a payment, by recipient: ZIP 317 asks more for a
 * transparent output (3 logical actions) and more again for TEX (measured
 * 20,000 zats, tests/unit/spend-refusal.test.ts). Display only: the balance
 * check and Max keep the typical fee, and the engine computes the real one.
 */
function feeFloor(kind: AddressKind | undefined): bigint {
  return kind === 'tex' ? 20_000n : kind === 'transparent' ? 15_000n : TYPICAL_FEE_ZATS;
}

/** The outcome line under the preview, for what is known of the recipient. */
function outcomeKey(recipient: Recipient | null): MessageKey {
  if (!recipient) return 'send.outcome.none';
  if (recipient.outcome) return recipient.outcome;
  switch (recipient.privacy) {
    case 'shielded':
      return 'send.outcome.shielded';
    case 'partial':
      return 'send.outcome.partial';
    case 'public':
      return 'send.outcome.public';
    case null:
      return 'send.outcome.unknown';
  }
}

const PRIVACY_WORDS = {
  shielded: 'send.privacy.shielded',
  partial: 'send.privacy.partial',
  public: 'send.privacy.public',
} as const satisfies Record<string, MessageKey>;

function recipientOf(address: string, kind: AddressKind, funds: Funds | null): Recipient {
  switch (kind) {
    case 'transparent':
      return { label: 'send.kind.transparent', privacy: 'public' };
    case 'tex':
      return { label: 'send.kind.tex', privacy: 'public' };
    case 'sapling':
      // Value entering Sapling from Ironwood or Orchard shows in Sapling's value balance.
      return { label: 'send.kind.sapling', privacy: 'partial' };
    case 'unified': {
      const receivers = unifiedReceivers(address);
      if (receivers === null) return { label: 'send.kind.unified', privacy: null };
      // An Orchard receiver: WebZjs pays it through Ironwood. Fully shielded when Ironwood alone
      // covers it; otherwise funds from an older pool cross into Ironwood, visibly (review
      // round 7, ES-2; lib/poolCrossing.ts).
      if (receivers.includes(0x03)) {
        const older = funds && olderPoolSpent(funds.balances, funds.zats, funds.ironwood);
        if (!older) return { label: 'send.kind.unifiedShielded', privacy: 'shielded' };
        return {
          label: 'send.kind.unifiedPartial',
          privacy: 'partial',
          outcome: older === 'sapling' ? 'send.outcome.fromSapling' : 'send.outcome.fromOrchard',
        };
      }
      // Sapling only: as a Sapling address. Without either only a transparent receiver is left.
      if (receivers.includes(0x02)) return { label: 'send.kind.unifiedPartial', privacy: 'partial' };
      return { label: 'send.kind.unifiedPublic', privacy: 'public' };
    }
  }
}

/** The address type as a tag: a mark and words, the colour on top of them. */
function KindTag({ recipient, id }: { recipient: Recipient; id?: string }) {
  const { t } = useI18n();
  return (
    <span id={id} className={`kind-tag kind-${recipient.privacy ?? 'unknown'}`}>
      <span className="kind-mark" aria-hidden="true" />
      {t(recipient.label)}
    </span>
  );
}

export function Send({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { t, lang } = useI18n();
  const controller = useController();
  const { summary, meta, spending, ironwood } = useWallet();
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

  const toId = useId();
  const toErrorId = useId();
  const toKindId = useId();
  const toWarnId = useId();
  const amountId = useId();
  const amountErrorId = useId();
  const amountEchoId = useId();
  const feeId = useId();
  const memoId = useId();
  const memoErrorId = useId();
  const memoHelpId = useId();
  const memoCountId = useId();
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
  // Echoed under the field: a lone separator is always decimal, so "1.000" reads as 1 ZEC.
  const typedZats = tryParseZec(amount);
  const fundsFor = (zats: bigint): Funds | null => (summary ? { balances: summary.balances, zats, ironwood } : null);
  const recipient =
    addressCheck?.ok && !toError ? recipientOf(to.trim(), addressCheck.kind, fundsFor(typedZats ?? 0n)) : null;
  const memoUsed = memoBytes(memo);

  if (meta?.kind === 'view') {
    return (
      <Screen title={t('send.title')}>
        <div className="stack send-blocked">
          <Notice tone="info">{t('send.viewOnly')}</Notice>
          <div className="row">
            <button type="button" className="secondary" onClick={() => onNavigate('receive')}>
              {t('nav.receive')}
            </button>
          </div>
        </div>
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
      setDraft({
        to: to.trim(),
        zats,
        kind: check.kind,
        memo: sendMemo,
        recipient: recipientOf(to.trim(), check.kind, fundsFor(zats)),
      });
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
        <div className="card spend-done">
          <div className="result">
            <span className="result-icon" aria-hidden="true">
              <Icon name="check" />
            </span>
            <h2 ref={resultRef} tabIndex={-1}>
              {t('send.sentTitle', { amount: fmt(draft.zats) })}
            </h2>
            <p className="muted">{t('send.success')}</p>
          </div>
          <DraftSummary draft={draft} />
          <div className="row spend-done-actions">
            <button type="button" className="secondary" onClick={() => onNavigate('history')}>
              {t('common.viewHistory')}
            </button>
            <button type="button" className="primary" onClick={newPayment}>
              {t('send.another')}
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  if (step === 'confirm' && draft) {
    // The form is gone while the payment is armed: what is confirmed is the draft, shown in full.
    return (
      <Screen title={t('send.confirmTitle')} onBack={spending ? undefined : () => setStep('form')}>
        <div className="spend-layout confirm-layout">
          <div className="card spend-summary">
            <DraftSummary draft={draft} hero />
            {draft.kind === 'transparent' && <Notice tone="warn">{t('send.transparentWarn')}</Notice>}
            {draft.kind === 'tex' && <Notice tone="warn">{t('send.texWarn')}</Notice>}
          </div>
          <div className="card confirm-panel">
            <SpendConfirm
              submitLabel={t('send.sendNow')}
              submitIcon="send"
              disabledText={t('send.disabledOutdated')}
              failureHint={t('send.failedHint')}
              note={
                <>
                  <Icon name="lock" />
                  <span>{t('send.confirmNote')}</span>
                </>
              }
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
          </div>
        </div>
      </Screen>
    );
  }

  // Nothing this version builds would be accepted, so there is no form to fill in.
  if (spendingDisabled(network)) {
    return (
      <Screen title={t('send.title')}>
        <div className="stack send-blocked">
          <Notice tone="warn">
            <p data-testid="spend-disabled">{disabledMessage(network, t('send.disabledOutdated'), t)}</p>
          </Notice>
          <div className="row">
            <button type="button" className="secondary" onClick={() => onNavigate('history')}>
              {t('common.viewHistory')}
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  const toDescribedBy = toError
    ? toErrorId
    : [recipient && toKindId, addressCheck?.ok && addressCheck.kind === 'transparent' && toWarnId].filter(Boolean).join(' ');
  const amountDescribedBy = [amountError && amountErrorId, typedZats !== null && amountEchoId, feeId]
    .filter(Boolean)
    .join(' ');
  const showMemo = takesMemo === true && memo !== '';
  const fee = feeFloor(addressCheck?.ok ? addressCheck.kind : undefined);
  const figureText = fmt(typedZats ?? 0n);

  return (
    <Screen title={t('send.title')} subtitle={t('send.available', { amount: balances.fmt(available) })}>
      <form className="spend-layout send-layout" onSubmit={review} noValidate>
        <div className="card send-form">
          <div className="field">
            <label className="field-label" htmlFor={toId}>
              {t('send.to')}
            </label>
            <textarea
              ref={toRef}
              id={toId}
              name="to"
              className="address-input"
              rows={3}
              placeholder={t('send.toPlaceholder')}
              value={to}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={toError !== null}
              aria-describedby={toDescribedBy || undefined}
              onChange={(e) => onToChange(e.target.value)}
            />
            {toError && (
              <p id={toErrorId} className="field-error">
                {t(toError)}
              </p>
            )}
            {recipient && (
              <p className="field-tag">
                <KindTag recipient={recipient} id={toKindId} />
              </p>
            )}
            {!toError && addressCheck?.ok && addressCheck.kind === 'transparent' && (
              <p id={toWarnId} className="field-warn">
                {t('send.transparentWarn')}
              </p>
            )}
          </div>

          <div className="field">
            <label className="field-label" htmlFor={amountId}>
              {t('send.amount')}
            </label>
            <div className="amount-box">
              <input
                ref={amountRef}
                id={amountId}
                name="amount"
                inputMode="decimal"
                placeholder={fmt(0n)}
                value={amount}
                autoComplete="off"
                aria-invalid={amountError !== null}
                aria-describedby={amountDescribedBy}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountError(null);
                  setLinkFill((f) => f && { ...f, amount: false });
                }}
              />
              <span className="amount-unit" aria-hidden="true">
                ZEC
              </span>
              <button
                type="button"
                className="secondary amount-max"
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
            {amountError && (
              <p id={amountErrorId} className="field-error">
                {t(amountError)}
              </p>
            )}
            {typedZats !== null && (
              <p id={amountEchoId} className="field-help">
                = {fmt(typedZats)} ZEC
              </p>
            )}
            {linkFill?.amount && <p className="field-help">{t('send.uriFilled')}</p>}
            <p id={feeId} className="field-help">
              {t('send.fee', { amount: fmt(fee) })}
            </p>
          </div>

          {takesMemo === true && (
            <div className="field">
              <div className="field-head">
                <label className="field-label" htmlFor={memoId}>
                  {t('send.memo')}
                </label>
                <span
                  id={memoCountId}
                  className={memoUsed > MEMO_MAX_BYTES ? 'memo-count over' : 'memo-count'}
                  data-testid="memo-count"
                >
                  {t('send.memoCount', { used: memoUsed, max: MEMO_MAX_BYTES })}
                </span>
              </div>
              <textarea
                ref={memoRef}
                id={memoId}
                name="memo"
                className="memo"
                rows={3}
                value={memo}
                autoComplete="off"
                // Some browsers' enhanced spell check sends the text to a server.
                spellCheck={false}
                aria-invalid={memoError !== null}
                aria-describedby={[memoError && memoErrorId, memoHelpId, memoCountId].filter(Boolean).join(' ')}
                onChange={(e) => {
                  setMemo(e.target.value);
                  setMemoError(null);
                  setLinkFill((f) => f && { ...f, memo: false });
                }}
              />
              {memoError && (
                <p id={memoErrorId} className="field-error">
                  {t(memoError)}
                </p>
              )}
              <p id={memoHelpId} className="field-help with-icon">
                <Icon name="lock" />
                <span>{t('send.memoHelp')}</span>
              </p>
              {linkFill?.memo && <p className="field-help">{t('send.memoFromLink')}</p>}
            </div>
          )}
          {takesMemo === false && <p className="field-help memo-unavailable">{t('send.memoUnavailable')}</p>}

          {shieldable && (
            <Notice tone="info">
              <p>{t('send.shieldFirst', { amount: balances.fmt(transparent) })}</p>
              <button type="button" className="secondary" onClick={() => onNavigate('shield')}>
                {t('home.shieldButton')}
              </button>
            </Notice>
          )}
        </div>

        {/* A preview, never armed: no password here. Review moves on to the confirm step. */}
        <div className="card send-preview">
          <h2 className="eyebrow">
            {t('send.previewTitle')}
          </h2>
          <p className={typedZats === null ? 'preview-figure empty' : 'preview-figure'}>
            {/* --chars sizes the figure to fit its card (money.css): it never breaks or overflows. */}
            <span className="figure" style={{ '--chars': figureText.length } as CSSProperties}>
              {figureText}
            </span>{' '}
            <span className="unit">ZEC</span>
          </p>
          <dl className="preview-rows">
            <div>
              <dt>{t('send.confirmTo')}</dt>
              <dd>{recipient ? <KindTag recipient={recipient} /> : <span className="preview-none">—</span>}</dd>
            </div>
            {showMemo && (
              <div>
                <dt>{t('send.confirmMemo')}</dt>
                <dd className="preview-memo">“{memo}”</dd>
              </div>
            )}
            <div>
              <dt>{t('send.confirmFee')}</dt>
              <dd>~{fmt(fee)} ZEC</dd>
            </div>
            <div className="preview-total">
              <dt>{t('send.total')}</dt>
              <dd>{typedZats === null ? '—' : `~${fmt(typedZats + fee)} ZEC`}</dd>
            </div>
          </dl>
          <p className={`preview-privacy kind-${recipient?.privacy ?? 'unknown'}`}>
            <span className="kind-mark" aria-hidden="true" />
            <span>{t(outcomeKey(recipient))}</span>
          </p>
          <button type="submit" className="primary">
            {t('send.review')}
          </button>
          <p className="preview-note">{t('send.previewNote')}</p>
        </div>
      </form>
    </Screen>
  );
}

/**
 * A spend's details. `hero` on the confirm step: the amount large, with the
 * payment's privacy beside it, and the estimated total; the result screen
 * lists the same as rows, without a total summed from an estimate.
 */
function DraftSummary({ draft, hero = false }: { draft: Draft; hero?: boolean }) {
  const { t, lang } = useI18n();
  const fmt = (z: bigint) => formatZec(z, { locale: lang });
  const recipient = draft.recipient;
  const fee = feeFloor(draft.kind);
  const amount = fmt(draft.zats);
  const [full, setFull] = useState(false);
  const fullId = useId();
  return (
    <dl className={hero ? 'summary summary-hero' : 'summary'}>
      <div className="summary-amount">
        <dt>{t('send.confirmAmount')}</dt>
        <dd data-testid="confirm-amount">
          <span className="figure" style={{ '--chars': amount.length } as CSSProperties}>
            {amount}
          </span>{' '}
          <span className="unit">ZEC</span>
        </dd>
      </div>
      {recipient.privacy && (
        <div className="summary-privacy">
          <dt className={hero ? 'visually-hidden' : undefined}>{t('send.privacy')}</dt>
          <dd>
            <span className={`kind-tag kind-${recipient.privacy}`}>
              <span className="kind-mark" aria-hidden="true" />
              {t(PRIVACY_WORDS[recipient.privacy])}
            </span>
          </dd>
        </div>
      )}
      <div className="summary-to">
        <dt>{t('send.confirmTo')}</dt>
        <dd>
          <code className="address-short" title={draft.to}>
            {shortAddress(draft.to, 12)}
          </code>
          <span className="summary-to-meta">
            <span className="muted">{t(recipient.label)}</span>
            <button
              type="button"
              className="link small"
              aria-expanded={full}
              aria-controls={fullId}
              onClick={() => setFull((v) => !v)}
            >
              {t(full ? 'send.hideAddress' : 'send.showAddress')}
            </button>
          </span>
          <code id={fullId} className="address address-groups" hidden={!full}>
            <GroupedAddress value={draft.to} />
          </code>
        </dd>
      </div>
      {draft.memo && (
        <div className="summary-memo">
          <dt>{t('send.confirmMemo')}</dt>
          <dd data-testid="confirm-memo">{draft.memo}</dd>
        </div>
      )}
      <div>
        <dt>{t('send.confirmFee')}</dt>
        <dd>~{fmt(fee)} ZEC</dd>
      </div>
      {hero && (
        <div className="summary-total">
          <dt>{t('send.total')}</dt>
          <dd>~{fmt(draft.zats + fee)} ZEC</dd>
        </div>
      )}
    </dl>
  );
}
