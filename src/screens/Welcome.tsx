import { useI18n } from '../i18n';
import { LanguageSwitch } from './LanguageSwitch';

export function Welcome({ onCreate, onRestore }: { onCreate: () => void; onRestore: () => void }) {
  const { t } = useI18n();
  return (
    <section className="screen welcome">
      <div className="welcome-top">
        <LanguageSwitch />
      </div>
      <img src="/celari.svg" alt="" width={72} height={72} className="logo" />
      <h1 className="brand">Celari</h1>
      <p className="tagline">{t('welcome.tagline')}</p>
      <ul className="pillars">
        <li>{t('welcome.pillar1')}</li>
        <li>{t('welcome.pillar2')}</li>
        <li>{t('welcome.pillar3')}</li>
      </ul>
      <div className="stack">
        <button type="button" className="primary" onClick={onCreate}>
          {t('welcome.create')}
        </button>
        <button type="button" className="secondary" onClick={onRestore}>
          {t('welcome.restore')}
        </button>
      </div>
    </section>
  );
}
