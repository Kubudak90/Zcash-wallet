import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';

import { useI18n } from '../i18n';
import { passwordStrength, type PasswordStrength } from '../lib/vault';

export function Screen({ title, children, onBack }: { title?: string; children: ReactNode; onBack?: () => void }) {
  const { t } = useI18n();
  return (
    <section className="screen">
      {(title || onBack) && (
        <header className="screen-head">
          {onBack && (
            <button type="button" className="link back" onClick={onBack}>
              ← {t('common.back')}
            </button>
          )}
          {title && <h1>{title}</h1>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
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
        className="secondary"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => setCopied(true));
        }}
      >
        {copied ? t('common.copied') : (label ?? t('common.copy'))}
      </button>
      {/* Screen readers rarely re-read a focused button whose name changed. */}
      <span role="status" className="visually-hidden">
        {copied ? t('common.copied') : ''}
      </span>
    </>
  );
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

export function PasswordField({
  label,
  value,
  onChange,
  autoFocus,
  autoComplete = 'current-password',
  name,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
  name?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="password"
        name={name}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

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
