import { useI18n, type Lang } from '../i18n';
import { useController, useWallet } from '../state/wallet';

const LANGS: { code: Lang; label: string }[] = [
  { code: 'tr', label: 'Türkçe' },
  { code: 'en', label: 'English' },
];

export function LanguageSwitch() {
  const { lang, t } = useI18n();
  const controller = useController();
  const { settings } = useWallet();
  return (
    <div className="lang-switch" role="group" aria-label={t('settings.language')}>
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
