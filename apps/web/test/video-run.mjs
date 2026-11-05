// 영상 변환 실브라우저 시험. 먼저 apps/web에서 `npx vite --port 5181`을 띄운 뒤:
//   node test/video-run.mjs [edge|firefox|webkit ...]
//   node test/video-run.mjs --save-fixtures   (e2e/fixtures/clip.mp4·clip.webm을 다시 만든다 — e2e/video.spec.ts용)
// 각 시험은 판정(pass/fail)과 측정값을 한 줄씩 찍는다.
import { chromium, firefox, webkit } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const URL_ = 'http://localhost:5181/test/video-harness.html';
const engines = { edge: () => chromium.launch({ channel: 'msedge' }), firefox: () => firefox.launch(), webkit: () => webkit.launch() };
const save = process.argv.includes('--save-fixtures');
const pick = process.argv.slice(2).filter(a => !a.startsWith('--'));

const F = {
  hd: ['hd', { container: 'mp4', codec: 'avc', w: 1280, h: 720, seconds: 3, fps: 30, audio: 'aac' }],
  vp9: ['vp9', { container: 'webm', codec: 'vp9', w: 1280, h: 720, seconds: 3, fps: 30, audio: 'opus' }],
  vp8: ['vp8', { container: 'webm', codec: 'vp8', w: 640, h: 360, seconds: 3, fps: 25, audio: 'opus' }],
  rot: ['rot', { container: 'mp4', codec: 'avc', w: 1280, h: 720, seconds: 3, fps: 30, audio: 'aac', rotation: 90 }],
  silent: ['silent', { container: 'mp4', codec: 'avc', w: 640, h: 360, seconds: 2, fps: 30, audio: null }],
  fhd: ['fhd', { container: 'mp4', codec: 'avc', w: 1920, h: 1080, seconds: 10, fps: 30, audio: 'aac' }],
  noisy: ['noisy', { container: 'mp4', codec: 'avc', w: 1920, h: 1080, seconds: 10, fps: 30, audio: 'aac', noise: true }],
  clip: ['clip', { container: 'mp4', codec: 'avc', w: 640, h: 360, seconds: 3, fps: 30, audio: 'aac' }],
  clipw: ['clipw', { container: 'webm', codec: 'vp9', w: 640, h: 360, seconds: 3, fps: 30, audio: 'opus' }],
  long: ['long', { container: 'mp4', codec: 'avc', w: 320, h: 240, seconds: 35, fps: 10, audio: null }],
};

const near = (a, b, tol = 40) => a.every((x, i) => Math.abs(x - b[i]) <= tol);
const vid = r => r.outputs?.[0]?.video;
// 공통 확인: 성공, 형식, 길이(±0.25초), 크기, 장면 색이 원본과 같은 시각에 맞는지
function checkVideo(r, { sig, w, h, dur = 3, audio = true, redAt = 'tl' }) {
  const o = r.outputs?.[0], v = o?.video;
  const errs = [];
  if (!r.ok) return [`실패 ${JSON.stringify(r.error)}`];
  if (!o.sig.startsWith(sig)) errs.push(`형식 ${o.sig}`);
  if (!v) return [...errs, `재생기 열기 실패 ${o.inspectError}`];
  if (Math.abs(v.duration - dur) > 0.25) errs.push(`길이 ${v.duration}`);
  if (v.width !== w || v.height !== h) errs.push(`크기 ${v.width}x${v.height}`);
  for (const s of v.samples) {
    if (!near(s.bg, s.expectBg)) errs.push(`t=${s.t} 배경 ${s.bg} ≠ ${s.expectBg}`);
    if (!near(redAt === 'tl' ? s.tl : s.tr, [255, 0, 0], 60)) errs.push(`t=${s.t} 빨간 표시 위치 tl=${s.tl} tr=${s.tr}`);
  }
  if (audio) {
    const a = o.audio;
    if (!a || a.error) errs.push(`소리 디코드 실패 ${a?.error}`);
    else { if (Math.abs(a.duration - dur) > 0.3) errs.push(`소리 길이 ${a.duration}`); if (Math.abs(a.hz - 440) > 15) errs.push(`소리 ${a.hz}Hz`); }
  }
  return errs;
}

