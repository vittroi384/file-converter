// 영상·음성 변환. 브라우저 내장 코덱(WebCodecs)으로 풀고 다시 묶는다 — GPL인 ffmpeg.wasm을 쓰지 않으려고.
// 분리: MP4·MOV·M4A는 mp4box(BSD-3), WebM은 직접 쓴 mkv.ts / 묶기: mp4-muxer·webm-muxer(MIT) / GIF: gifenc(MIT)의 인코더 + 직접 쓴 256색(gifpal.ts)
// 다시 인코딩하지 않아도 되는 경우(H.264 → MP4 크기 그대로, AAC → M4A·MP4)는 압축된 프레임을 그대로 옮긴다(화질 손실 0, 빠름).
import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box';
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { GIFEncoder } from 'gifenc/src/index.js'; // 원본 모듈에서: 묶음본(dist)은 안 쓰는 quantize까지 딸려 온다
import { palettize } from './gifpal.ts';
import { ConvertError, type OpContext, type OpRunner } from '../core/types.ts';
import { isWebm, parseMkv } from './mkv.ts';

type Target = 'mp4' | 'webm' | 'gif' | 'm4a';
interface Sample { data: Uint8Array; ts: number; dur: number; key: boolean; cto: number } // 마이크로초. 디코딩 순서, ts는 보여 줄 시각, cto = 보여 줄 시각 − 디코딩 시각
interface VTrack { codec: string; width: number; height: number; description?: Uint8Array; rotation: 0 | 90 | 180 | 270; samples: Sample[] }
interface ATrack { codec: string; sampleRate: number; channels: number; description?: Uint8Array; samples: Sample[] }
interface Media { duration: number; video?: VTrack; audio?: ATrack }

export const GIF_MAX_SECONDS = 30;
const GIF_MAX_PIXELS = 150e6; // 프레임 수 × 화소 수(넘으면 결과가 수십 MB라 쓸모가 없다)
const KEY_EVERY = 2e6; // 키프레임 간격(2초)

const unsupported = (msg: string, detail: string) => new ConvertError('unsupported', msg, detail);

// ── 분리(demux) ──
function demuxMp4(buf: ArrayBuffer): Media {
  const file = createFile();
  let err = '';
  file.onError = (_m: string, msg: string) => { err = msg; };
  file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buf, 0), true);
  file.flush();
  const info = file.getInfo();
  if (!info?.tracks?.length) throw new ConvertError('decode', '영상 파일을 읽을 수 없어요', err || 'no moov');
  const config = (id: number) => {
    const entry = file.getTrackById(id).mdia.minf.stbl.stsd.entries[0] as unknown as Record<string, { write(s: DataStream): void } | undefined> & { esds?: { esd: { findDescriptor(t: number): { findDescriptor(t: number): { data: Uint8Array } | undefined } | undefined } } };
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (box) { const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN); box.write(s); return new Uint8Array(s.buffer, 8); } // 상자 머리 8바이트 빼고
    const dsi = entry.esds?.esd.findDescriptor(4)?.findDescriptor(5); // AAC: AudioSpecificConfig
    return dsi?.data ? new Uint8Array(dsi.data) : undefined;
  };
  const samples = (id: number) => file.getTrackSamplesInfo(id).map(s => ({
    data: new Uint8Array(buf, s.offset, s.size), ts: (s.cts * 1e6) / s.timescale, dur: (s.duration * 1e6) / s.timescale, key: s.is_sync, cto: ((s.cts - s.dts) * 1e6) / s.timescale,
  }));
  const vt = info.videoTracks[0], at = info.audioTracks[0];
  const m = vt?.matrix ? Array.from(vt.matrix) : [0x10000, 0];
  const deg = ((Math.round((Math.atan2(m[1]!, m[0]!) * 180) / Math.PI / 90) * 90) % 360 + 360) % 360;
  return {
    duration: (info.duration * 1e6) / info.timescale,
    video: vt && { codec: vt.codec, width: vt.video?.width ?? vt.track_width, height: vt.video?.height ?? vt.track_height, description: config(vt.id), rotation: deg as VTrack['rotation'], samples: samples(vt.id) },
    audio: at && { codec: at.codec === 'mp4a' ? 'mp4a.40.2' : at.codec, sampleRate: at.audio?.sample_rate ?? 48000, channels: at.audio?.channel_count ?? 2, description: config(at.id), samples: samples(at.id) },
  };
}

