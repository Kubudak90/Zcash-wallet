import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { CopyButton, ErrorDetails, Notice, PasswordField, Screen } from '../components/ui';
import { useI18n } from '../i18n';
import { DEFAULT_SERVER } from '../lib/storage';
import { WrongPasswordError, type Secret } from '../lib/vault';
import { useController, useWallet } from '../state/wallet';
import { SeedGrid } from './CreateWallet';
import { LanguageSwitch } from './LanguageSwitch';

const AUTO_LOCK_CHOICES = [5, 15, 30, 60];
const SOURCE_URL = 'https://github.com/Kubudak90/zcash-wallet';

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Asks for the password, then shows something derived from the secret. */
function PasswordGate({ label, children }: { label: string; children: (secret: Secret) => ReactNode }) {
  const { t } = useI18n();
  const controller = useController();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState<Secret | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setSecret(await controller.revealSecret(password));
      setPassword('');
    } catch (err) {
      setError(err);
    }
  }

  if (secret) {
    return (
      <div className="stack">
        {children(secret)}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setSecret(null);
            setOpen(false);
          }}
        >
          {t('common.close')}
        </button>
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <form className="stack" onSubmit={submit}>
      <PasswordField label={t('common.password')} value={password} onChange={setPassword} autoFocus />
      {error instanceof WrongPasswordError && <Notice tone="error">{t('unlock.wrongPassword')}</Notice>}
      {error != null && !(error instanceof WrongPasswordError) && <ErrorDetails error={error} />}
      <div className="row">
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="primary" disabled={!password}>
          {t('settings.reveal')}
        </button>
      </div>
    </form>
  );
}

function ViewingKey({ secret }: { secret: Secret }) {
  const controller = useController();
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    controller
      .viewingKeyFor(secret)
      .then((k) => !cancelled && setKey(k))
      .catch((e: unknown) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [controller, secret]);
  if (error) return <ErrorDetails error={error} />;
  if (!key) return <p className="muted">…</p>;
  return (
    <>
      <code className="address" data-testid="viewing-key">
        {key}
      </code>
      <CopyButton value={key} />
    </>
  );
}

export function WipeWallet() {
  const { t } = useI18n();
  const controller = useController();
  const [typed, setTyped] = useState('');
  const word = t('settings.wipeWord');
  return (
    <div className="stack danger">
      <p className="small">{t('settings.wipeHelp')}</p>
      <label className="field">
        <span>{t('settings.wipeConfirm', { word })}</span>
        <input name="wipe-confirm" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
      </label>
      <button
        type="button"
        className="danger-button"
        disabled={typed.trim().toLocaleUpperCase('tr') !== word.toLocaleUpperCase('tr')}
        onClick={() => void controller.wipe()}
      >
        {t('settings.wipe')}
      </button>
    </div>
  );
}

export function Settings() {
  const { t } = useI18n();
  const controller = useController();
  const { settings, meta } = useWallet();
  const [server, setServer] = useState(settings.serverUrl);
  const serverValid = isHttpsUrl(server);

  return (
    <Screen title={t('settings.title')}>
      <section className="settings-group">
        <h2>{t('settings.language')}</h2>
        <LanguageSwitch />
      </section>

      <section className="settings-group">
        <h2>{t('settings.server')}</h2>
        <p className="muted small">{t('settings.serverHelp')}</p>
        <input
          name="server"
          value={server}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setServer(e.target.value)}
        />
        {!serverValid && <p className="field-error">{t('settings.serverInvalid')}</p>}
        <div className="row">
          <button type="button" className="secondary" onClick={() => setServer(DEFAULT_SERVER)}>
            {t('settings.serverReset')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!serverValid || server === settings.serverUrl}
            onClick={() => void controller.saveSettings({ ...settings, serverUrl: server.trim() }, { restart: true })}
          >
            {t('settings.serverSave')}
          </button>
        </div>
      </section>

      <section className="settings-group">
        <h2>{t('settings.autoLock')}</h2>
        <select
          name="auto-lock"
          value={settings.autoLockMinutes}
          onChange={(e) => void controller.saveSettings({ ...settings, autoLockMinutes: Number(e.target.value) })}
        >
          {AUTO_LOCK_CHOICES.map((n) => (
            <option key={n} value={n}>
              {t('settings.minutes', { n })}
            </option>
          ))}
        </select>
      </section>

      <section className="settings-group">
        <h2>{t('settings.security')}</h2>
        <p className="muted small">{t('settings.viewingKeyHelp')}</p>
        <PasswordGate label={t('settings.showViewingKey')}>{(secret) => <ViewingKey secret={secret} />}</PasswordGate>
        {meta?.kind === 'seed' && (
          <PasswordGate label={t('settings.showSeed')}>
            {(secret) => (secret.kind === 'seed' ? <SeedGrid phrase={secret.phrase} /> : null)}
          </PasswordGate>
        )}
      </section>

      <section className="settings-group">
        <h2>{t('settings.danger')}</h2>
        <WipeWallet />
      </section>

      <section className="settings-group">
        <h2>{t('settings.about')}</h2>
        <p className="muted small">{t('settings.aboutText')}</p>
        <p className="small">
          <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
            {t('settings.source')}
          </a>{' '}
          · {t('settings.version', { v: __APP_VERSION__ })}
        </p>
      </section>
    </Screen>
  );
}
