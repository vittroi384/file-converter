// 서버 진입점: 빌드 때 미리 렌더(SSG)와 요청 때 스트리밍 렌더(SSR)가 같은 함수를 쓴다.
import { prerenderToNodeStream } from 'react-dom/static';
import { renderToPipeableStream } from 'react-dom/server';
import type { Writable } from 'node:stream';
import { App } from './app/App.tsx';
import { pageData } from './app/page-data.server.ts';
import { buildHead } from './head.ts';
import { getDict } from './i18n/all.ts';
import { LOCALE_NAMES } from './i18n/locales.ts';
import { DATA_ID, type DemoData, type PageData } from './app/page-data.ts';
import { resolve, PRERENDER_SLUGS, allDynamicSlugs } from './app/routes.ts';

export { PRERENDER_SLUGS, allDynamicSlugs, resolve };
export { LOCALES, localePath, preferredLocale } from './i18n/locales.ts';
export { getDict, getLandingT } from './i18n/all.ts';
export { LANDINGS } from './i18n/landings.ts';

export interface Rendered { data: PageData; head: string; lang: string; dataJson: string; status: number }

function prepare(url: string, siteUrl: string, demo?: DemoData): Rendered {
  const data = pageData(url, demo);
  return {
    data,
    head: buildHead(data, siteUrl),
    lang: LOCALE_NAMES[data.locale].htmlLang,
    // 실행되지 않는 JSON 블록(CSP가 인라인 스크립트를 막아도 허용됨). </script> 깨짐 방지.
    dataJson: `<script type="application/json" id="${DATA_ID}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`,
    status: data.kind === 'notfound' ? 404 : 200,
  };
}

// SSG: 끝까지 렌더한 HTML 문자열
export async function renderStatic(url: string, siteUrl: string, demo?: DemoData): Promise<Rendered & { html: string }> {
  const r = prepare(url, siteUrl, demo);
  const { prelude } = await prerenderToNodeStream(<App data={r.data} t={getDict(r.data.locale)} />);
  const chunks: Buffer[] = [];
  for await (const c of prelude) chunks.push(Buffer.from(c as Uint8Array));
  return { ...r, html: Buffer.concat(chunks).toString('utf8') };
}

// SSR: 머리를 먼저 보내고 본문을 흘려보낸다(첫 바이트가 빠르다)
export function renderStream(url: string, siteUrl: string, template: { before: (r: Rendered) => string; after: (r: Rendered) => string }, out: Writable & { setHeader?(k: string, v: string): void; statusCode?: number }, demo?: DemoData) {
  const r = prepare(url, siteUrl, demo);
  return new Promise<Rendered>((ok, fail) => {
    const s = renderToPipeableStream(<App data={r.data} t={getDict(r.data.locale)} />, {
      onShellReady() {
        if (out.statusCode !== undefined) out.statusCode = r.status;
        out.setHeader?.('content-type', 'text/html; charset=utf-8');
        out.write(template.before(r));
        s.pipe(out);
        out.on('finish', () => ok(r));
      },
      onShellError: fail,
      onError(e) { console.error('SSR 오류', e); },
    });
    // 끝에 데이터와 닫는 태그를 붙이기 위해 pipe 대상의 end를 가로챈다
    const end = out.end.bind(out);
    (out as { end: (...a: unknown[]) => unknown }).end = (...a: unknown[]) => { out.write(template.after(r)); return end(...(a as [])); };
  });
}
