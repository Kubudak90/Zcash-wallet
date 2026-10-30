import { forwardRef, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import QRCode from 'qrcode';

import { useI18n, type Lang } from '../i18n';
import { clipboard, type ClearStatus } from '../lib/clipboard';
import { passwordStrength, type PasswordStrength } from '../lib/vault';
import { formatZec } from '../lib/zec';
import { useController, useWallet } from '../state/wallet';
import { Icon, type IconName } from './icons';

/** Shown in place of an amount while balances are hidden. */
export const HIDDEN_AMOUNT = '••••';

/**
 * The "hide balances" setting. `fmt` formats an amount for running text (a
 * translated sentence), or gives HIDDEN_AMOUNT while balances are hidden.
 * Use it, or <Amount>, for balances and history only: where a spend is
 * confirmed or its result shown, the real amount always shows.
 */
export function useHideBalances(): { hidden: boolean; fmt: (zats: bigint) => string; toggle: () => void } {
  const { lang } = useI18n();
  const controller = useController();
  const { settings } = useWallet();
  const hidden = settings.hideBalances;
  return {
    hidden,
    fmt: (zats) => (hidden ? HIDDEN_AMOUNT : formatZec(zats, { locale: lang })),
    toggle: () => void controller.saveSettings({ ...settings, hideBalances: !hidden }),
  };
}

/**
 * An amount in ZEC, without the unit, masked while balances are hidden;
 * screen readers then hear "amount hidden" rather than the dots. `signed`
 * adds "+" to incoming amounts (formatZec writes the minus) and keeps the
 * sign when masked: a history row says Sent or Received anyway.
 */
export function Amount({ zats, signed = false }: { zats: bigint; signed?: boolean }) {
  const { t } = useI18n();
  const { hidden, fmt } = useHideBalances();
  const sign = signed && zats > 0n ? '+' : signed && hidden && zats < 0n ? '-' : '';
  if (!hidden) return <>{sign + fmt(zats)}</>;
  return (
    <>
      <span aria-hidden="true">{sign + HIDDEN_AMOUNT}</span>
      <span className="visually-hidden">{t('common.amountHidden')}</span>
    </>
  );
}

/**
 * <Amount> split for typesetting, with the same text and the same masking:
 * a sign slot, the whole part and the fraction (separator included) in their
 * own spans, so a list can line the decimal points up and a figure can dim the
 * fraction. Masked, it is exactly what <Amount> shows.
 */
export function AmountParts({ zats, signed = false }: { zats: bigint; signed?: boolean }) {
  const { t, lang } = useI18n();
  const { hidden } = useHideBalances();
  if (hidden) {
    const sign = signed && zats > 0n ? '+' : signed && zats < 0n ? '-' : '';
    return (
      <>
        <span aria-hidden="true">{sign + HIDDEN_AMOUNT}</span>
        <span className="visually-hidden">{t('common.amountHidden')}</span>
      </>
    );
  }
  const sign = zats < 0n ? '-' : signed && zats > 0n ? '+' : '';
  const digits = formatZec(zats < 0n ? -zats : zats, { locale: lang });
  const point = digits.indexOf(lang === 'tr' ? ',' : '.');
  return (
    <>
      <span className="amt-sign">{sign}</span>
      <span className="amt-int">{point < 0 ? digits : digits.slice(0, point)}</span>
      <span className="amt-frac">{point < 0 ? '' : digits.slice(point)}</span>
    </>
  );
}

export function Screen({
  title,
  subtitle,
  children,
  onBack,
}: {
  title?: string;
  /** A line under the title, part of the header. */
  subtitle?: ReactNode;
  children: ReactNode;
  onBack?: () => void;
}) {
  const { t, lang } = useI18n();
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef<{ title?: string; lang: Lang } | null>(null);

  // When a screen or step replaces the control that had focus, focus would
  // fall to <body> and screen readers would land nowhere; move it to the new
  // heading instead. Focus that is still somewhere useful stays put: a tab
  // button after a tab switch, or a field the new step focused itself.
  useEffect(() => {
    const prev = shown.current;
    shown.current = { title, lang };
    if (prev && (prev.title === title || prev.lang !== lang)) return;
    const active = document.activeElement;
    const keep = prev
      ? active?.matches('input, textarea, select') && section.current?.contains(active)
      : active && active !== document.body;
    if (!keep) heading.current?.focus();
  }, [title, lang]);

  return (
    <section className="screen" ref={section}>
      {(title || onBack) && (
        <header className="screen-head">
          {onBack && (
            <button type="button" className="back" onClick={onBack}>
              <Icon name="arrowLeft" />
              {t('common.back')}
            </button>
          )}
          {title && (
            <h1 tabIndex={-1} ref={heading}>
              {title}
            </h1>
          )}
          {subtitle && <p className="screen-sub">{subtitle}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

const NOTICE_ICON: Record<'info' | 'warn' | 'error' | 'ok', IconName> = {
  info: 'info',
  warn: 'alert',
  error: 'error',
  ok: 'okCircle',
};

/**
 * A calm card with a mark in its tone. `live={false}` inside a live region of
 * its own, so the two are not announced twice.
 */
export function Notice({
  tone = 'info',
  live = true,
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'ok';
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`} role={live ? (tone === 'error' ? 'alert' : 'status') : undefined}>
      <Icon name={NOTICE_ICON[tone]} className="notice-icon" />
      <div className="notice-body">{children}</div>
    </div>
  );
}

/**
 * Copies `value`. Every copy goes through `clipboard`, so a pending clear of
 * an earlier copy knows the clipboard now holds something else. `clearAfter`
 * clears the clipboard again a minute later, as far as the browser allows
 * (see lib/clipboard.ts); only the viewing key asks for that.
 */
export function CopyButton({ value, label, clearAfter = false }: { value: string; label?: string; clearAfter?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <>
      <button
        type="button"
        className="secondary copy-button"
        onClick={() => {
          void clipboard.copy(value, { clearAfter }).then(
            () => setCopied(true),
            (e) => console.warn('copy failed', e),
          );
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} />
        {copied ? t('common.copied') : (label ?? t('common.copy'))}
      </button>
      {/* Screen readers rarely re-read a focused button whose name changed. */}
      <span role="status" className="visually-hidden">
        {copied ? t('common.copied') : ''}
      </span>
    </>
  );
}

/** Where the clipboard clear asked for by CopyButton's `clearAfter` stands. */
export function useClipboardClear(): ClearStatus {
  return useSyncExternalStore(clipboard.subscribe, clipboard.getStatus);
}

export function QrCode({ value, label }: { value: string; label: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((s) => {
      if (!cancelled) setSvg(s);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  // The SVG comes from the qrcode library, not from user input.
  return <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export const PasswordField = forwardRef<
  HTMLInputElement,
  {
    label: string;
    value: string;
    onChange: (v: string) => void;
    autoFocus?: boolean;
    autoComplete?: string;
    name?: string;
    invalid?: boolean;
    /** id of the error or hint that describes the field */
    describedBy?: string;
  }
>(function PasswordField(
  { label, value, onChange, autoFocus, autoComplete = 'current-password', name, invalid, describedBy },
  ref,
) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        ref={ref}
        type="password"
        name={name}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
});

export function StrengthMeter({ password }: { password: string }) {
  const { t } = useI18n();
  if (!password) return null;
  const strength: PasswordStrength = passwordStrength(password);
  return (
    <div className={`strength strength-${strength}`} aria-live="polite">
      <div className="strength-bar">
        <span />
      </div>
      {t(`password.strength.${strength}`)}
    </div>
  );
}

export function ErrorDetails({ error }: { error: unknown }) {
  const { t } = useI18n();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <details className="error-details">
      <summary>{t('common.details')}</summary>
      <code>{message}</code>
    </details>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
