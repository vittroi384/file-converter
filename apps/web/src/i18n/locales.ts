// 언어 코드만(사전은 따로) — 빌드 스크립트·nginx 설정 생성에서도 가볍게 쓴다. QR 사이트(GetQRMaker)와 같은 구성.
export const LOCALES = ['en', 'ko', 'es', 'pt', 'de', 'fr', 'ja', 'hi', 'id', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_NAMES: Record<Locale, { short: string; full: string; htmlLang: string }> = {
  en: { short: 'EN', full: 'English', htmlLang: 'en' },
  ko: { short: 'KO', full: '한국어', htmlLang: 'ko' },
  es: { short: 'ES', full: 'Español', htmlLang: 'es' },
  pt: { short: 'PT', full: 'Português', htmlLang: 'pt' },
  de: { short: 'DE', full: 'Deutsch', htmlLang: 'de' },
  fr: { short: 'FR', full: 'Français', htmlLang: 'fr' },
  ja: { short: 'JA', full: '日本語', htmlLang: 'ja' },
  hi: { short: 'HI', full: 'हिन्दी', htmlLang: 'hi' },
  id: { short: 'ID', full: 'Bahasa Indonesia', htmlLang: 'id' },
  zh: { short: 'ZH', full: '中文（简体）', htmlLang: 'zh-Hans' },
};

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

// "/ko/heic-to-jpg" → { locale: 'ko', slug: 'heic-to-jpg' }, "/" → { locale: 'en', slug: '' }
export function parsePath(pathname: string): { locale: Locale; slug: string } {
  const parts = pathname.split('/').filter(Boolean);
  const locale = isLocale(parts[0]) && parts[0] !== DEFAULT_LOCALE ? parts[0] : DEFAULT_LOCALE;
  const rest = locale === DEFAULT_LOCALE ? parts : parts.slice(1);
  return { locale, slug: rest[0] ?? '' };
}

export function localePath(locale: Locale, slug = ''): string {
  const base = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  return `${base}/${slug}`.replace(/\/$/, '') || '/';
}

// Accept-Language → 지원 언어(지역 태그는 언어로: pt-BR → pt, zh-TW → zh). 하나도 없으면 영어.
export function preferredLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage.split(',').map(part => {
    const [tag = '', ...params] = part.trim().split(';');
    const q = Number(params.find(p => p.trim().startsWith('q='))?.split('=')[1] ?? 1);
    return { lang: tag.toLowerCase().split('-')[0]!, q: isFinite(q) ? q : 0 };
  }).filter(x => x.q > 0).sort((a, b) => b.q - a.q);
  return (ranked.find(r => isLocale(r.lang))?.lang as Locale | undefined) ?? DEFAULT_LOCALE;
}

export const LANG_COOKIE = 'lc_lang';
