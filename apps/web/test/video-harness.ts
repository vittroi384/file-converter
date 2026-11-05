// 영상 변환 시험 장치(개발용). `npx vite --port 5181`(apps/web) 뒤 /test/video-harness.html을 열고
// test/video-run.mjs(Playwright)가 window.* 함수를 부른다.
// - 시험 영상은 여기서 WebCodecs로 직접 만든다(초마다 바뀌는 배경색 + 왼쪽 위 빨간 표시 + 440Hz 소리).
// - 변환은 실제 경로(core/worker.ts → 플러그인 'video')로 돌린다.
// - 결과 확인은 우리 코드가 아니라 브라우저(<video>·<audio>·ImageDecoder·decodeAudioData)로 한다.
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

const COLORS: [number, number, number][] = [[200, 40, 40], [40, 160, 60], [40, 70, 200], [220, 200, 40], [150, 50, 170], [30, 170, 170]];
export interface FixtureSpec { container: 'mp4' | 'webm'; codec: 'avc' | 'vp9' | 'vp8'; w: number; h: number; seconds: number; fps: number; audio: 'aac' | 'opus' | null; rotation?: 0 | 90 | 180 | 270; noise?: boolean }

// noise: 실제 촬영 영상처럼 압축이 어려운 화면(움직이는 잡음)을 반투명으로 덮는다 — 속도 측정용
let noiseTex: OffscreenCanvas | null = null;
function noise(w: number, h: number) {
  if (noiseTex?.width === w * 2 && noiseTex.height === h) return noiseTex;
  noiseTex = new OffscreenCanvas(w * 2, h);
  const x = noiseTex.getContext('2d')!, img = x.createImageData(w * 2, h);
  for (let i = 0; i < img.data.length; i += 4) { const v = (Math.random() * 255) | 0; img.data[i] = v; img.data[i + 1] = (v * 7) & 255; img.data[i + 2] = 255 - v; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  return noiseTex;
}
function drawPattern(c: OffscreenCanvasRenderingContext2D, w: number, h: number, t: number, withNoise = false) {
  const [r, g, b] = COLORS[Math.floor(t) % COLORS.length]!;
  c.fillStyle = `rgb(${r},${g},${b})`; c.fillRect(0, 0, w, h);
  if (withNoise) { c.globalAlpha = 0.35; c.drawImage(noise(w, h), -Math.round((t * 300) % w), 0); c.globalAlpha = 1; c.fillStyle = `rgb(${r},${g},${b})`; c.fillRect(Math.round(w * 0.8), Math.round(h * 0.8), w, h); }
  c.fillStyle = '#f00'; c.fillRect(0, 0, Math.round(w / 4), Math.round(h / 4)); // 방향 표시(왼쪽 위)
  c.fillStyle = '#fff'; c.fillRect(Math.round(((t % 1) * (w - 40))), Math.round(h / 2), 40, 40); // 움직이는 상자
}

async function makeFixture(s: FixtureSpec): Promise<Uint8Array> {
  const t0 = performance.now();
  const vcodec = s.codec === 'avc' ? 'avc1.640028' : s.codec === 'vp9' ? 'vp09.00.40.08' : 'vp8';
  let mux: Mp4Muxer<Mp4Target> | WebmMuxer<WebmTarget>;
  const audio = s.audio ? { codec: s.audio, numberOfChannels: 2, sampleRate: 48000 } : undefined;
  if (s.container === 'mp4') mux = new Mp4Muxer({ target: new Mp4Target(), video: { codec: s.codec === 'avc' ? 'avc' : 'vp9', width: s.w, height: s.h, rotation: s.rotation ?? 0 }, audio: audio as never, fastStart: 'in-memory' });
  else mux = new WebmMuxer({ target: new WebmTarget(), video: { codec: s.codec === 'vp8' ? 'V_VP8' : 'V_VP9', width: s.w, height: s.h }, audio: audio && { ...audio, codec: 'A_OPUS' } });
  const enc = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: e => { throw e; } });
  enc.configure({ codec: vcodec, width: s.w, height: s.h, bitrate: s.noise ? 12e6 : 2e6, framerate: s.fps, ...(s.codec === 'avc' ? { avc: { format: 'avc' as const } } : {}) });
  const cv = new OffscreenCanvas(s.w, s.h);
  const c = cv.getContext('2d')!;
  const n = Math.round(s.seconds * s.fps);
  for (let i = 0; i < n; i++) {
    const t = i / s.fps;
    drawPattern(c, s.w, s.h, t, s.noise);
    const f = new VideoFrame(cv, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / s.fps) });
    enc.encode(f, { keyFrame: i % (s.fps * 2) === 0 });
    f.close();
    if (enc.encodeQueueSize > 10) await new Promise(r => setTimeout(r, 1));
  }
  await enc.flush();
  if (s.audio) {
    const aenc = new AudioEncoder({ output: (c, m) => mux.addAudioChunk(c, m), error: e => { throw e; } });
    aenc.configure({ codec: s.audio === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
    const block = 4800;
    for (let i = 0; i < s.seconds * 48000; i += block) {
      const d = new Float32Array(block * 2);
      for (let j = 0; j < block; j++) { const v = 0.4 * Math.sin((2 * Math.PI * 440 * (i + j)) / 48000); d[j] = v; d[block + j] = v; }
      const a = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: block, numberOfChannels: 2, timestamp: Math.round((i / 48000) * 1e6), data: d });
      aenc.encode(a); a.close();
    }
    await aenc.flush();
  }
  mux.finalize();
  console.log(`fixture ${s.container}/${s.codec} ${s.w}x${s.h} ${s.seconds}s: ${Math.round(performance.now() - t0)}ms`);
  return new Uint8Array(mux.target.buffer);
}

