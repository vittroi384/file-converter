// 브라우저·서버 공용: 지금 언어와 사전을 담는 React 문맥 + 언어 하나만 불러오기
import { createContext, useContext } from 'react';
import type { Locale } from './locales.ts';
import type { Dict } from './types.ts';

export const I18n = createContext<{ locale: Locale; t: Dict } | null>(null);
export function useI18n() {
  const v = useContext(I18n);
  if (!v) throw new Error('I18n 문맥 없음');
  return v;
}

// 언어마다 따로 쪼개진 묶음으로 받는다(10개 언어를 첫 화면에 다 싣지 않게)
const LOADERS: Record<Locale, () => Promise<Dict>> = {
  en: () => import('./en.ts').then(m => m.en),
  ko: () => import('./ko.ts').then(m => m.ko),
  es: () => import('./lang/es.ts').then(m => m.dict),
  pt: () => import('./lang/pt.ts').then(m => m.dict),
  de: () => import('./lang/de.ts').then(m => m.dict),
  fr: () => import('./lang/fr.ts').then(m => m.dict),
  ja: () => import('./lang/ja.ts').then(m => m.dict),
  hi: () => import('./lang/hi.ts').then(m => m.dict),
  id: () => import('./lang/id.ts').then(m => m.dict),
  zh: () => import('./lang/zh.ts').then(m => m.dict),
};
export const loadDict = (l: Locale) => LOADERS[l]();
