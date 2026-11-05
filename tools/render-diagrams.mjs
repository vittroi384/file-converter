// docs/diagrams/src/*.mmd → docs/diagrams/*.svg + *.png (Mermaid를 브라우저에서 그려 저장).
// 실행: node tools/render-diagrams.mjs   (Playwright Edge 사용, 네트워크 필요 없음)
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'docs', 'diagrams', 'src');
const OUT = join(root, 'docs', 'diagrams');
const mermaidJs = createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js');

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } });
await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff"><div id="out" style="display:inline-block;padding:24px;background:#fff"></div></body>');
await page.addScriptTag({ path: mermaidJs });
await page.evaluate(() => {
  // 사이트와 같은 계열의 차분한 색(종이·먹·주홍). 한글은 맑은 고딕으로(윈도우 기본, 렌더 결과 고정)
  window.mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', theme: 'base',
    themeVariables: {
      fontFamily: "Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif", fontSize: '15px',
      primaryColor: '#f5f5f4', primaryBorderColor: '#57534e', primaryTextColor: '#1c1917', lineColor: '#57534e',
      secondaryColor: '#fdf6ec', tertiaryColor: '#fafaf9', clusterBkg: '#fafaf9', clusterBorder: '#d6d3d1',
      actorBkg: '#fdf6ec', actorBorder: '#c2410c', noteBkgColor: '#fff7ed', noteBorderColor: '#c2410c',
    },
    // 줄바꿈 폭 기본 200px에선 '보안 머리글'이 '보 / 안'처럼 낱말 가운데서 꺾였다 → 넓히고 꺾을 곳은 원본에서 <br/>로
    flowchart: { curve: 'basis', htmlLabels: true, padding: 12, wrappingWidth: 320 },
    er: { layoutDirection: 'TB' },
    sequence: { mirrorActors: false },
  });
});

const files = readdirSync(SRC).filter(f => f.endsWith('.mmd')).sort();
for (const f of files) {
  const code = readFileSync(join(SRC, f), 'utf8');
  const name = f.replace(/\.mmd$/, '');
  const svg = await page.evaluate(async ([id, src]) => {
    const { svg } = await window.mermaid.render(id, src);
    const out = document.getElementById('out');
    out.innerHTML = svg;
    // Mermaid는 width="100%"로 내보낸다 → 내용 크기에 맞춰 줄어드는 상자 안에선 기본 300px로 쪼그라들었다. 원래 크기로 고정
    const el = out.querySelector('svg');
    const [, , w, h] = el.getAttribute('viewBox').split(/\s+/).map(Number);
    el.setAttribute('width', String(Math.ceil(w)));
    el.setAttribute('height', String(Math.ceil(h)));
    el.style.maxWidth = 'none';
    return el.outerHTML;
  }, [`d${name.replace(/\W/g, '')}`, code]);
  writeFileSync(join(OUT, `${name}.svg`), svg);
  await page.locator('#out').screenshot({ path: join(OUT, `${name}.png`) });
  const box = await page.locator('#out svg').boundingBox();
  console.log(`${name}: svg ${Math.round(svg.length / 1024)}KB · ${Math.round(box.width)}×${Math.round(box.height)}`);
}
await browser.close();
