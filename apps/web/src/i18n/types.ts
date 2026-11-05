// 언어별 사전의 모양. 한 언어라도 빠지면 타입 검사에서 걸린다.
import type { ErrorCode } from '@fc/shared';

export type ActionId = 'convert' | 'compress' | 'image-to-pdf' | 'pdf-merge' | 'pdf-compress' | 'pdf-to-image' | 'pdf-split' | 'data' | 'ocr' | 'video';

export interface Dict {
  site: { name: string; tagline: string; description: string };
  nav: { tools: string; privacy: string; language: string; command: string; theme: string; admin: string; skip: string };
  hero: { kicker: string; title: string; sub: string; drop: string; dropHint: string; dropOver: string; demoCaption: string; before: string; after: string };
  history: { title: string; empty: string; note: (days: number) => string; download: string; remove: string; clear: string; keep: string };
  scenes: {
    popular: string; // 첫 화면 '자주 쓰는 변환' 줄
    search: { title: string; sub: string; quality: string; target: string; size: string; steps: [string, string, string, string]; over: string; under: string; pass: string };
    parallel: { title: string; sub: string; worker: string; zip: string };
    formats: { title: string; sub: (n: number) => string; inputs: string; outputs: string };
  };
  proof: { noUpload: string; noUploadBody: string; noAds: string; noAdsBody: string; parallel: string; parallelBody: string };
  quick: Record<'convert' | 'compress' | 'pdf' | 'pdfCompress' | 'imageToPdf' | 'data', { title: string; desc: string }>;
  actions: Record<ActionId, { label: string; desc: string }>;
  fields: {
    to: string; width: string; quality: string; target: string; pageSize: string; pdfQuality: string; dpi: string; pages: string; ranges: string;
    original: string; small: string; high: string; normal: string; auto: string; nearOriginal: string; balanced: string; smallest: string;
    fitPhoto: string; light: string; strong: string; screen: string; print: string; allPagesHint: string; splitHint: string;
    videoSize: string; gifFps: string; audioOnly: string;
  };
  ui: {
    audioDropped: string; status: (done: number, total: number, failed: number) => string; // 화면 낭독기용 진행 요약
    files: string; clear: string; addMore: string; run: (label: string, n: number) => string; runCombined: (label: string) => string; cancel: string;
    saveAll: (n: number) => string; save: string; startOver: string; remaining: (n: number) => string;
    processing: string; tries: (q: number, n: number) => string; tooLarge: (need: string, limit: string) => string; keptOriginal: string; color444: string; colorWarn: string; filesN: (n: number) => string; notForThis: string;
    skipped: (n: number) => string; skippedUnsupported: (n: number) => string; pasted: string; done: string; doneDownload: string; zipping: string;
    noActions: string; compare: string; fit: string; actualSize: string; close: string; up: string; down: string; download: string; remove: string;
    paletteHint: string; paletteEmpty: string; telemetryOff: string; telemetryOn: string; telemetryOffDone: string; telemetryOnDone: string; themeCycle: string;
    pages: (n: number) => string; psdNote: string; moveUp: string; footer: string; footerToggleOff: string; footerToggleOn: string; licenses: string;
  };
  // 오류 밑에 붙이는 구체적 이유(app/error-reason.ts가 워커의 detail 표식을 이 문구로 바꾼다)
  reasons: {
    noWebcodecs: string; noVideo: string; noAudio: string; encoderMp4: string; encoderWebm: string;
    videoCodec: (codec: string) => string; audioCodec: string; gifSeconds: (seconds: number) => string; gifPixels: string;
  };
  errors: Record<ErrorCode, string>;
  privacy: { title: string; body: string[] };
  faqTitle: string;
  related: string;
  howTo: string;
}

// 기능별 랜딩 페이지 문구(검색·AI 답변에 그대로 쓰이는 글)
export interface LandingCopy {
  title: string; // <title>과 h1
  metaDescription: string;
  intro: string;
  steps: [string, string, string];
  faq: { q: string; a: string }[];
}
