// en·ko 외 8개 언어: 화면 사전 + 공통 조립기로 만든 랜딩 틀
import type { Locale } from './locales.ts';
import type { Dict } from './types.ts';
import type { LandingTemplates } from './landings.ts';
import { fromPack } from './landing.generic.ts';
import * as es from './lang/es.ts';
import * as pt from './lang/pt.ts';
import * as de from './lang/de.ts';
import * as fr from './lang/fr.ts';
import * as ja from './lang/ja.ts';
import * as hi from './lang/hi.ts';
import * as id from './lang/id.ts';
import * as zh from './lang/zh.ts';

type Rest = Exclude<Locale, 'en' | 'ko'>;
const ALL = { es, pt, de, fr, ja, hi, id, zh } satisfies Record<Rest, { dict: Dict; pack: Parameters<typeof fromPack>[0] }>;

export const DICTS_EXTRA = Object.fromEntries(Object.entries(ALL).map(([k, v]) => [k, v.dict])) as Record<Rest, Dict>;
export const LANDINGS_EXTRA = Object.fromEntries(Object.entries(ALL).map(([k, v]) => [k, fromPack(v.pack)])) as Record<Rest, LandingTemplates>;
