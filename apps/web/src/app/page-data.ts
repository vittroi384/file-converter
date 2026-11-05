// 서버가 HTML과 함께 넘기는 페이지 데이터(실행되지 않는 JSON 블록). 브라우저는 이걸로 같은 화면을 이어받는다.
import type { Locale } from '../i18n/locales.ts';
import type { ActionId, LandingCopy } from '../i18n/types.ts';

export interface ToolLink { slug: string; title: string; group: 'image' | 'pdf' | 'data'; from?: string; to?: string }
export interface LandingData {
  slug: string; action: ActionId; preset: Record<string, string>; accept: string;
  copy: LandingCopy; related: ToolLink[]; from?: string; to?: string;
}
export interface DemoData {
  before: { src: string; bytes: number; fmt: string; width: number; height: number };
  after: { src: string; bytes: number; fmt: string; ssim: number; q: number; tries: number };
  target?: number;
  probes?: { q: number; ssim: number; bytes: number }[]; // 탐색이 실제로 시도한 순서
  curve?: { q: number; ssim: number; bytes: number }[]; // 품질별 실측(그림 배경)
}
export interface PageData {
  locale: Locale;
  kind: 'home' | 'landing' | 'admin' | 'notfound';
  path: string;
  landing?: LandingData;
  tools: ToolLink[]; // 메뉴·첫 화면 도구 목록(현지화된 제목)
  demo?: DemoData;
}

export const DATA_ID = 'lc-data';