const CASES = [
  ['MP4(H.264+AAC) → MP4 원본 크기(그대로 옮김)', F.hd, 'a.mp4', { to: 'mp4' }, r => [...checkVideo(r, { sig: 'mp4', w: 1280, h: 720 }), ...(r.meta?.copied ? [] : ['다시 인코딩함(옮기기 기대)'])]],
  ['MP4 → MP4 480p', F.hd, 'a.mp4', { to: 'mp4', res: 480 }, r => checkVideo(r, { sig: 'mp4', w: 854, h: 480 })],
  ['MP4 → WebM(VP9+Opus)', F.hd, 'a.mp4', { to: 'webm' }, r => checkVideo(r, { sig: 'webm', w: 1280, h: 720 })],
  ['MP4 → GIF 10fps', F.hd, 'a.mp4', { to: 'gif', fps: 10 }, r => {
    const g = r.outputs?.[0]?.gif;
    if (!r.ok) return [`실패 ${JSON.stringify(r.error)}`];
    return [...(r.outputs[0].sig === 'gif' ? [] : ['형식']), ...(g && g.width === 640 && g.height === 360 ? [] : [`크기 ${JSON.stringify(g)}`]), ...(g?.frames === undefined || g.frames === 30 ? [] : [`프레임 ${g.frames}`])];
  }],
  ['MP4 → M4A(AAC 그대로)', F.hd, 'a.mp4', { to: 'm4a' }, r => {
    if (!r.ok) return [`실패 ${JSON.stringify(r.error)}`];
    const o = r.outputs[0], a = o.audio;
    return [...(o.sig.startsWith('mp4') || o.sig === 'webm' ? [] : [`형식 ${o.sig}`]), ...(a && !a.error && Math.abs(a.duration - 3) < 0.3 && Math.abs(a.hz - 440) < 15 ? [] : [`소리 ${JSON.stringify(a)}`])];
  }],
  ['WebM(VP9+Opus) → MP4(H.264+AAC)', F.vp9, 'b.webm', { to: 'mp4' }, r => checkVideo(r, { sig: 'mp4', w: 1280, h: 720 })],
  ['WebM(VP9) → WebM 그대로', F.vp9, 'b.webm', { to: 'webm' }, r => checkVideo(r, { sig: 'webm', w: 1280, h: 720 })],
  ['WebM(VP8+Opus) → M4A', F.vp8, 'c.webm', { to: 'm4a' }, r => {
    if (!r.ok) return [`실패 ${JSON.stringify(r.error)}`];
    const a = r.outputs[0].audio;
    return a && !a.error && Math.abs(a.duration - 3) < 0.3 && Math.abs(a.hz - 440) < 15 ? [] : [`소리 ${JSON.stringify(a)}`];
  }],
  ['WebM(VP8) → GIF 5fps 480p', F.vp8, 'c.webm', { to: 'gif', fps: 5, res: 480 }, r => {
    if (!r.ok) return [`실패 ${JSON.stringify(r.error)}`];
    const g = r.outputs[0].gif; // 원본 360p < 480 → 그대로 640x360
    return g && g.width === 640 && g.height === 360 && (g.frames === undefined || g.frames === 15) ? [] : [`GIF ${JSON.stringify(g)}`];
  }],
  ['세로(회전 90) MP4 → MP4 원본(회전 정보 유지)', F.rot, 'r.mov', { to: 'mp4' }, r => checkVideo(r, { sig: 'mp4', w: 720, h: 1280, redAt: 'tr' })],
  ['세로(회전 90) MP4 → MP4 480p(회전 반영해 다시 인코딩)', F.rot, 'r.mov', { to: 'mp4', res: 480 }, r => checkVideo(r, { sig: 'mp4', w: 480, h: 854, redAt: 'tr' })],
  ['소리 없는 영상 → M4A: 안내 오류', F.silent, 's.mp4', { to: 'm4a' }, r => (r.ok ? ['성공하면 안 됨'] : r.error?.code === 'unsupported' ? [] : [`코드 ${JSON.stringify(r.error)}`])],
  ['35초 → GIF: 길이 제한 오류', F.long, 'l.mp4', { to: 'gif' }, r => (r.ok ? ['성공하면 안 됨'] : r.error?.code === 'too-large' ? [] : [`코드 ${JSON.stringify(r.error)}`])],
  ['소리 없는 영상 → WebM', F.silent, 's.mp4', { to: 'webm' }, r => checkVideo(r, { sig: 'webm', w: 640, h: 360, dur: 2, audio: false })],
  ['[속도] 1080p 10초 → MP4 720p', F.fhd, 'f.mp4', { to: 'mp4', res: 720 }, r => checkVideo(r, { sig: 'mp4', w: 1280, h: 720, dur: 10 })],
  ['[속도] 1080p 10초 → WebM 원본', F.fhd, 'f.mp4', { to: 'webm' }, r => checkVideo(r, { sig: 'webm', w: 1920, h: 1080, dur: 10 })],
  ['[속도] 1080p 10초 → GIF 10fps', F.fhd, 'f.mp4', { to: 'gif' }, r => (r.ok && r.outputs[0].sig === 'gif' ? [] : [`실패 ${JSON.stringify(r.error)}`])],
  ['[속도·잡음] 1080p 10초 → MP4 720p', F.noisy, 'n.mp4', { to: 'mp4', res: 720 }, r => checkVideo(r, { sig: 'mp4', w: 1280, h: 720, dur: 10 })],
  ['[속도·잡음] 1080p 10초 → MP4 원본(H.264 그대로)', F.noisy, 'n.mp4', { to: 'mp4' }, r => checkVideo(r, { sig: 'mp4', w: 1920, h: 1080, dur: 10 })],
  ['[속도·잡음] 1080p 10초 → WebM 원본', F.noisy, 'n.mp4', { to: 'webm' }, r => checkVideo(r, { sig: 'webm', w: 1920, h: 1080, dur: 10 })],
  ['[속도·잡음] 1080p 10초 → WebM 720p', F.noisy, 'n.mp4', { to: 'webm', res: 720 }, r => checkVideo(r, { sig: 'webm', w: 1280, h: 720, dur: 10 })],
  ['[속도·잡음] 1080p 10초 → GIF 10fps', F.noisy, 'n.mp4', { to: 'gif' }, r => (r.ok && r.outputs[0].sig === 'gif' ? [] : [`실패 ${JSON.stringify(r.error)}`])],
  ['취소: 변환 중 워커 종료', F.fhd, 'f.mp4', { to: 'webm' }, r => (r.cancelled ? [] : ['취소 안 됨']), 400],
];