// 실제 변환 경로: 워커에 RunRequest를 보낸다(검사 → load → run)
function convert(bytes: Uint8Array, name: string, options: Record<string, unknown>, cancelAfterMs?: number) {
  return new Promise<{ ok: boolean; ms: number; progress: number[]; outputs?: { name: string; type: string; buf: ArrayBuffer }[]; meta?: unknown; error?: unknown; cancelled?: boolean }>(resolve => {
    const w = new Worker(new URL('../src/core/worker.ts', import.meta.url), { type: 'module' });
    const t0 = performance.now();
    const progress: number[] = [];
    w.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'progress') { progress.push(m.value); return; }
      w.terminate();
      if (m.type === 'done') resolve({ ok: true, ms: performance.now() - t0, progress, outputs: m.outputs, meta: m.meta });
      else resolve({ ok: false, ms: performance.now() - t0, progress, error: { code: m.code, message: m.message, detail: m.detail } });
    };
    w.onerror = e => { w.terminate(); resolve({ ok: false, ms: performance.now() - t0, progress, error: String(e.message) }); };
    const buf = bytes.slice().buffer;
    w.postMessage({ type: 'run', id: 1, op: 'video', inputs: [{ name, type: '', buf }], options }, [buf]);
    if (cancelAfterMs !== undefined) setTimeout(() => { w.terminate(); resolve({ ok: false, cancelled: true, ms: performance.now() - t0, progress }); }, cancelAfterMs);
  });
}

function signature(b: Uint8Array) {
  const s = (o: number, t: string) => String.fromCharCode(...b.subarray(o, o + t.length)) === t;
  if (s(4, 'ftyp')) return 'mp4:' + String.fromCharCode(...b.subarray(8, 12));
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (s(0, 'GIF89a')) return 'gif';
  return 'unknown';
}

// 브라우저 재생기로 열어 길이·크기·장면 색을 본다
async function inspectVideo(blob: Blob) {
  const v = document.createElement('video');
  v.muted = true; v.src = URL.createObjectURL(blob);
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video load: ' + v.error?.message)); });
  const out: Record<string, unknown> = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  const samples: Record<string, unknown>[] = [];
  for (const t of [0.5, 1.5, 2.5]) {
    if (t > v.duration) continue;
    v.currentTime = t;
    await new Promise(r => { v.onseeked = r; });
    // seeked 직후엔 이전 프레임이 그려질 때가 있어(첫 실행에서 한 번 봄) 새 프레임이 화면에 붙을 때까지 기다린다
    await new Promise<void>(r => { (v as HTMLVideoElement & { requestVideoFrameCallback?(cb: () => void): void }).requestVideoFrameCallback?.(() => r()); setTimeout(r, 300); });
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(v, 0, 0);
    const px = (fx: number, fy: number) => Array.from(x.getImageData(Math.floor(fx * c.width), Math.floor(fy * c.height), 1, 1).data.slice(0, 3));
    samples.push({ t, bg: px(0.9, 0.9), tl: px(0.05, 0.05), tr: px(0.95, 0.05), expectBg: COLORS[Math.floor(t) % COLORS.length] });
  }
  out.samples = samples;
  // 소리 트랙이 있으면 디코드해서 길이·주파수(영점 교차)
  URL.revokeObjectURL(v.src);
  return out;
}
async function inspectAudio(blob: Blob) {
  const ac = new OfflineAudioContext(1, 1, 48000);
  const ab = await ac.decodeAudioData(await blob.arrayBuffer());
  const ch = ab.getChannelData(0);
  let cross = 0;
  const from = Math.floor(ab.sampleRate * 0.5), to = Math.min(ch.length, from + ab.sampleRate);
  for (let i = from + 1; i < to; i++) if (ch[i - 1]! < 0 && ch[i]! >= 0) cross++;
  return { duration: ab.duration, sampleRate: ab.sampleRate, channels: ab.numberOfChannels, hz: cross * (ab.sampleRate / (to - from)) };
}
async function inspectGif(blob: Blob) {
  const ID = (globalThis as { ImageDecoder?: new (o: { data: ReadableStream | ArrayBuffer; type: string }) => { tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } }; decode(o: { frameIndex: number }): Promise<{ image: VideoFrame }> } }).ImageDecoder;
  if (!ID) { const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode(); return { width: img.naturalWidth, height: img.naturalHeight }; }
  const d = new ID({ data: await blob.arrayBuffer(), type: 'image/gif' });
  await d.tracks.ready;
  const f = await d.decode({ frameIndex: 0 });
  const r = { frames: d.tracks.selectedTrack.frameCount, width: f.image.displayWidth, height: f.image.displayHeight };
  f.image.close();
  return r;
}