const hex = (n: number) => n.toString(16).padStart(2, '0');
function demuxWebm(buf: ArrayBuffer): Media {
  const mkv = parseMkv(new Uint8Array(buf));
  const withDur = (s: { data: Uint8Array; ts: number; key: boolean }[], fallback: number): Sample[] =>
    s.map((x, i) => ({ ...x, cto: 0, dur: i + 1 < s.length ? Math.max(0, s[i + 1]!.ts - x.ts) : fallback }));
  const v = mkv.tracks.find(t => t.type === 'video'), a = mkv.tracks.find(t => t.type === 'audio');
  let video: VTrack | undefined, audio: ATrack | undefined;
  if (v) {
    const cp = v.codecPrivate;
    let codec = '';
    if (v.codecId === 'V_VP8') codec = 'vp8';
    else if (v.codecId === 'V_VP9') {
      // CodecPrivate(있으면): id 1 = 프로필, 3 = 비트 깊이
      let profile = 0, depth = 8;
      for (let i = 0; cp && i + 2 < cp.length; i += 2 + cp[i + 1]!) { if (cp[i] === 1) profile = cp[i + 2]!; if (cp[i] === 3) depth = cp[i + 2]!; }
      codec = `vp09.${hex(profile)}.10.${hex(depth)}`;
    } else if (v.codecId === 'V_AV1' && cp && cp.length >= 4) {
      const depth = cp[2]! & 0x40 ? (cp[1]! >> 5 === 2 && cp[2]! & 0x20 ? 12 : 10) : 8;
      codec = `av01.${cp[1]! >> 5}.${String(cp[1]! & 0x1f).padStart(2, '0')}${cp[2]! & 0x80 ? 'H' : 'M'}.${String(depth).padStart(2, '0')}`;
    } else if (v.codecId === 'V_MPEG4/ISO/AVC' && cp && cp.length > 4) codec = `avc1.${hex(cp[1]!)}${hex(cp[2]!)}${hex(cp[3]!)}`;
    if (!codec) throw unsupported('이 WebM 영상 코덱은 아직 지원하지 않아요', `webm-codec:${v.codecId}`);
    const fd = v.defaultDuration ? v.defaultDuration / 1000 : 33_333;
    video = { codec, width: v.width ?? 0, height: v.height ?? 0, description: v.codecId === 'V_VP8' || v.codecId === 'V_VP9' ? undefined : cp, rotation: 0, samples: withDur(v.samples, fd) };
  }
  if (a) {
    const codec = a.codecId === 'A_OPUS' ? 'opus' : a.codecId === 'A_VORBIS' ? 'vorbis' : a.codecId.startsWith('A_AAC') ? 'mp4a.40.2' : '';
    if (codec) audio = { codec, sampleRate: a.sampleRate ?? 48000, channels: a.channels ?? 2, description: a.codecPrivate, samples: withDur(a.samples, 20_000) };
  }
  return { duration: mkv.duration, video, audio };
}

function demux(buf: ArrayBuffer): Media {
  const head = new Uint8Array(buf, 0, Math.min(12, buf.byteLength));
  try {
    if (isWebm(head)) return demuxWebm(buf);
    if (new TextDecoder().decode(head.subarray(4, 8)).match(/ftyp|moov|mdat|wide|free|skip/)) return demuxMp4(buf);
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    throw new ConvertError('decode', '영상 파일을 읽을 수 없어요', e);
  }
  throw new ConvertError('decode', 'MP4·MOV·WebM 파일이 아니에요', 'unknown container');
}

// 시작 시각을 0으로(편집 목록·B프레임 때문에 첫 시각이 0이 아닌 파일이 많다)
function normalize(m: Media) {
  const firsts = [m.video, m.audio].flatMap(t => (t?.samples.length ? [Math.min(...t.samples.slice(0, 32).map(s => s.ts))] : []));
  const t0 = firsts.length ? Math.min(...firsts) : 0;
  for (const t of [m.video, m.audio]) t?.samples.forEach(s => { s.ts -= t0; });
  const end = Math.max(0, ...[m.video, m.audio].flatMap(t => (t?.samples.length ? [t.samples.at(-1)!.ts + t.samples.at(-1)!.dur] : [])));
  m.duration = Math.max(1, end || m.duration);
}

