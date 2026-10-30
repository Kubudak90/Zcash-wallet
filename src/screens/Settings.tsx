import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { CopyButton, ErrorDetails, Notice, PasswordField, Screen, useClipboardClear } from '../components/ui';
import { useI18n } from '../i18n';
import { DEFAULT_SERVER } from '../lib/storage';
import { WrongPasswordError, type Secret } from '../lib/vault';
import { NotASeedWalletError } from '../state/controller';
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

async function seedPhraseOf(secret: Secret): Promise<string> {
  if (secret.kind !== 'seed') throw new NotASeedWalletError();
  return secret.phrase;
}

/**
 * Asks for the password, then shows a value derived from the secret. Only that
 * value is kept: the decrypted secret is dropped as soon as `derive` returns.
 */
function PasswordGate({
  label,
  derive,
  children,
}: {
  label: string;
  derive: (secret: Secret) => Promise<string>;
  children: (value: string) => ReactNode;
}) {
  const { t } = useI18n();
  const controller = useController();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const shown = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Reveal and Close each replace the button that had focus; without this it
  // would fall to <body>. The revealed value takes it, so screen readers read
  // it out, and closing returns it to the button that opened the gate.
  useEffect(() => {
    if (value !== null) shown.current?.focus();
  }, [value]);
  useEffect(() => {
    if (wasOpen.current && !open) opener.current?.focus();
    wasOpen.current = open;
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setValue(await derive(await controller.revealSecret(password)));
      setPassword('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (value !== null) {
    return (
      <div className="stack" ref={shown} tabIndex={-1}>
        {children(value)}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setValue(null);
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
      <button type="button" className="secondary" ref={opener} onClick={() => setOpen(true)}>
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

/**
 * The viewing key and its Copy button. Unlike an address it is worth keeping
 * out of the clipboard, so a copy, by the button or by hand, is cleared again
 * a minute later as far as the browser allows; the note says how far that is.
 */
function ViewingKey({ value }: { value: string }) {
  const { t } = useI18n();
  const status = useClipboardClear();
  // Only a copy made while the key is on screen gets a note, not one from before.
  const [copiedHere, setCopiedHere] = useState(false);
  useEffect(() => {
    if (status === 'pending') setCopiedHere(true);
  }, [status]);
  let note = '';
  if (copiedHere && status === 'pending') note = t('settings.clipboardClear');
  else if (copiedHere && status === 'cleared') note = t('settings.clipboardCleared');
  return (
    <>
      {/* data-clipboard-clear: a copy of this text by hand is cleared too (lib/clipboard.ts). */}
      <code className="address" data-testid="viewing-key" data-clipboard-clear="">
        {value}
      </code>
      <CopyButton value={value} clearAfter />
      {/* Mounted while empty, so the note is announced when it appears. */}
      <p className="muted small live-slot" role="status">
        {note}
      </p>
    </>
  );
}

// On a non-Turkish keyboard SİL comes out as 'SIL'; treat dotted and dotless I alike.
const confirmWord = (s: string) => s.trim().toLocaleUpperCase('tr').replace(/I/g, 'İ');

export function WipeWallet() {
  const { t } = useI18n();
  const controller = useController();
  const { meta } = useWallet();
  const [typed, setTyped] = useState('');
  const word = t('settings.wipeWord');
  return (
    <div className="stack danger">
      <p className="small">{t(meta?.kind === 'view' ? 'settings.wipeHelpView' : 'settings.wipeHelp')}</p>
      <label className="field">
        <span>{t('settings.wipeConfirm', { word })}</span>
        <input name="wipe-confirm" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
      </label>
      <button
        type="button"
        className="danger-button"
        disabled={confirmWord(typed) !== confirmWord(word)}
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
  const serverId = useId();
  const serverHelpId = useId();
  const serverErrorId = useId();
  const lockId = useId();
  const lockHelpId = useId();
  const historyHelpId = useId();
  // Shown at once; the saved settings follow once IndexedDB has them.
  const [historyEnhancement, setHistoryEnhancement] = useState(settings.historyEnhancement);

  return (
    <Screen title={t('settings.title')}>
      <section className="settings-group">
        <h2>{t('settings.language')}</h2>
        <LanguageSwitch />
      </section>

      <section className="settings-group">
        <h2 id={serverId}>{t('settings.server')}</h2>
        <p id={serverHelpId} className="muted small">
          {t('settings.serverHelp')}
        </p>
        <input
          name="server"
          value={server}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-labelledby={serverId}
          aria-describedby={serverValid ? serverHelpId : `${serverErrorId} ${serverHelpId}`}
          aria-invalid={!serverValid}
          onChange={(e) => setServer(e.target.value)}
        />
        {!serverValid && (
          <p id={serverErrorId} className="field-error">
            {t('settings.serverInvalid')}
          </p>
        )}
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
        <h2>{t('settings.privacy')}</h2>
        <label className="check">
          <input
            type="checkbox"
            name="history-enhancement"
            checked={historyEnhancement}
            aria-describedby={historyHelpId}
            onChange={(e) => {
              setHistoryEnhancement(e.target.checked);
              void controller.saveSettings({ ...settings, historyEnhancement: e.target.checked });
            }}
          />
          {t('settings.historyEnhancement')}
        </label>
        <p id={historyHelpId} className="muted small">
          {t('settings.historyEnhancementHelp')}
        </p>
      </section>

      <section className="settings-group">
        <h2 id={lockId}>{t('settings.autoLock')}</h2>
        <select
          name="auto-lock"
          aria-labelledby={lockId}
          aria-describedby={lockHelpId}
          value={settings.autoLockMinutes}
          onChange={(e) => void controller.saveSettings({ ...settings, autoLockMinutes: Number(e.target.value) })}
        >
          {AUTO_LOCK_CHOICES.map((n) => (
            <option key={n} value={n}>
              {t('settings.minutes', { n })}
            </option>
          ))}
        </select>
        <p id={lockHelpId} className="muted small">
          {t('settings.autoLockHidden')}
        </p>
      </section>

      <section className="settings-group">
        <h2>{t('settings.security')}</h2>
        <PasswordGate label={t('settings.showViewingKey')} derive={(secret) => controller.viewingKeyFor(secret)}>
          {(key) => <ViewingKey value={key} />}
        </PasswordGate>
        {/* Right under its own button, so it is not read as being about the recovery phrase. */}
        <p className="muted small">{t('settings.viewingKeyHelp')}</p>
        {meta?.kind === 'seed' && (
          <PasswordGate label={t('settings.showSeed')} derive={seedPhraseOf}>
            {(phrase) => (
              <>
                <Notice tone="warn">
                  <ul className="plain">
                    <li>{t('create.seedWarn1')}</li>
                    <li>{t('create.seedWarn2')}</li>
                    <li>{t('create.seedWarn3')}</li>
                  </ul>
                </Notice>
                <SeedGrid phrase={phrase} />
              </>
            )}
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
        <p className="small">
          {/* The licence notices of the Rust crates in the wasm engine (scripts/gen-licenses.sh). */}
          <a href={`${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt`} target="_blank" rel="noreferrer noopener">
            {t('settings.licenses')}
          </a>
        </p>
        <p className="small">
          {/* The typefaces' SIL OFL notices, which must go with the font files (public/FONT_LICENSES.txt). */}
          <a href={`${import.meta.env.BASE_URL}FONT_LICENSES.txt`} target="_blank" rel="noreferrer noopener">
            {t('settings.fontLicenses')}
          </a>
        </p>
      </section>
    </Screen>
  );
}
