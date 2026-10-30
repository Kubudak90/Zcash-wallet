import { Icon } from '../components/icons';
import { useI18n, type Lang } from '../i18n';
import { useController, useWallet } from '../state/wallet';

// English first: it is the primary language.
const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'tr', label: 'Türkçe' },
];

/** `withIcon`: a globe in front, where the switch stands on its own (Welcome, the lock screen). */
export function LanguageSwitch({ withIcon = false }: { withIcon?: boolean }) {
  const { lang, t } = useI18n();
  const controller = useController();
  const { settings } = useWallet();
  return (
    <div className="lang-switch" role="group" aria-label={t('settings.language')}>
      {withIcon && <Icon name="globe" className="lang-globe" />}
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          // Each name is in its own language, so screen readers voice it that way.
          lang={l.code}
          className={l.code === lang ? 'chip active' : 'chip'}
          aria-pressed={l.code === lang}
          onClick={() => void controller.saveSettings({ ...settings, lang: l.code })}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