// ── 크기 ──
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
function outSize(v: VTrack, res: number | undefined, keepOdd = false) {
  const turned = v.rotation === 90 || v.rotation === 270;
  const w = turned ? v.height : v.width, h = turned ? v.width : v.height;
  const k = res && Math.min(w, h) > res ? res / Math.min(w, h) : 1; // res: 짧은 변(1080p·720p·480p)
  return keepOdd ? { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) } : { w: even(w * k), h: even(h * k) };
}

// ── 코덱 고르기 ──
function avcLevel(w: number, h: number, fps: number) {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16), rate = mbs * fps;
  return mbs <= 8192 && rate <= 245_760 ? '28' : mbs <= 8704 && rate <= 522_240 ? '2a' : mbs <= 36_864 && rate <= 983_040 ? '33' : '34';
}
async function videoEncoderConfig(target: 'mp4' | 'webm', w: number, h: number, fps: number, bitrate: number): Promise<VideoEncoderConfig> {
  const lvl = avcLevel(w, h, fps);
  const codecs = target === 'mp4' ? [`avc1.6400${lvl}`, `avc1.4d00${lvl}`, `avc1.4200${lvl}`] : [`vp09.00.${w * h > 2_100_000 ? '51' : '41'}.08`, 'vp8'];
  for (const codec of codecs) {
    const cfg: VideoEncoderConfig = { codec, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality', bitrateMode: 'variable', ...(target === 'mp4' ? { avc: { format: 'avc' } } : {}) };
    if ((await VideoEncoder.isConfigSupported(cfg).catch(() => null))?.supported) return cfg;
  }
  throw unsupported(target === 'mp4' ? '이 브라우저는 MP4(H.264) 저장을 지원하지 않아요. WebM을 골라 주세요.' : '이 브라우저는 WebM(VP9) 저장을 지원하지 않아요. MP4를 골라 주세요.', `encoder:${codecs[0]}:${w}x${h}`);
}
async function audioEncoderConfig(codec: 'aac' | 'opus', a: ATrack): Promise<AudioEncoderConfig | null> {
  const channels = Math.min(2, a.channels);
  const rates = codec === 'opus' ? [48000] : [a.sampleRate, 48000, 44100];
  for (const sampleRate of new Set(rates)) {
    const cfg: AudioEncoderConfig = { codec: codec === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate, numberOfChannels: channels, bitrate: channels > 1 ? 160_000 : 96_000 };
    if ((await AudioEncoder.isConfigSupported(cfg).catch(() => null))?.supported) return cfg;
  }
  return null;
}

// 디코더·인코더 대기열이 너무 길면 잠깐 기다린다(프레임이 메모리에 쌓이지 않게)
const waitQueue = (c: { addEventListener(t: 'dequeue', f: () => void, o: { once: true }): void }) =>
  new Promise<void>(r => { c.addEventListener('dequeue', r, { once: true }); setTimeout(r, 15); });

interface Chunk { data: Uint8Array; ts: number; dur: number; key: boolean; cto: number }

// ── 영상: 풀기 → (돌리기·줄이기) → 다시 인코딩 또는 GIF ──
async function processVideo(v: VTrack, opt: { target: Target; res?: number; fps: number }, duration: number, progress: (v: number) => void) {
  const decCfg: VideoDecoderConfig = { codec: v.codec, codedWidth: v.width, codedHeight: v.height, description: v.description };
  if (!(await VideoDecoder.isConfigSupported(decCfg).catch(() => null))?.supported) {
    const name = /^(hvc1|hev1)/.test(v.codec) ? 'HEVC(H.265)' : /^av01/.test(v.codec) ? 'AV1' : v.codec.split('.')[0];
    throw unsupported(`이 브라우저는 ${name} 영상을 열 수 없어요. 다른 브라우저(크롬·엣지·사파리)에서 해 보세요.`, `decoder:${v.codec}`);
  }
  const gif = opt.target === 'gif';
  const { w, h } = outSize(v, gif ? (opt.res ?? 360) : opt.res, gif);
  const srcFps = Math.min(120, Math.max(1, v.samples.length / (duration / 1e6)));
  const fps = gif ? opt.fps : srcFps;
  if (gif) {
    const frames = Math.ceil((duration / 1e6) * fps);
    if (duration > GIF_MAX_SECONDS * 1e6) throw new ConvertError('too-large', `GIF는 ${GIF_MAX_SECONDS}초 이하 영상만 만들 수 있어요(지금 ${Math.round(duration / 1e6)}초). MP4나 WebM으로 저장해 주세요.`, `gif-seconds:${Math.round(duration / 1e6)}`);
    if (frames * w * h > GIF_MAX_PIXELS) throw new ConvertError('too-large', 'GIF로 만들기엔 화면이 크거나 길어요. 더 작은 크기나 낮은 초당 프레임을 골라 주세요.', `gif-pixels:${frames}x${w}x${h}`);
  }
  const srcBits = (v.samples.reduce((s, x) => s + x.data.byteLength, 0) * 8) / (duration / 1e6);
  const scaleK = (w * h) / (v.width * v.height);
  const bitrate = Math.round(Math.max(250_000, Math.min(w * h * fps * (opt.target === 'mp4' ? 0.1 : 0.07), srcBits * scaleK * 1.2)));
  const encCfg = gif ? null : await videoEncoderConfig(opt.target as 'mp4' | 'webm', w, h, fps, bitrate);

  const canvas = new OffscreenCanvas(w, h);
  const ctx2d = canvas.getContext('2d', { willReadFrequently: gif })!;
  ctx2d.imageSmoothingQuality = 'high';
  const draw = (f: VideoFrame) => {
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    const r = v.rotation;
    if (r === 90) { ctx2d.translate(w, 0); ctx2d.rotate(Math.PI / 2); }
    else if (r === 180) { ctx2d.translate(w, h); ctx2d.rotate(Math.PI); }
    else if (r === 270) { ctx2d.translate(0, h); ctx2d.rotate(-Math.PI / 2); }
    const turned = r === 90 || r === 270;
    ctx2d.drawImage(f, 0, 0, turned ? h : w, turned ? w : h);
  };
  const direct = (f: VideoFrame) => !gif && v.rotation === 0 && f.displayWidth === w && f.displayHeight === h; // 그대로 인코더로

  let failure: unknown = null;
  const out: Chunk[] = [];
  let meta: EncodedVideoChunkMetadata | undefined;
  const encoder = encCfg ? new VideoEncoder({
    output: (c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); out.push({ data: d, ts: c.timestamp, dur: c.duration ?? 0, key: c.type === 'key', cto: 0 }); if (m?.decoderConfig && !meta) meta = m; },
    error: e => { failure ??= new ConvertError('encode', '영상을 저장하지 못했어요', e); },
  }) : null;
  encoder?.configure(encCfg!);

  const gifEnc = gif ? GIFEncoder() : null;
  const step = 1e6 / opt.fps;
  let nextGif = 0, lastKey = -Infinity, done = 0;
  const decoder = new VideoDecoder({
    output: frame => {
      try {
        if (failure) return;
        const t = frame.timestamp;
        done = Math.max(done, t);
        if (gifEnc) {
          if (t + 1000 < nextGif) return; // 1ms 여유
          while (nextGif <= t + 1000) nextGif += step;
          draw(frame);
          const { data } = ctx2d.getImageData(0, 0, w, h);
          const { palette, index } = palettize(data);
          gifEnc.writeFrame(index, w, h, { palette, delay: Math.round(step / 1000) });
          return;
        }
        const key = t - lastKey >= KEY_EVERY;
        if (key) lastKey = t;
        if (direct(frame)) encoder!.encode(frame, { keyFrame: key });
        else {
          draw(frame);
          const f2 = new VideoFrame(canvas, { timestamp: t, duration: frame.duration ?? undefined });
          encoder!.encode(f2, { keyFrame: key });
          f2.close();
        }
      } catch (e) { failure ??= e; } finally { frame.close(); }
    },
    error: e => { failure ??= new ConvertError('decode', '영상을 풀지 못했어요', e); },
  });
  decoder.configure(decCfg);
  try {
    for (const s of v.samples) {
      if (failure) throw failure;
      while (decoder.decodeQueueSize > 6 || (encoder && encoder.encodeQueueSize > 6)) await waitQueue(encoder && encoder.encodeQueueSize > 6 ? encoder : decoder);
      decoder.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: s.ts, duration: s.dur, data: s.data }));
      progress(Math.min(1, done / duration));
    }
    await decoder.flush();
    if (encoder) await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (decoder.state !== 'closed') decoder.close();
    if (encoder && encoder.state !== 'closed') encoder.close();
  }
  if (gifEnc) { gifEnc.finish(); return { gif: gifEnc.bytes(), w, h }; }
  // B프레임을 쓰는 인코더(파이어폭스 H.264 등)는 내보내는 순서가 디코딩 순서이고 시각은 '보여 줄 시각'이라 순서가 섞인다.
  // 디코딩 시각 = 보여 줄 시각을 정렬한 i번째로 만들고, 그 차이를 cto로 넘긴다(음수가 없게 전체를 당긴다).
  const sorted = out.map(c => c.ts).sort((a, b) => a - b);
  let low = 0;
  out.forEach((c, i) => { c.cto = c.ts - sorted[i]!; low = Math.min(low, c.cto); });
  if (low < 0) out.forEach(c => { c.cto -= low; });
  return { chunks: out, meta, codec: encCfg!.codec, w, h, fps };
}