// 시험 영상은 엣지에서 한 번 만들어 모든 엔진에 같은 바이트로 준다(엔진마다 인코더가 달라 시험 영상이 달라지지 않게)
const served = new Map();
{
  const b = await engines.edge();
  const p = await b.newPage();
  await p.goto(URL_);
  await p.waitForFunction(() => document.getElementById('log')?.textContent === 'ready', null, { timeout: 60_000 });
  for (const [k, spec] of Object.values(F)) served.set(k, Buffer.from(await p.evaluate(([k, s]) => window.fixtureBase64(k, s), [k, spec]), 'base64'));
  await b.close();
}
if (save) {
  const dir = new URL('../../../e2e/fixtures/', import.meta.url);
  writeFileSync(new URL('clip.mp4', dir), served.get('clip'));
  writeFileSync(new URL('clip.webm', dir), served.get('clipw'));
  console.log('saved e2e/fixtures/clip.mp4', served.get('clip').length, 'clip.webm', served.get('clipw').length);
  process.exit(0);
}

let fail = 0;
for (const name of pick.length ? pick : Object.keys(engines)) {
  const b = await engines[name]();
  const p = await b.newPage();
  await p.addInitScript(() => { window.__served = true; });
  await p.route('**/__fx/*', r => r.fulfill({ body: served.get(r.request().url().split('/').pop()), contentType: 'application/octet-stream' }));
  p.on('console', m => { if (m.type() === 'error') console.log(`  [${name} console] ${m.text()}`); });
  p.on('pageerror', e => console.log(`  [${name} pageerror] ${e}`));
  await p.goto(URL_);
  await p.waitForFunction(() => document.getElementById('log')?.textContent === 'ready', null, { timeout: 60_000 });
  console.log(`\n== ${name}`, JSON.stringify(await p.evaluate(() => window.probe())));
  if (!(await p.evaluate(() => typeof VideoEncoder !== 'undefined'))) {
    // WebCodecs가 없는 엔진: 깔끔한 'unsupported' 오류여야 한다(멈추거나 죽으면 안 됨)
    const r = await p.evaluate(() => window.runNoCodec());
    const good = !r.ok && r.error?.code === 'unsupported';
    if (!good) fail++;
    console.log(`  ${good ? 'pass' : 'FAIL'} WebCodecs 없음 → ${JSON.stringify(r).slice(0, 300)}`);
    await b.close();
    continue;
  }
  // 회전 시험 영상 자체가 재생기에서 세로로 보이는지(시험 장치 확인)
  const fx = await p.evaluate(([k, s]) => window.inspectFixture(k, s), F.rot);
  console.log(`  (회전 시험 영상 재생기 기준: ${fx.video?.width}x${fx.video?.height}, 빨간 표시 tr=${fx.video?.samples?.[0]?.tr})`);
  for (const [title, [k, spec], file, opts, check, cancelMs] of CASES) {
    const r = await p.evaluate(([k, s, f, o, c]) => window.runCase(k, s, f, o, c), [k, spec, file, opts, cancelMs]);
    const errs = check(r);
    if (errs.length) fail++;
    const o = r.outputs?.[0];
    console.log(`  ${errs.length ? 'FAIL' : 'pass'} ${title} — ${r.ms}ms, ${r.inBytes}B → ${o ? `${o.bytes}B ${o.sig}` : '-'}${r.meta ? ' ' + JSON.stringify(r.meta) : ''}${errs.length ? '\n       ' + errs.join('\n       ') : ''}${r.error ? '\n       error: ' + JSON.stringify(r.error) : ''}`);
  }
  // 취소 뒤에도 새 작업이 정상인지
  const after = await p.evaluate(([k, s]) => window.runCase(k, s, 'a.mp4', { to: 'mp4', res: 480 }), F.hd);
  const e2 = checkVideo(after, { sig: 'mp4', w: 854, h: 480 });
  if (e2.length) fail++;
  console.log(`  ${e2.length ? 'FAIL' : 'pass'} 취소 뒤 다시 변환 ${e2.join(', ')}`);
  await b.close();
}
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exitCode = fail ? 1 : 0;
