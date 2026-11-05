// 랜딩 장면(LandingScenes.tsx) 제목. 장면 안 글자는 형식 이름·숫자·기존 사전 문장만 써서 새 문장은 이것 하나다.
import type { Locale } from './locales.ts';

export const SCENE_TITLE: Record<Locale, string> = {
  en: 'What happens to your file',
  ko: '파일이 바뀌는 과정',
  es: 'Qué le pasa a tu archivo',
  pt: 'O que acontece com seu arquivo',
  de: 'Was mit deiner Datei passiert',
  fr: 'Ce qui arrive à votre fichier',
  ja: 'ファイルが変わるまで',
  hi: 'आपकी फ़ाइल के साथ क्या होता है',
  id: 'Apa yang terjadi pada file Anda',
  zh: '文件是怎样转换的',
};
