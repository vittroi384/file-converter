// tools/arch/*.html → docs/diagrams/*.png (2배 해상도, 내용 높이에 맞춰 자름). 실행: node tools/arch/render.mjs [이름...]
import { chromium } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'docs', 'diagrams');
const only = process.argv.slice(2);
const files = readdirSync(here).filter(f => f.endsWith('.html') && (!only.length || only.some(o => f.startsWith(o)))).sort();
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1200, height: 800 } });
for (const f of files) {
  await p.goto(pathToFileURL(join(here, f)).href);
  await p.evaluate(() => document.fonts.ready);
  const el = p.locator('.page');
  await el.screenshot({ path: join(out, f.replace(/\.html$/, '.png')) });
  const box = await el.boundingBox();
  // 넘침 검사: 페이지 폭(1200) 밖으로 나간 요소
  const over = await p.evaluate(() => [...document.querySelectorAll('.page *')].filter(e => e.getBoundingClientRect().right > 1201).map(e => e.className || e.tagName).slice(0, 5));
  console.log(`${f} → ${Math.round(box.width)}×${Math.round(box.height)}${over.length ? `  넘침: ${over.join(', ')}` : ''}`);
}
await b.close();