// ── 소리: 그대로 옮기거나 풀어서 다시 인코딩 ──
async function processAudio(a: ATrack, codec: 'aac' | 'opus', progress: (v: number) => void, duration: number) {
  const decCfg: AudioDecoderConfig = { codec: a.codec, sampleRate: a.sampleRate, numberOfChannels: a.channels, description: a.description };
  if (!(await AudioDecoder.isConfigSupported(decCfg).catch(() => null))?.supported) return null;
  const encCfg = await audioEncoderConfig(codec, a);
  if (!encCfg) return null;
  let failure: unknown = null;
  const out: Chunk[] = [];
  let meta: EncodedAudioChunkMetadata | undefined;
  const encoder = new AudioEncoder({
    output: (c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); out.push({ data: d, ts: c.timestamp, dur: c.duration ?? 0, key: true, cto: 0 }); if (m?.decoderConfig && !meta) meta = m; },
    error: e => { failure ??= new ConvertError('encode', '소리를 저장하지 못했어요', e); },
  });
  encoder.configure(encCfg);
  const ch = encCfg.numberOfChannels;
  const decoder = new AudioDecoder({
    output: d => {
      try {
        if (failure) return;
        // 채널 수·표본률이 인코더 설정과 다르면 맞춘다(5.1 → 스테레오는 앞 두 채널, 표본률은 선형 보간)
        if (d.numberOfChannels !== ch || d.sampleRate !== encCfg.sampleRate) {
          const n = Math.max(1, Math.round((d.numberOfFrames * encCfg.sampleRate) / d.sampleRate));
          const planes = new Float32Array(n * ch);
          const src = new Float32Array(d.numberOfFrames);
          for (let c = 0; c < ch; c++) {
            d.copyTo(src, { planeIndex: Math.min(c, d.numberOfChannels - 1), format: 'f32-planar' });
            for (let i = 0; i < n; i++) { const x = (i * d.numberOfFrames) / n, j = Math.floor(x), f = x - j; planes[c * n + i] = src[j]! * (1 - f) + (src[Math.min(j + 1, src.length - 1)]! * f); }
          }
          const fixed = new AudioData({ format: 'f32-planar', sampleRate: encCfg.sampleRate, numberOfFrames: n, numberOfChannels: ch, timestamp: d.timestamp, data: planes });
          encoder.encode(fixed);
          fixed.close();
        } else encoder.encode(d);
      } catch (e) { failure ??= e; } finally { d.close(); }
    },
    error: e => { failure ??= new ConvertError('decode', '소리를 풀지 못했어요', e); },
  });
  decoder.configure(decCfg);
  try {
    for (const s of a.samples) {
      if (failure) throw failure;
      while (decoder.decodeQueueSize > 20 || encoder.encodeQueueSize > 20) await waitQueue(encoder.encodeQueueSize > 20 ? encoder : decoder);
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: s.ts, duration: s.dur, data: s.data }));
      progress(Math.min(1, s.ts / duration));
    }
    await decoder.flush();
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (decoder.state !== 'closed') decoder.close();
    if (encoder.state !== 'closed') encoder.close();
  }
  return { chunks: out, meta, codec, sampleRate: encCfg.sampleRate, channels: ch };
}

