import { describe, it, expect } from 'vitest';
import { scrubMessage, formatFromName } from './index.ts';
import { TelemetryEvent, TelemetryBatch } from './schema.ts';

describe('TelemetryEvent', () => {
  it('정상 변환 이벤트 통과', () => {
    const r = TelemetryEvent.safeParse({ t: 'conv', op: 'image', from: 'png', to: 'webp', ok: true, ms: 120, inBytes: 1000, outBytes: 400 });
    expect(r.success).toBe(true);
  });
  it('허용 목록 밖 라벨 거부(라벨 폭증 방지)', () => {
    expect(TelemetryEvent.safeParse({ t: 'conv', op: 'image', from: 'my-secret.png', to: 'webp', ok: true, ms: 1, inBytes: 1 }).success).toBe(false);
    expect(TelemetryEvent.safeParse({ t: 'conv', op: 'hack', from: 'png', to: 'webp', ok: true, ms: 1, inBytes: 1 }).success).toBe(false);
  });
  it('말이 안 되는 숫자 거부', () => {
    expect(TelemetryEvent.safeParse({ t: 'conv', op: 'image', from: 'png', to: 'webp', ok: true, ms: -1, inBytes: 1 }).success).toBe(false);
    expect(TelemetryEvent.safeParse({ t: 'conv', op: 'image', from: 'png', to: 'webp', ok: true, ms: 1, inBytes: 1e13 }).success).toBe(false);
  });
  it('모르는 필드는 버려짐(파일 이름 같은 걸 실수로 넣어도 저장 안 됨)', () => {
    const r = TelemetryEvent.safeParse({ t: 'pv', path: '/', fileName: 'secret.pdf' });
    expect(r.success && !('fileName' in r.data)).toBe(true);
  });
  it('배치 크기 제한', () => {
    expect(TelemetryBatch.safeParse({ v: 1, events: Array(51).fill({}) }).success).toBe(false);
    expect(TelemetryBatch.safeParse({ v: 1, events: [] }).success).toBe(false);
  });
});

describe('scrubMessage', () => {
  it('경로·파일 이름·이메일·URL 제거', () => {
    const s = scrubMessage('Failed C:\Users\kim\사진\a.png and /home/kim/x.pdf, mail kim@ex.com at https://x.y/z, 내여권.jpg');
    expect(s).not.toMatch(/kim|여권|ex\.com|x\.y/);
  });
});

describe('formatFromName', () => {
  it('확장자 정규화', () => {
    expect(formatFromName('A.JPEG')).toBe('jpg');
    expect(formatFromName('x.yml')).toBe('yaml');
    expect(formatFromName('noext')).toBe('other');
    expect(formatFromName('a.exe')).toBe('other');
  });
});

import { classifyReferrer } from './index.ts';
describe('유입 출처 분류', () => {
  it('AI·검색·직접', () => {
    expect(classifyReferrer('chatgpt.com', null)).toBe('chatgpt');
    expect(classifyReferrer('', 'chatgpt.com')).toBe('chatgpt'); // utm_source=chatgpt.com
    expect(classifyReferrer('www.perplexity.ai')).toBe('perplexity');
    expect(classifyReferrer('claude.ai')).toBe('claude');
    expect(classifyReferrer('gemini.google.com')).toBe('gemini'); // 구글보다 먼저
    expect(classifyReferrer('www.google.co.kr')).toBe('google');
    expect(classifyReferrer('search.naver.com')).toBe('naver');
    expect(classifyReferrer('')).toBe('direct');
    expect(classifyReferrer('blog.example.org')).toBe('other');
  });
});

import { classifyCrawler, crawlKind } from './index.ts';
describe('classifyCrawler', () => {
  it('AI 크롤러를 구분한다(구체적인 것 먼저)', () => {
    expect(classifyCrawler('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot')).toBe('chatgpt-user');
    expect(classifyCrawler('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)')).toBe('gptbot');
    expect(classifyCrawler('Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)')).toBe('oai-searchbot');
    expect(classifyCrawler('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')).toBe('claudebot');
    expect(classifyCrawler('Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)')).toBe('perplexitybot');
    expect(classifyCrawler('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe('googlebot');
    expect(classifyCrawler('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe('bingbot');
    expect(classifyCrawler('SomeRandomCrawler/1.0')).toBe('other');
  });
  it('사람 브라우저는 null', () => {
    expect(classifyCrawler('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBeNull();
    expect(classifyCrawler('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0')).toBeNull();
    expect(classifyCrawler('')).toBeNull();
  });
});
describe('crawlKind', () => {
  it('경로 종류', () => {
    expect(crawlKind('/')).toBe('page');
    expect(crawlKind('/ko')).toBe('page');
    expect(crawlKind('/ko/')).toBe('page');
    expect(crawlKind('/heic-to-jpg')).toBe('landing');
    expect(crawlKind('/ja/merge-pdf?x=1')).toBe('landing');
    expect(crawlKind('/llms.txt')).toBe('llms');
    expect(crawlKind('/llms-full.txt')).toBe('llms');
    expect(crawlKind('/sitemap.xml')).toBe('sitemap');
    expect(crawlKind('/robots.txt')).toBe('robots');
    expect(crawlKind('/assets/index-abc.js')).toBe('other');
  });
});
