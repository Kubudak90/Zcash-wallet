import { createContext, useCallback, useContext, type ReactNode } from 'react';

import { en, type MessageKey } from './en';
import { tr } from './tr';

export type Lang = 'en' | 'tr';
export type { MessageKey };

const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, tr };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = dictionaries[lang][key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

const LangContext = createContext<Lang>('en');

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useI18n(): { lang: Lang; t: Translate } {
  const lang = useContext(LangContext);
  const t = useCallback<Translate>((key, vars) => translate(lang, key, vars), [lang]);
  return { lang, t };
}
