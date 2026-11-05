// Flate 사진 판별 '검증' 세트의 그림 쪽: 실제 브라우저(Edge) 화면 캡처. 기준(photo-detect.ts)을 정한 **뒤에** 만들었다.
// 기준 세트(Pillow로 그림)와 글자 그리는 방식이 다르다. 실행: node bench/make-flate-holdout-shots.mjs
// → bench/data/pdf-flate/holdout/graphic/*.png (+ 사진이 섞인 화면은 .../ambiguous 아님, 그림으로 본다)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'bench/data/pdf-flate/holdout/graphic';
mkdirSync(OUT, { recursive: true });
const lorem = (n, seed = 1) => {
  const w = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua 회의록 예산 집행 현황 담당자 검토 승인 일정 변경 안내 고객 문의 처리 결과'.split(' ');
  let s = seed, out = [];
  for (let i = 0; i < n; i++) { s = (s * 9301 + 49297) % 233280; out.push(w[s % w.length]); }
  return out.join(' ');
};
const css = 'body{margin:0;font-family:"Segoe UI","Malgun Gothic",sans-serif}';
const PAGES = {
  article: `<style>${css} main{max-width:760px;margin:40px auto;line-height:1.7;font-size:17px;color:#222} h1{font-size:34px}</style><main><h1>${lorem(6)}</h1>${Array.from({ length: 9 }, (_, i) => `<p>${lorem(60, i + 2)}</p>`).join('')}</main>`,
  wiki: `<style>${css} body{font-family:Georgia,serif;font-size:14px} .box{float:right;width:260px;border:1px solid #aaa;background:#f8f9fa;margin:0 0 10px 16px;padding:8px} td{padding:3px 6px;border-bottom:1px solid #ddd}</style><div style="padding:24px"><h1 style="border-bottom:1px solid #aaa">${lorem(3)}</h1><div class="box"><b>${lorem(2)}</b><table>${Array.from({ length: 12 }, (_, i) => `<tr><td>${lorem(1, i)}</td><td>${lorem(3, i + 7)}</td></tr>`).join('')}</table></div>${Array.from({ length: 8 }, (_, i) => `<p>${lorem(70, i + 30)}</p>`).join('')}</div>`,
  code: `<style>body{margin:0;background:#1e1e1e;color:#d4d4d4;font:14px/20px Consolas,monospace} .k{color:#569cd6}.s{color:#ce9178}.c{color:#6a9955}.n{color:#b5cea8} .g{color:#858585;display:inline-block;width:40px;text-align:right;margin-right:16px}</style><pre style="margin:0;padding:12px">${Array.from({ length: 40 }, (_, i) => `<span class="g">${i + 1}</span>${'  '.repeat(i % 4)}<span class="k">${['const', 'if', 'return', 'await', 'export'][i % 5]}</span> ${lorem(2, i)} = <span class="s">"${lorem(2, i + 3)}"</span> <span class="n">${i * 37}</span> <span class="c">// ${lorem(3, i + 9)}</span>`).join('\n')}</pre>`,
  terminal: `<style>body{margin:0;background:#0c0c0c;color:#cccccc;font:15px/19px "Cascadia Mono",Consolas,monospace}</style><pre style="margin:0;padding:10px">${Array.from({ length: 34 }, (_, i) => `<span style="color:#13a10e">user@pc</span>:<span style="color:#3b78ff">~/proj</span>$ ${lorem(4, i)}\n${lorem(9, i + 50)}`).join('\n')}</pre>`,
  chat: `<style>${css} body{background:#b2c7d9} .m{max-width:60%;margin:10px 16px;padding:10px 14px;border-radius:14px;font-size:15px} .me{background:#fef01b;margin-left:auto} .you{background:#fff}</style>${Array.from({ length: 14 }, (_, i) => `<div class="m ${i % 3 ? 'you' : 'me'}">${lorem(8 + (i % 5) * 4, i)}</div>`).join('')}`,
  sheet: `<style>${css} table{border-collapse:collapse;font:13px Calibri,sans-serif} td,th{border:1px solid #d4d4d4;padding:2px 6px;width:90px} th{background:#f3f3f3}</style><table><tr>${'<th>A</th><th>B</th><th>C</th><th>D</th><th>E</th><th>F</th><th>G</th><th>H</th><th>I</th><th>J</th>'}</tr>${Array.from({ length: 36 }, (_, r) => `<tr>${Array.from({ length: 10 }, (_, c) => `<td style="${r % 7 === 0 ? 'background:#e2efda' : ''}">${(r * 131 + c * 977) % 100000}</td>`).join('')}</tr>`).join('')}</table>`,
  slide: `<style>${css} body{width:1280px;height:720px;background:linear-gradient(135deg,#1e3c72,#2a5298 40%,#6dd5ed);color:#fff} h1{font-size:64px;margin:0;padding:200px 80px 20px} p{font-size:28px;padding:0 80px}</style><h1>2027 사업 전략</h1><p>${lorem(14)}</p>`,
  'slide-radial': `<style>${css} body{width:1280px;height:720px;background:radial-gradient(circle at 30% 40%,#ffecd2,#fcb69f 50%,#a1477a);color:#222} h1{font-size:58px;margin:0;padding:240px 90px 10px}</style><h1>${lorem(4)}</h1><p style="font-size:26px;padding:0 90px">${lorem(18, 5)}</p>`,
  dashboard: `<style>${css} body{background:#f4f6fa} .c{background:#fff;border-radius:12px;box-shadow:0 2px 8px #0002;margin:16px;padding:16px;display:inline-block;width:360px;vertical-align:top}</style>${Array.from({ length: 6 }, (_, k) => `<div class="c"><b>${lorem(3, k)}</b><svg width="360" height="180">${Array.from({ length: 12 }, (_, i) => `<rect x="${i * 30}" y="${180 - ((i * 53 + k * 31) % 150) - 10}" width="20" height="${((i * 53 + k * 31) % 150) + 10}" fill="${['#4e79a7', '#f28e2b', '#59a14f'][k % 3]}"/>`).join('')}<polyline fill="none" stroke="#e15759" stroke-width="2" points="${Array.from({ length: 12 }, (_, i) => `${i * 30 + 10},${100 + 50 * Math.sin(i + k)}`).join(' ')}"/></svg><div style="font-size:13px;color:#555">${lorem(12, k + 3)}</div></div>`).join('')}`,
  inbox: `<style>${css} .r{display:flex;gap:16px;padding:10px 20px;border-bottom:1px solid #eee;font-size:14px} .r b{width:160px}</style><div style="background:#f6f8fc;padding:14px 20px;font-size:22px">받은편지함</div>${Array.from({ length: 22 }, (_, i) => `<div class="r" style="background:${i % 4 ? '#fff' : '#f2f6fc'}"><b>${lorem(2, i)}</b><span>${lorem(10, i + 11)}</span><span style="margin-left:auto;color:#666">${(i % 12) + 1}월 ${(i * 7) % 28 + 1}일</span></div>`).join('')}`,
  invoice: `<style>${css} body{font-family:"Times New Roman",Batang,serif;padding:50px;font-size:14px} td{border-bottom:1px solid #999;padding:6px}</style><h2 style="text-align:center">거 래 명 세 서</h2><p>${lorem(20)}</p><table style="width:100%;border-collapse:collapse">${Array.from({ length: 18 }, (_, i) => `<tr><td>${i + 1}</td><td>${lorem(4, i)}</td><td style="text-align:right">${(i * 12345) % 999999}원</td></tr>`).join('')}</table>`,
  calendar: `<style>${css} td{border:1px solid #ddd;width:150px;height:100px;vertical-align:top;font-size:12px;padding:4px} .e{background:#d2e3fc;border-radius:4px;margin:2px 0;padding:1px 4px}</style><h2 style="padding:0 16px">2026년 11월</h2><table style="border-collapse:collapse">${Array.from({ length: 5 }, (_, r) => `<tr>${Array.from({ length: 7 }, (_, c) => `<td>${r * 7 + c + 1}${(r + c) % 3 === 0 ? `<div class="e">${lorem(2, r * 7 + c)}</div>` : ''}</td>`).join('')}</tr>`).join('')}</table>`,
  form: `<style>${css} body{background:#fafafa;padding:30px} label{display:block;margin:14px 0 4px;font-size:14px} input,select{width:420px;padding:8px;border:1px solid #bbb;border-radius:6px;font-size:14px} button{margin-top:20px;padding:10px 30px;background:#0b57d0;color:#fff;border:0;border-radius:20px;font-size:15px}</style><h2>회원 정보 수정</h2>${Array.from({ length: 9 }, (_, i) => `<label>${lorem(2, i)}</label><input value="${lorem(3, i + 20)}">`).join('')}<br><button>저장</button>`,
  'map-svg': `<style>${css}</style><svg width="1100" height="760" style="background:#aad3df">${Array.from({ length: 40 }, (_, i) => `<polygon points="${Array.from({ length: 6 }, (_, k) => `${(i * 97 + k * 61) % 1100},${(i * 53 + k * 89) % 760}`).join(' ')}" fill="${['#f2efe9', '#c8facc', '#e0dfdf', '#fff1ba'][i % 4]}" stroke="#999"/>`).join('')}${Array.from({ length: 25 }, (_, i) => `<text x="${(i * 211) % 1050}" y="${(i * 137) % 740 + 15}" font-size="13">${lorem(1, i)}</text>`).join('')}</svg>`,
  'news-photo': `<style>${css} main{max-width:900px;margin:20px auto;font-size:16px;line-height:1.6}</style><main><h1>${lorem(8)}</h1><img src="data:image/png;base64,__PHOTO__" style="width:100%"><p style="color:#666;font-size:13px">${lorem(10, 4)}</p>${Array.from({ length: 4 }, (_, i) => `<p>${lorem(50, i + 8)}</p>`).join('')}</main>`,
};
const MOBILE = { 'mobile-chat': 'chat', 'mobile-article': 'article', 'mobile-inbox': 'inbox' };

const browser = await chromium.launch({ channel: 'msedge' });
// 섞인 화면용 사진: 검증 사진(picsum) 중 하나가 아니라 이 스크립트가 그리는 무늬로 하면 사진답지 않다 → 기준 세트에 없는 unsplash 영역을 잘라 쓴다
const { readFileSync, existsSync } = await import('node:fs');
const photo = existsSync('bench/data/pdf-flate/holdout-src/news.png') ? readFileSync('bench/data/pdf-flate/holdout-src/news.png').toString('base64') : '';
for (const [name, html] of Object.entries(PAGES)) {
  if (name === 'news-photo' && !photo) { console.log('news-photo: 사진 없음, 건너뜀'); continue; }
  for (const dsf of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dsf });
    await page.setContent(html.replace('__PHOTO__', photo));
    await page.screenshot({ path: `${OUT}/${name}@${dsf}x.png`, fullPage: false });
    await page.close();
  }
}
for (const [name, src] of Object.entries(MOBILE)) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
  await page.setContent(PAGES[src]);
  await page.screenshot({ path: `${OUT}/${name}@3x.png` });
  await page.close();
}
await browser.close();
console.log('done');