async function inspect(o: { name: string; type: string; buf: ArrayBuffer }) {
  const b = new Uint8Array(o.buf);
  const blob = new Blob([b], { type: o.type });
  const r: Record<string, unknown> = { name: o.name, bytes: b.length, sig: signature(b) };
  try {
    if (o.type.startsWith('video/')) Object.assign(r, { video: await inspectVideo(blob) });
    if (o.type.startsWith('image/gif')) Object.assign(r, { gif: await inspectGif(blob) });
    if (o.type.startsWith('audio/') || o.type.startsWith('video/')) Object.assign(r, { audio: await inspectAudio(blob).catch(e => ({ error: String(e) })) });
  } catch (e) { r.inspectError = String(e); }
  return r;
}

const fixtures = new Map<string, Uint8Array>();
// 다른 엔진(파이어폭스 등)은 엣지에서 만든 같은 시험 영상을 받아 쓴다(video-run.mjs가 /__fx/로 내준다)
async function fixture(key: string, spec: FixtureSpec) {
  if (!fixtures.has(key)) fixtures.set(key, (window as { __served?: boolean }).__served ? new Uint8Array(await (await fetch(`/__fx/${key}`)).arrayBuffer()) : await makeFixture(spec));
  return fixtures.get(key)!;
}

async function probe() {
  const out: Record<string, unknown> = { webcodecs: typeof VideoEncoder !== 'undefined', ua: navigator.userAgent };
  if (typeof VideoEncoder === 'undefined') return out;
  for (const codec of ['avc1.640028', 'vp09.00.40.08', 'vp8', 'hvc1.1.6.L120.B0'])
    out['enc ' + codec] = (await VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720, bitrate: 2e6 })).supported;
  for (const codec of ['avc1.640028', 'hvc1.1.6.L120.B0', 'vp09.00.40.08'])
    out['dec ' + codec] = (await VideoDecoder.isConfigSupported({ codec })).supported;
  for (const codec of ['mp4a.40.2', 'opus'])
    out['aenc ' + codec] = (await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }).catch(() => ({ supported: false }))).supported;
  return out;
}

// 시험 한 건: 시험 영상 만들기 → 변환 → 확인
async function runCase(fxKey: string, spec: FixtureSpec, name: string, options: Record<string, unknown>, cancelAfterMs?: number) {
  const bytes = await fixture(fxKey, spec);
  const r = await convert(bytes, name, options, cancelAfterMs);
  const res: Record<string, unknown> = { ok: r.ok, ms: Math.round(r.ms), inBytes: bytes.length, progressN: r.progress.length, lastProgress: r.progress.at(-1), meta: r.meta, error: r.error, cancelled: r.cancelled };
  if (r.outputs) res.outputs = await Promise.all(r.outputs.map(inspect));
  return res;
}
async function inspectFixture(fxKey: string, spec: FixtureSpec) {
  const b = await fixture(fxKey, spec);
  return inspect({ name: 'fixture', type: spec.container === 'mp4' ? 'video/mp4' : 'video/webm', buf: b.slice().buffer });
}

// WebCodecs가 없는 브라우저: 아무 MP4 머리만 보내도 '지원 안 함'으로 깔끔히 끝나야 한다
async function runNoCodec() {
  const head = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
  const r = await convert(head, 'x.mp4', { to: 'mp4' });
  return { ok: r.ok, error: r.error };
}

async function fixtureBase64(key: string, spec: FixtureSpec) {
  const b = await fixture(key, spec);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

Object.assign(window, { probe, runCase, inspectFixture, runNoCodec, fixtureBase64 });
document.getElementById('log')!.textContent = 'ready';
