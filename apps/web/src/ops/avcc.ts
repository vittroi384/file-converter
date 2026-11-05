// H.264 avcC(재생기가 화면 크기를 읽는 설정) 고치기.
// 리눅스 파이어폭스 인코더는 avcC 안 SPS·PPS 앞에 NAL 머리 바이트를 한 번 더 넣는다(67 67 64 …, 68 68 …).
// 이대로 묶으면 재생기가 깨진 SPS를 읽어 크기를 엉뚱하게(640×360 → 16×160) 판정한다.
// 첫 키프레임 안에 든 실제 SPS·PPS(4바이트 길이 + NAL)와 다를 때만 그것으로 다시 만든다. 같으면 그대로 둔다.

function nals(chunk: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let p = 0; p + 4 <= chunk.length; ) {
    const n = ((chunk[p]! << 24) | (chunk[p + 1]! << 16) | (chunk[p + 2]! << 8) | chunk[p + 3]!) >>> 0;
    p += 4;
    if (n === 0 || p + n > chunk.length) break;
    out.push(chunk.subarray(p, p + n));
    p += n;
  }
  return out;
}

function firstParams(desc: Uint8Array): { sps?: Uint8Array; pps?: Uint8Array } {
  if (desc.length < 7 || desc[0] !== 1) return {};
  let p = 5;
  const nSps = desc[p++]! & 0x1f;
  let sps: Uint8Array | undefined;
  for (let i = 0; i < nSps; i++) {
    const len = (desc[p]! << 8) | desc[p + 1]!;
    if (i === 0) sps = desc.subarray(p + 2, p + 2 + len);
    p += 2 + len;
  }
  if (p >= desc.length) return { sps };
  const nPps = desc[p++]!;
  const pps = nPps ? desc.subarray(p + 2, p + 2 + ((desc[p]! << 8) | desc[p + 1]!)) : undefined;
  return { sps, pps };
}

const same = (a?: Uint8Array, b?: Uint8Array) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

export function repairAvcC(desc: Uint8Array | undefined, keyChunk: Uint8Array): Uint8Array | undefined {
  const inBand = nals(keyChunk);
  const sps = inBand.find(n => (n[0]! & 0x1f) === 7);
  const pps = inBand.find(n => (n[0]! & 0x1f) === 8);
  if (!sps || !pps || sps.length < 4) return desc; // 키프레임에 SPS·PPS가 없으면 비교할 것이 없다
  if (desc) {
    const cur = firstParams(desc);
    if (same(cur.sps, sps) && same(cur.pps, pps)) return desc;
  }
  const out = new Uint8Array(11 + sps.length + pps.length);
  out.set([1, sps[1]!, sps[2]!, sps[3]!, 0xff, 0xe1, sps.length >> 8, sps.length & 0xff], 0);
  out.set(sps, 8);
  let p = 8 + sps.length;
  out.set([1, pps.length >> 8, pps.length & 0xff], p);
  out.set(pps, p + 3);
  return out;
}
