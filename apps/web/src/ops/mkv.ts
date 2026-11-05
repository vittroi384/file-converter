// WebM(Matroska) 읽기: 트랙 정보와 압축된 프레임(블록)만 꺼낸다. 디코딩은 WebCodecs가 한다.
// 라이브러리 대신 직접 쓴 이유: 필요한 건 요소 20개 남짓이고, 쓸 만한 JS 분리기는 대부분 GPL이거나 덩치가 크다.
// 브라우저 녹화본(MediaRecorder)은 Segment·Cluster 크기가 '모름'(전부 1)이라, 큰 상자는 건너뛰지 않고 안으로 들어가며 읽는다.

export interface MkvSample { data: Uint8Array; ts: number; key: boolean } // ts: 마이크로초
export interface MkvTrack {
  number: number; type: 'video' | 'audio' | 'other'; codecId: string; codecPrivate?: Uint8Array;
  width?: number; height?: number; sampleRate?: number; channels?: number; defaultDuration?: number; // ns
  samples: MkvSample[];
}
export interface Mkv { duration: number; tracks: MkvTrack[] } // duration: 마이크로초(모르면 마지막 블록 시각)

const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63a2, DefaultDuration: 0x23e383,
  Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, Audio: 0xe1, SamplingFrequency: 0xb5, Channels: 0x9f,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, ReferenceBlock: 0xfb,
};
// 안으로 들어가며 읽는 상자(나머지는 크기만큼 건너뛴다)
const DESCEND = new Set([ID.Segment, ID.Info, ID.Tracks, ID.TrackEntry, ID.Video, ID.Audio, ID.Cluster]);

function vint(b: Uint8Array, p: number, keepMarker: boolean): { v: number; len: number; unknown: boolean } {
  const first = b[p]!;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > b.length) throw new Error('EBML 길이 오류');
  let v = keepMarker ? first : first & (0xff >> len);
  let allOnes = (first & (0xff >> len)) === 0xff >> len;
  for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]!; if (b[p + i] !== 0xff) allOnes = false; }
  return { v, len, unknown: allOnes };
}
const uint = (b: Uint8Array, p: number, n: number) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]!; return v; };
const float = (b: Uint8Array, p: number, n: number) => { const d = new DataView(b.buffer, b.byteOffset + p, n); return n === 4 ? d.getFloat32(0) : d.getFloat64(0); };

export function isWebm(b: Uint8Array) { return b.length > 4 && uint(b, 0, 4) === ID.EBML; }

export function parseMkv(b: Uint8Array): Mkv {
  if (!isWebm(b)) throw new Error('WebM 머리가 아님');
  const tracks: MkvTrack[] = [];
  let scale = 1_000_000; // TimecodeScale(ns), 기본 1ms
  let durationTicks = 0;
  let cur: MkvTrack | null = null;
  let clusterTime = 0;
  let last = 0;
  const byNum = new Map<number, MkvTrack>();

  const addBlock = (p: number, end: number, simple: boolean, keyHint: boolean) => {
    const tn = vint(b, p, false);
    const t = byNum.get(tn.v);
    let q = p + tn.len;
    const rel = (b[q]! << 24 >> 16) | b[q + 1]!; // 부호 있는 16비트
    const flags = b[q + 2]!;
    q += 3;
    if (!t) return;
    const ts = ((clusterTime + rel) * scale) / 1000;
    const key = simple ? (flags & 0x80) !== 0 : keyHint;
    const lacing = (flags >> 1) & 3;
    const frameDur = t.defaultDuration ? t.defaultDuration / 1000 : 0;
    if (!lacing) { t.samples.push({ data: b.subarray(q, end), ts, key }); last = Math.max(last, ts + frameDur); return; }
    // 묶음(lacing): 블록 하나에 프레임 여러 개(주로 오디오)
    const count = b[q++]! + 1;
    const sizes: number[] = [];
    if (lacing === 1) { // Xiph
      for (let i = 0; i < count - 1; i++) { let s = 0, x; do { x = b[q++]!; s += x; } while (x === 255); sizes.push(s); }
    } else if (lacing === 3) { // EBML: 첫 크기 + 부호 있는 차이
      const f = vint(b, q, false); q += f.len; sizes.push(f.v);
      for (let i = 1; i < count - 1; i++) {
        const d = vint(b, q, false); q += d.len;
        sizes.push(sizes[i - 1]! + d.v - (2 ** (7 * d.len - 1) - 1));
      }
    } else { // 고정 크기
      const s = (end - q) / count;
      for (let i = 0; i < count - 1; i++) sizes.push(s);
    }
    sizes.push(end - q - sizes.reduce((a, c) => a + c, 0));
    sizes.forEach((s, i) => { t.samples.push({ data: b.subarray(q, q + s), ts: ts + i * frameDur, key: key || i > 0 }); q += s; });
    last = Math.max(last, ts + count * frameDur);
  };

  let p = 0;
  while (p < b.length) {
    let id: ReturnType<typeof vint>, size: ReturnType<typeof vint>;
    try { id = vint(b, p, true); size = vint(b, p + id.len, false); } catch { break; } // 잘린 파일: 읽은 데까지
    const start = p + id.len + size.len;
    const end = size.unknown ? b.length : Math.min(b.length, start + size.v);
    if (DESCEND.has(id.v)) {
      if (id.v === ID.TrackEntry) { cur = { number: 0, type: 'other', codecId: '', samples: [] }; tracks.push(cur); }
      p = start;
      continue;
    }
    switch (id.v) {
      case ID.TimecodeScale: scale = uint(b, start, end - start); break;
      case ID.Duration: durationTicks = float(b, start, end - start); break;
      case ID.TrackNumber: if (cur) { cur.number = uint(b, start, end - start); byNum.set(cur.number, cur); } break;
      case ID.TrackType: if (cur) { const v = uint(b, start, end - start); cur.type = v === 1 ? 'video' : v === 2 ? 'audio' : 'other'; } break;
      case ID.CodecID: if (cur) cur.codecId = new TextDecoder().decode(b.subarray(start, end)).replace(/\0+$/, ''); break;
      case ID.CodecPrivate: if (cur) cur.codecPrivate = b.slice(start, end); break;
      case ID.DefaultDuration: if (cur) cur.defaultDuration = uint(b, start, end - start); break;
      case ID.PixelWidth: if (cur) cur.width = uint(b, start, end - start); break;
      case ID.PixelHeight: if (cur) cur.height = uint(b, start, end - start); break;
      case ID.SamplingFrequency: if (cur) cur.sampleRate = float(b, start, end - start); break;
      case ID.Channels: if (cur) cur.channels = uint(b, start, end - start); break;
      case ID.Timecode: clusterTime = uint(b, start, end - start); break;
      case ID.SimpleBlock: addBlock(start, end, true, false); break;
      case ID.BlockGroup: {
        // 참조 블록(ReferenceBlock)이 없으면 키프레임
        let q = start, blk: [number, number] | null = null, ref = false;
        while (q < end) {
          const cid = vint(b, q, true), cs = vint(b, q + cid.len, false), cst = q + cid.len + cs.len;
          if (cid.v === ID.Block) blk = [cst, Math.min(end, cst + cs.v)];
          if (cid.v === ID.ReferenceBlock) ref = true;
          q = cst + cs.v;
        }
        if (blk) addBlock(blk[0], blk[1], false, !ref);
        break;
      }
    }
    p = end;
  }
  const duration = durationTicks ? (durationTicks * scale) / 1000 : last;
  return { duration: Math.max(duration, last), tracks: tracks.filter(t => t.number > 0) };
}
