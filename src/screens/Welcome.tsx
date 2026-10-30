import { Fragment, useId } from 'react';

import { BrandLockup } from '../components/Brand';
import { Icon, type IconName } from '../components/icons';
import { useI18n } from '../i18n';
import { EngravedC } from './AccountLayout';
import { LanguageSwitch } from './LanguageSwitch';

const SOURCE_URL = 'https://github.com/Kubudak90/zcash-wallet';

/** Hyphenated words kept whole: "open-" at a line's end reads badly in a display face. */
function Unbroken({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\S+-\S+)/).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="nowrap">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** "An open-source, *privacy-first* browser wallet": the starred words are set in italic. */
function Accented({ text }: { text: string }) {
  return (
    <>
      {text.split('*').map((part, i) =>
        i % 2 === 1 ? (
          <em key={i}>
            <Unbroken text={part} />
          </em>
        ) : (
          <Unbroken key={i} text={part} />
        ),
      )}
    </>
  );
}

const PILLARS: { key: 'welcome.pillar1' | 'welcome.pillar2' | 'welcome.pillar3'; icon: IconName }[] = [
  { key: 'welcome.pillar1', icon: 'lock' },
  { key: 'welcome.pillar2', icon: 'shield' },
  { key: 'welcome.pillar3', icon: 'code' },
];

export function Welcome({ onCreate, onRestore }: { onCreate: () => void; onRestore: () => void }) {
  const { t } = useI18n();
  const ids = {
    title: useId(),
    start: useId(),
    create: useId(),
    createSub: useId(),
    steps: useId(),
    restore: useId(),
    restoreSub: useId(),
  };
  return (
    <div className="welcome">
      <section className="w-brand" aria-labelledby={ids.title}>
        <EngravedC className="w-motif" />
        <BrandLockup size={32} />
        <div className="w-statement">
          <p className="eyebrow w-eyebrow">{t('welcome.eyebrow')}</p>
          <h1 className="w-title" id={ids.title}>
            <Accented text={t('welcome.tagline')} />
          </h1>
        </div>
        <ul className="pillars">
          {PILLARS.map((p) => (
            <li key={p.key}>
              <Icon name={p.icon} />
              <span>{t(p.key)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* One language switch for every width: the tests (and screen readers) expect a single "Language" group. */}
      <div className="w-lang">
        <LanguageSwitch withIcon />
      </div>

      <section className="w-panel" aria-labelledby={ids.start}>
        <div className="w-choose">
          <h2 id={ids.start}>{t('welcome.getStarted')}</h2>
          <p className="w-lead">{t('welcome.getStartedSub')}</p>
          <div className="options">
            {/* The tile's name is its title only; the line under it and the steps describe it. */}
            <div className="option option-primary">
              <button
                type="button"
                className="option-button"
                aria-labelledby={ids.create}
                aria-describedby={`${ids.createSub} ${ids.steps}`}
                onClick={onCreate}
              >
                <span className="option-icon">
                  <Icon name="plus" />
                </span>
                <span className="option-text">
                  <span className="option-title" id={ids.create}>
                    {t('welcome.create')}
                  </span>
                  <span className="option-sub" id={ids.createSub}>
                    {t('welcome.createSub')}
                  </span>
                </span>
                <Icon name="arrowRight" className="option-arrow" />
              </button>
              <ol className="option-steps" id={ids.steps}>
                {(['create.seedTitle', 'create.verifyTitle', 'password.title'] as const).map((key, i) => (
                  <li key={key}>
                    <span className="option-step-n" aria-hidden="true">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {t(key)}
                  </li>
                ))}
              </ol>
            </div>
            <div className="option">
              <button
                type="button"
                className="option-button"
                aria-labelledby={ids.restore}
                aria-describedby={ids.restoreSub}
                onClick={onRestore}
              >
                <span className="option-icon">
                  <Icon name="key" />
                </span>
                <span className="option-text">
                  <span className="option-title" id={ids.restore}>
                    {t('welcome.restore')}
                  </span>
                  <span className="option-sub" id={ids.restoreSub}>
                    {t('welcome.restoreSub')}
                  </span>
                </span>
                <Icon name="arrowRight" className="option-arrow" />
              </button>
            </div>
          </div>
        </div>

        <footer className="w-foot">
          <span>{t('welcome.footer')}</span>
          <span className="w-foot-end">
            <span>{t('settings.version', { v: __APP_VERSION__ })}</span>
            <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
              <Icon name="code" />
              {t('settings.source')}
            </a>
          </span>
        </footer>
      </section>
    </div>
  );
}
