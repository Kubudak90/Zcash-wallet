import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Icon, type IconName } from '../components/icons';
import { CopyButton, ErrorDetails, Notice, PasswordField, Screen, useClipboardClear } from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';
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
  describedBy,
  derive,
  children,
}: {
  label: string;
  /** id of the text that says what the gate shows */
  describedBy?: string;
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

  // Closed, the button sits at the end of its row; open, the form or the value spans the row.
  if (value !== null) {
    return (
      <div className="stack gate-panel" ref={shown} tabIndex={-1}>
        {children(value)}
        <button
          type="button"
          className="secondary gate-close"
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
      <button
        type="button"
        className="secondary gate-open"
        ref={opener}
        aria-describedby={describedBy}
        onClick={() => setOpen(true)}
      >
        <Icon name="lock" />
        {label}
      </button>
    );
  }
  return (
    <form className="stack gate-panel" onSubmit={submit}>
      <PasswordField label={t('common.password')} value={password} onChange={setPassword} autoFocus />
      {error instanceof WrongPasswordError && <Notice tone="error">{t('unlock.wrongPassword')}</Notice>}
      {error != null && !(error instanceof WrongPasswordError) && <ErrorDetails error={error} />}
      <div className="row gate-actions">
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

/** Removing the wallet: Settings' danger zone, and behind "I forgot my password" on the lock screen. */
export function WipeWallet() {
  const { t } = useI18n();
  const controller = useController();
  const { meta } = useWallet();
  const [typed, setTyped] = useState('');
  const word = t('settings.wipeWord');
  return (
    <div className="stack wipe">
      <p className="wipe-help">
        <Icon name="alert" />
        <span>{t(meta?.kind === 'view' ? 'settings.wipeHelpView' : 'settings.wipeHelp')}</span>
      </p>
      <div className="wipe-row">
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
          <Icon name="trash" />
          {t('settings.wipe')}
        </button>
      </div>
    </div>
  );
}

type SectionId = 'general' | 'security' | 'privacy' | 'server' | 'about' | 'danger';

// Auto-lock (last in General) and "Show viewing key" (first in Security) stay
// next to each other in the tab order (tests/e2e/a11y.spec.ts).
const SECTIONS: { id: SectionId; title: MessageKey; index: MessageKey; icon: IconName }[] = [
  { id: 'general', title: 'settings.general', index: 'settings.general', icon: 'settings' },
  { id: 'security', title: 'settings.security', index: 'settings.security', icon: 'key' },
  { id: 'privacy', title: 'settings.privacy', index: 'settings.privacy', icon: 'shield' },
  { id: 'server', title: 'settings.server', index: 'settings.serverShort', icon: 'server' },
  { id: 'about', title: 'settings.about', index: 'settings.about', icon: 'info' },
  { id: 'danger', title: 'settings.danger', index: 'settings.danger', icon: 'alert' },
];

const anchor = (id: SectionId) => `settings-${id}`;

/**
 * The section being read, for the index: the last one whose top has passed the
 * upper third of the window, or the last of all once the page is scrolled to its end.
 */
function useSectionInView(): SectionId {
  const [current, setCurrent] = useState<SectionId>('general');
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      let found: SectionId = 'general';
      for (const s of SECTIONS) {
        const el = document.getElementById(anchor(s.id));
        if (el && el.getBoundingClientRect().top <= line) found = s.id;
      }
      const atEnd =
        window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      setCurrent(atEnd ? 'danger' : found);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);
  return current;
}

/** A section of Settings: its heading, then a card of rows. The heading stays inside .settings-group. */
function Group({
  id,
  headingId,
  className,
  children,
}: {
  id: SectionId;
  headingId?: string;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const section = SECTIONS.find((s) => s.id === id)!;
  return (
    <section className={`settings-group settings-${id}`} id={anchor(id)}>
      <h2 id={headingId}>
        <Icon name={section.icon} />
        {t(section.title)}
      </h2>
      <div className={className ? `settings-card ${className}` : 'settings-card'}>{children}</div>
    </section>
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
  const historyId = useId();
  const historyHelpId = useId();
  const viewingKeyHelpId = useId();
  const seedHelpId = useId();
  const current = useSectionInView();
  // Shown at once; the saved settings follow once IndexedDB has them.
  const [historyEnhancement, setHistoryEnhancement] = useState(settings.historyEnhancement);

  return (
    <Screen title={t('settings.title')}>
      <div className="settings-layout">
        <nav className="settings-index" aria-label={t('settings.sections')}>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${anchor(s.id)}`}
              className={s.id === 'danger' ? 'index-danger' : undefined}
              aria-current={current === s.id ? 'true' : undefined}
            >
              {t(s.index)}
            </a>
          ))}
        </nav>

        <div className="settings-sections">
          <Group id="general">
            <div className="set-row">
              <div className="set-text">
                <p className="set-label">{t('settings.language')}</p>
              </div>
              <div className="set-control">
                <LanguageSwitch />
              </div>
            </div>
            <div className="set-row">
              <div className="set-text">
                <p className="set-label" id={lockId}>
                  {t('settings.autoLock')}
                </p>
                <p id={lockHelpId} className="set-help">
                  {t('settings.autoLockHelp')}
                </p>
              </div>
              <div className="set-control">
                <select
                  name="auto-lock"
                  aria-labelledby={lockId}
                  aria-describedby={lockHelpId}
                  value={settings.autoLockMinutes}
                  onChange={(e) =>
                    void controller.saveSettings({ ...settings, autoLockMinutes: Number(e.target.value) })
                  }
                >
                  {AUTO_LOCK_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {t('settings.minutesShort', { n })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Group>

          <Group id="security">
            <div className="set-row">
              <div className="set-text">
                <p className="set-label">{t('settings.viewingKey')}</p>
                {/* In the key's own row and tied to its button: not read as being about the recovery phrase. */}
                <p className="set-help" id={viewingKeyHelpId}>
                  {t('settings.viewingKeyHelp')}
                </p>
              </div>
              <PasswordGate
                label={t('settings.showViewingKey')}
                describedBy={viewingKeyHelpId}
                derive={(secret) => controller.viewingKeyFor(secret)}
              >
                {(key) => <ViewingKey value={key} />}
              </PasswordGate>
            </div>
            {meta?.kind === 'seed' && (
              <div className="set-row">
                <div className="set-text">
                  <p className="set-label">{t('settings.seed')}</p>
                  <p className="set-help" id={seedHelpId}>
                    {t('settings.seedHelp')}
                  </p>
                </div>
                <PasswordGate label={t('settings.showSeed')} describedBy={seedHelpId} derive={seedPhraseOf}>
                  {(phrase) => (
                    <>
                      <Notice tone="warn">
                        <ul className="plain">
                          <li>{t('create.seedWarn1')}</li>
                          <li>{t('create.seedWarn2')}</li>
                          <li>{t('create.seedWarn3')}</li>
                        </ul>
                      </Notice>
                      <div className="seed-holder">
                        <SeedGrid phrase={phrase} />
                      </div>
                    </>
                  )}
                </PasswordGate>
              </div>
            )}
          </Group>

          <Group id="privacy">
            <div className="set-row">
              <div className="set-text">
                <label className="set-label" htmlFor={historyId}>
                  {t('settings.historyEnhancement')}
                </label>
                <p id={historyHelpId} className="set-help">
                  {t('settings.historyEnhancementHelp')}
                </p>
              </div>
              <div className="set-control">
                {/* A checkbox drawn as a switch: it keeps the checkbox role and name. */}
                <input
                  id={historyId}
                  type="checkbox"
                  className="switch"
                  name="history-enhancement"
                  checked={historyEnhancement}
                  aria-describedby={historyHelpId}
                  onChange={(e) => {
                    setHistoryEnhancement(e.target.checked);
                    void controller.saveSettings({ ...settings, historyEnhancement: e.target.checked });
                  }}
                />
              </div>
            </div>
          </Group>

          <Group id="server" headingId={serverId}>
            <div className="set-row set-row-stack">
              <div className="server-row">
                <input
                  name="server"
                  className="mono"
                  value={server}
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  aria-labelledby={serverId}
                  aria-describedby={serverValid ? serverHelpId : `${serverErrorId} ${serverHelpId}`}
                  aria-invalid={!serverValid}
                  onChange={(e) => setServer(e.target.value)}
                />
                <button type="button" className="secondary quiet" onClick={() => setServer(DEFAULT_SERVER)}>
                  {t('settings.serverReset')}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!serverValid || server === settings.serverUrl}
                  onClick={() =>
                    void controller.saveSettings({ ...settings, serverUrl: server.trim() }, { restart: true })
                  }
                >
                  {t('settings.serverSave')}
                </button>
              </div>
              {!serverValid && (
                <p id={serverErrorId} className="field-error">
                  {t('settings.serverInvalid')}
                </p>
              )}
              <p id={serverHelpId} className="set-help">
                {t('settings.serverHelp')}
              </p>
            </div>
          </Group>

          <Group id="about">
            <div className="set-row set-row-stack">
              <p className="about-text">{t('settings.aboutText')}</p>
              <div className="about-links">
                <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
                  <Icon name="code" />
                  {t('settings.source')}
                </a>
                {/* The licence notices of the Rust crates in the wasm engine (scripts/gen-licenses.sh). */}
                <a
                  href={`${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Icon name="external" />
                  {t('settings.licenses')}
                </a>
                {/* The typefaces' SIL OFL notices, which must go with the font files (public/FONT_LICENSES.txt). */}
                <a href={`${import.meta.env.BASE_URL}FONT_LICENSES.txt`} target="_blank" rel="noreferrer noopener">
                  <Icon name="external" />
                  {t('settings.fontLicenses')}
                </a>
                <span className="about-version">{t('settings.version', { v: __APP_VERSION__ })}</span>
              </div>
            </div>
          </Group>

          <Group id="danger" className="danger-card">
            <div className="set-row set-row-stack">
              <WipeWallet />
            </div>
          </Group>
        </div>
      </div>
    </Screen>
  );
}