// ── 묶기 ──
interface VOut { chunks: Chunk[]; meta?: EncodedVideoChunkMetadata; codec: string; w: number; h: number; fps: number; rotation?: VTrack['rotation'] }
interface AOut { chunks: Chunk[]; meta?: EncodedAudioChunkMetadata; codec: 'aac' | 'opus'; sampleRate: number; channels: number }
function mux(container: 'mp4' | 'webm', vo: VOut | null, ao: AOut | null): ArrayBuffer {
  // 두 트랙을 디코딩 시각 순서로 넣는다(묶개가 첫 시각을 트랙끼리 맞춘다)
  const items = [...(vo?.chunks.map(c => ({ c, v: true })) ?? []), ...(ao?.chunks.map(c => ({ c, v: false })) ?? [])]
    .sort((x, y) => x.c.ts - x.c.cto - (y.c.ts - y.c.cto) || Number(y.v) - Number(x.v));
  const vCodec = vo && (/^avc/.test(vo.codec) ? 'avc' : /^(hvc|hev)/.test(vo.codec) ? 'hevc' : /^vp09/.test(vo.codec) ? 'vp9' : /^vp8/.test(vo.codec) ? 'vp8' : 'av1');
  if (container === 'mp4') {
    const m = new Mp4Muxer({
      target: new Mp4Target(),
      video: vo ? { codec: vCodec as 'avc', width: vo.w, height: vo.h, rotation: vo.rotation ?? 0, frameRate: Math.round(vo.fps) } : undefined,
      audio: ao ? { codec: ao.codec, numberOfChannels: ao.channels, sampleRate: ao.sampleRate } : undefined,
      fastStart: 'in-memory', firstTimestampBehavior: 'cross-track-offset',
    });
    let vFirst = true, aFirst = true;
    for (const { c, v } of items) {
      if (v) { m.addVideoChunkRaw(c.data, c.key ? 'key' : 'delta', c.ts, c.dur, vFirst ? vo!.meta : undefined, c.cto); vFirst = false; }
      else { m.addAudioChunkRaw(c.data, 'key', c.ts, c.dur, aFirst ? ao!.meta : undefined); aFirst = false; }
    }
    m.finalize();
    return m.target.buffer;
  }
  const m = new WebmMuxer({
    target: new WebmTarget(),
    video: vo ? { codec: vCodec === 'vp8' ? 'V_VP8' : vCodec === 'av1' ? 'V_AV1' : 'V_VP9', width: vo.w, height: vo.h, frameRate: Math.round(vo.fps) } : undefined,
    audio: ao ? { codec: 'A_OPUS', numberOfChannels: ao.channels, sampleRate: ao.sampleRate } : undefined,
    firstTimestampBehavior: 'permissive',
  });
  let vFirst = true, aFirst = true;
  for (const { c, v } of items) {
    if (v) { m.addVideoChunkRaw(c.data, c.key ? 'key' : 'delta', c.ts, vFirst ? vo!.meta : undefined); vFirst = false; }
    else { m.addAudioChunkRaw(c.data, 'key', c.ts, aFirst ? ao!.meta : undefined); aFirst = false; }
  }
  m.finalize();
  return m.target.buffer;
}

