// 서버(SSG·SSR) 전용: 10개 언어 사전과 랜딩 틀을 모두 가진다. 브라우저 묶음에 넣지 말 것(context.ts의 loadDict를 쓴다).
import type { Locale } from './locales.ts';
import type { Dict } from './types.ts';
import type { LandingTemplates } from './landings.ts';
import { en } from './en.ts';
import { ko } from './ko.ts';
import { landingEn } from './landing.en.ts';
import { landingKo } from './landing.ko.ts';
import { DICTS_EXTRA, LANDINGS_EXTRA } from './extra.ts';

export * from './locales.ts';
export type { Dict } from './types.ts';

const DICTS: Record<Locale, Dict> = { en, ko, ...DICTS_EXTRA };
const LANDING_T: Record<Locale, LandingTemplates> = { en: landingEn, ko: landingKo, ...LANDINGS_EXTRA };

export const getDict = (l: Locale) => DICTS[l];
export const getLandingT = (l: Locale) => LANDING_T[l];

