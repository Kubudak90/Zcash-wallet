import { createContext, useCallback, useContext, type ReactNode } from 'react';

import { en } from './en';
import { tr, type MessageKey } from './tr';

export type Lang = 'tr' | 'en';
export type { MessageKey };

const dictionaries: Record<Lang, Record<MessageKey, string>> = { tr, en };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = dictionaries[lang][key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

const LangContext = createContext<Lang>('tr');

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useI18n(): { lang: Lang; t: Translate } {
  const lang = useContext(LangContext);
  const t = useCallback<Translate>((key, vars) => translate(lang, key, vars), [lang]);
  return { lang, t };
}
