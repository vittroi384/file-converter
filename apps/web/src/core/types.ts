import type { ErrorCode, Op } from '@fc/shared';

export interface FilePayload {
  name: string;
  type: string;
  buf: ArrayBuffer;
}

export type Options = Record<string, string | number | boolean | number[] | undefined>;

export interface RunRequest {
  type: 'run';
  id: number;
  op: Op;
  inputs: FilePayload[];
  options: Options;
}

export interface OutputMeta {
  // 변환기마다 덧붙이는 정보(예: 스마트 압축의 SSIM, 탐색 횟수)
  [k: string]: string | number | boolean | undefined;
}

export type WorkerMessage =
  | { type: 'progress'; id: number; value: number; note?: string }
  | { type: 'done'; id: number; outputs: FilePayload[]; meta?: OutputMeta }
  | { type: 'error'; id: number; code: ErrorCode; message: string; detail?: string };

// message: 사용자에게 보여 줄 문구 / detail: 원래 원인(개인정보 걸러서 관리자 오류 로그로)
export class ConvertError extends Error {
  code: ErrorCode;
  detail?: string;
  info?: Record<string, number>; // 화면 안내용 숫자(예: too-large의 필요·한도 바이트)
  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ConvertError';
    this.code = code;
    if (cause !== undefined) this.detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  }
}

// instanceof 대신 이걸 쓴다: WebKit은 워커 진입 모듈을 import하면 한 벌 더 띄워서
// ConvertError 클래스가 둘이 되고 instanceof가 거짓이 됐다(원인이 '변환 중 문제'로 가려짐, devlog 10절)
export function isConvertError(e: unknown): e is ConvertError {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'ConvertError' && typeof (e as { code?: unknown }).code === 'string';
}

// 워커 안에서 실행되는 변환 함수의 모양
export interface OpContext {
  progress(value: number, note?: string): void;
}
export type OpRunner = (inputs: FilePayload[], options: Options, ctx: OpContext) => Promise<{ outputs: FilePayload[]; meta?: OutputMeta }>;
