// 통계 이벤트 검증 스키마(서버에서 사용). 브라우저는 타입만 가져다 쓴다.
import { z } from 'zod';
import { OPS, FORMATS, ERROR_CODES, VITALS, RATINGS, PATHS, LOCALE_CODES, REF_SOURCES } from './index.ts';

const MAX_BYTES = 4 * 1024 ** 3; // 4GB 넘는 값은 거짓으로 본다
const MAX_MS = 30 * 60 * 1000;

export const ConversionEvent = z.object({
  t: z.literal('conv'),
  op: z.enum(OPS),
  from: z.enum(FORMATS),
  to: z.enum(FORMATS),
  ok: z.boolean(),
  ms: z.number().nonnegative().max(MAX_MS),
  inBytes: z.number().int().nonnegative().max(MAX_BYTES),
  outBytes: z.number().int().nonnegative().max(MAX_BYTES).optional(),
  err: z.enum(ERROR_CODES).optional(),
  files: z.number().int().min(1).max(1000).default(1),
});

export const VitalEvent = z.object({
  t: z.literal('vital'),
  name: z.enum(VITALS),
  value: z.number().nonnegative().max(600_000),
  rating: z.enum(RATINGS),
});

// 오류 상세는 지표가 아니라 로그(VictoriaLogs)로 간다. msg는 서버에서 한 번 더 걸러낸다.
export const ErrorEvent = z.object({
  t: z.literal('err'),
  where: z.enum([...OPS, 'ui', 'worker', 'pwa'] as const),
  code: z.enum(ERROR_CODES),
  msg: z.string().max(300).default(''),
});

export const PageViewEvent = z.object({
  t: z.literal('pv'),
  path: z.enum(PATHS),
  locale: z.enum(LOCALE_CODES).default('en'),
  ref: z.enum(REF_SOURCES).default('direct'),
});

export const TelemetryEvent = z.discriminatedUnion('t', [ConversionEvent, VitalEvent, ErrorEvent, PageViewEvent]);
export type TelemetryEvent = z.infer<typeof TelemetryEvent>;

export const TelemetryBatch = z.object({
  v: z.literal(1),
  events: z.array(z.unknown()).min(1).max(50),
});
