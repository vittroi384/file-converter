// 오류 밑에 보일 구체적 이유. 워커가 detail에 남긴 기계용 표식(예: 'gif-seconds:42')을 사전 문구로 바꾼다.
// 사용자에게 보여도 되는 이유는 이 목록에 있는 표식뿐이다(코드 unsupported·too-large만).
// 그 밖의 detail(라이브러리 메시지·옵션 검사 결과 등)은 화면에 내지 않는다 — 번역도 없고 개인정보가 섞일 수 있다.
import type { Dict } from '../i18n/types.ts';

const codecName = (c: string) =>
  /^(hvc1|hev1)/.test(c) ? 'HEVC (H.265)' : /^av01/.test(c) ? 'AV1' : /^avc/.test(c) ? 'H.264' : /^vp0?9/.test(c) ? 'VP9' : /^vp0?8/.test(c) ? 'VP8' : c.split('.')[0]!;

export function errorReason(t: Dict, e: unknown): string | null {
  const { code, detail } = (e ?? {}) as { code?: string; detail?: string };
  if ((code !== 'unsupported' && code !== 'too-large') || typeof detail !== 'string') return null;
  const r = t.reasons;
  const i = detail.indexOf(':');
  const tag = i < 0 ? detail : detail.slice(0, i), rest = i < 0 ? '' : detail.slice(i + 1);
  if (detail === 'no-webcodecs') return r.noWebcodecs;
  if (detail === 'no-video') return r.noVideo;
  if (detail === 'no-audio') return r.noAudio;
  if (tag === 'encoder') return rest.startsWith('avc') ? r.encoderMp4 : r.encoderWebm;
  if (tag === 'decoder') return r.videoCodec(codecName(rest));
  if (tag === 'webm-codec') return r.videoCodec(rest.replace(/^V_/, ''));
  if (tag === 'audio') return r.audioCodec;
  if (tag === 'gif-seconds' && /^\d+$/.test(rest)) return r.gifSeconds(Number(rest));
  if (tag === 'gif-pixels') return r.gifPixels;
  return null;
}