// 압축된 소리를 그대로 옮긴다(AAC → MP4·M4A, Opus → WebM)
function copyAudio(a: ATrack, codec: 'aac' | 'opus'): AOut {
  return {
    chunks: a.samples.map(s => ({ ...s, key: true, cto: 0 })), codec, sampleRate: a.sampleRate, channels: a.channels,
    meta: { decoderConfig: { codec: a.codec, sampleRate: a.sampleRate, numberOfChannels: a.channels, description: a.description } },
  };
}

export const run: OpRunner = async (inputs, o, ctx: OpContext) => {
  const p = inputs[0]!;
  const target = String(o.to ?? 'mp4') as Target;
  const res = o.res ? Number(o.res) : undefined;
  const fps = Number(o.fps ?? 10);
  if (typeof AudioDecoder === 'undefined' || (target !== 'm4a' && typeof VideoDecoder === 'undefined'))
    throw unsupported('이 브라우저는 영상 변환(WebCodecs)을 지원하지 않아요. 최신 크롬·엣지·파이어폭스에서 열어 주세요.', 'no-webcodecs');
  let shown = 0;
  const progress = ctx.progress;
  ctx = { progress: (v, n) => { if (v - shown >= 0.005 || v >= 0.97) { shown = v; progress(v, n); } } };
  ctx.progress(0.02, 'open');
  const media = demux(p.buf);
  normalize(media);
  const base = p.name.replace(/\.[^.]+$/, '');
  const { video, audio } = media;
  const dur = media.duration;
  ctx.progress(0.05, 'demux');

  if (target === 'gif') {
    if (!video) throw unsupported('영상이 없는 파일이에요. 음성(M4A)으로 저장을 골라 주세요.', 'no-video');
    const r = await processVideo(video, { target, res, fps }, dur, v => ctx.progress(0.05 + 0.93 * v, 'gif'));
    if (!r.gif) throw new ConvertError('unknown', 'GIF 실패');
    return { outputs: [{ name: `${base}.gif`, type: 'image/gif', buf: r.gif.buffer as ArrayBuffer }], meta: { width: r.w, height: r.h, seconds: Math.round(dur / 1e5) / 10 } };
  }

  if (target === 'm4a') {
    if (!audio) throw unsupported('소리가 없는 영상이에요.', 'no-audio');
    let ao: AOut | null = /^mp4a\.40/.test(audio.codec) ? copyAudio(audio, 'aac') : await processAudio(audio, 'aac', v => ctx.progress(0.05 + 0.9 * v, 'audio'), dur);
    // AAC 인코더가 없는 브라우저(파이어폭스 등): Opus를 WebM에 담는다
    if (!ao) {
      ao = audio.codec === 'opus' ? copyAudio(audio, 'opus') : await processAudio(audio, 'opus', v => ctx.progress(0.05 + 0.9 * v, 'audio'), dur);
      if (!ao) throw unsupported('이 브라우저에선 이 영상의 소리를 바꿀 수 없어요.', `audio:${audio.codec}`);
      return { outputs: [{ name: `${base}.webm`, type: 'audio/webm', buf: mux('webm', null, ao) }], meta: { seconds: Math.round(dur / 1e5) / 10, audio: 'opus' } };
    }
    return { outputs: [{ name: `${base}.m4a`, type: 'audio/mp4', buf: mux('mp4', null, ao) }], meta: { seconds: Math.round(dur / 1e5) / 10, audio: 'aac' } };
  }

  // MP4 · WebM
  if (!video) throw unsupported('영상이 없는 파일이에요. 음성(M4A)으로 저장을 골라 주세요.', 'no-video');
  // 코덱이 같고 줄이지 않으면 다시 인코딩하지 않는다(MOV(H.264) → MP4가 대표적)
  const scaled = res !== undefined && Math.min(video.width, video.height) > res;
  const copyVideo = !scaled && (target === 'mp4' ? /^avc1/.test(video.codec) && !!video.description : /^vp0?[89]/.test(video.codec));
  let vo: VOut;
  const hasAudio = !!audio?.samples.length;
  const vShare = hasAudio ? 0.8 : 0.93;
  if (copyVideo) {
    vo = {
      chunks: video.samples, codec: video.codec, w: video.width, h: video.height, fps: video.samples.length / (dur / 1e6), rotation: video.rotation,
      meta: { decoderConfig: { codec: video.codec, codedWidth: video.width, codedHeight: video.height, description: video.description } },
    };
  } else {
    const r = await processVideo(video, { target, res, fps }, dur, v => ctx.progress(0.05 + vShare * v, 'video'));
    if (!r.chunks) throw new ConvertError('unknown', '영상 실패');
    vo = r as VOut;
  }
  let ao: AOut | null = null, audioNote = 'none';
  if (audio && hasAudio) {
    const want: 'aac' | 'opus' = target === 'mp4' ? 'aac' : 'opus';
    const same = want === 'aac' ? /^mp4a\.40/.test(audio.codec) : audio.codec === 'opus';
    ao = same ? copyAudio(audio, want) : await processAudio(audio, want, v => ctx.progress(0.05 + vShare + (0.93 - vShare) * v, 'audio'), dur);
    // MP4인데 AAC 인코더가 없으면 Opus를 MP4에 담는다(최신 브라우저·VLC는 재생, 옛 플레이어는 소리 없이 재생될 수 있음)
    if (!ao && want === 'aac') ao = await processAudio(audio, 'opus', () => {}, dur);
    audioNote = ao ? ao.codec : 'dropped';
  }
  ctx.progress(0.97, 'mux');
  const buf = mux(target, vo, ao);
  return {
    outputs: [{ name: `${base}.${target}`, type: target === 'mp4' ? 'video/mp4' : 'video/webm', buf }],
    meta: { width: vo.rotation && vo.rotation % 180 ? vo.h : vo.w, height: vo.rotation && vo.rotation % 180 ? vo.w : vo.h, seconds: Math.round(dur / 1e5) / 10, copied: copyVideo, audio: audioNote },
  };
};
