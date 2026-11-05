// Worker 풀: 동시 실행 수 제한, 대기열, 취소, 시간 초과, 워커 충돌 복구.
import type { ErrorCode } from '@fc/shared';
import { ConvertError, type FilePayload, type OutputMeta, type RunRequest, type WorkerMessage } from './types.ts';

export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: WorkerMessage }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface TaskResult {
  outputs: FilePayload[];
  meta?: OutputMeta;
}

interface Task {
  req: RunRequest;
  resolve(r: TaskResult): void;
  reject(e: ConvertError): void;
  onProgress?: (v: number, note?: string) => void;
  timeoutMs: number;
  cost: number; // 예상 메모리(바이트). 0이면 제한 없음
}

interface Slot {
  worker: WorkerLike;
  task: Task | null;
  timer: ReturnType<typeof setTimeout> | null;
  heavy: boolean; // 큰 작업을 한 적 있음 → 끝나면 새 워커로(WASM 메모리는 한 번 늘면 줄지 않는다)
}

export interface PoolOptions {
  size: number;
  create: () => WorkerLike;
  defaultTimeoutMs?: number;
  // 동시에 돌리는 작업들의 예상 메모리 합 상한. 큰 사진 100장을 6개씩 돌리다 3.5GB까지 갔다(devlog 12절)
  memoryBudget?: number;
  // 이보다 큰 작업을 마친 워커는 버리고 새로 만든다
  recycleAbove?: number;
}

export class WorkerPool {
  private slots: Slot[] = [];
  private queue: Task[] = [];
  private nextId = 1;
  private opts: Required<PoolOptions>;
  stats = { spawned: 0, crashed: 0, timedOut: 0, cancelled: 0, completed: 0, recycled: 0, maxInflightCost: 0 };

  constructor(opts: PoolOptions) {
    // 스프레드로 합치면 { defaultTimeoutMs: undefined } 가 기본값을 덮어 0ms 시간 초과가 된다(테스트로 발견)
    this.opts = {
      ...opts,
      defaultTimeoutMs: opts.defaultTimeoutMs ?? 5 * 60_000,
      memoryBudget: opts.memoryBudget ?? Infinity,
      recycleAbove: opts.recycleAbove ?? Infinity,
    };
  }

  get inflightCost() { return this.slots.reduce((s, x) => s + (x.task?.cost ?? 0), 0); }

  get size() { return this.opts.size; }
  get busy() { return this.slots.filter(s => s.task).length; }
  get pending() { return this.queue.length; }

  run(req: Omit<RunRequest, 'type' | 'id'>, opts: { onProgress?: Task['onProgress']; timeoutMs?: number; cost?: number } = {}) {
    const id = this.nextId++;
    const promise = new Promise<TaskResult>((resolve, reject) => {
      this.queue.push({
        req: { type: 'run', id, ...req },
        resolve, reject,
        onProgress: opts.onProgress,
        timeoutMs: opts.timeoutMs ?? this.opts.defaultTimeoutMs,
        cost: Math.max(0, opts.cost ?? 0),
      });
    });
    this.pump();
    return { id, promise };
  }

  cancel(id: number) {
    const qi = this.queue.findIndex(t => t.req.id === id);
    if (qi >= 0) {
      const [t] = this.queue.splice(qi, 1);
      this.stats.cancelled++;
      t!.reject(new ConvertError('cancelled', '취소됨'));
      return true;
    }
    const slot = this.slots.find(s => s.task?.req.id === id);
    if (!slot) return false;
    this.stats.cancelled++;
    this.kill(slot, 'cancelled', '취소됨');
    return true;
  }

  destroy() {
    for (const t of this.queue.splice(0)) t.reject(new ConvertError('cancelled', '풀 종료'));
    for (const s of this.slots) {
      if (s.timer) clearTimeout(s.timer);
      s.task?.reject(new ConvertError('cancelled', '풀 종료'));
      s.worker.terminate();
    }
    this.slots = [];
  }

  private spawn(): Slot {
    const slot: Slot = { worker: this.opts.create(), task: null, timer: null, heavy: false };
    this.stats.spawned++;
    this.wire(slot);
    return slot;
  }

  private wire(slot: Slot) {
    slot.worker.onmessage = e => this.onMessage(slot, e.data);
    slot.worker.onerror = () => {
      this.stats.crashed++;
      this.kill(slot, 'worker-crash', '변환 작업자가 멈췄어요');
    };
  }

  private onMessage(slot: Slot, msg: WorkerMessage) {
    const task = slot.task;
    if (!task || msg.id !== task.req.id) return; // 늦게 도착한 옛 메시지 무시
    if (msg.type === 'progress') { task.onProgress?.(msg.value, msg.note); return; }
    this.finish(slot);
    if (msg.type === 'done') { this.stats.completed++; task.resolve({ outputs: msg.outputs, meta: msg.meta }); }
    else { const e = new ConvertError(msg.code, msg.message); e.detail = msg.detail; task.reject(e); }
    if (slot.heavy) this.recycle(slot);
    this.pump();
  }

  private finish(slot: Slot) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.task = null;
  }

  // 큰 작업을 마친 워커는 지우고 빈자리로 둔다(필요할 때 새로 만든다)
  private recycle(slot: Slot) {
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.terminate();
    this.slots = this.slots.filter(s => s !== slot);
    this.stats.recycled++;
  }

  // 실행 중인 워커를 버리고 새 워커로 교체한다(WASM은 중간에 멈출 수 없으므로)
  private kill(slot: Slot, code: ErrorCode, message: string) {
    const task = slot.task;
    this.finish(slot);
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.terminate();
    slot.worker = this.opts.create();
    slot.heavy = false;
    this.stats.spawned++;
    this.wire(slot);
    task?.reject(new ConvertError(code, message));
    this.pump();
  }

  private pump() {
    while (this.queue.length) {
      // 메모리 예산: 이미 도는 작업이 있으면, 예산을 넘기는 다음 작업은 기다린다(혼자서 예산을 넘는 작업은 혼자 돌린다)
      const next = this.queue[0]!;
      if (this.busy > 0 && this.inflightCost + next.cost > this.opts.memoryBudget) return;
      let slot = this.slots.find(s => !s.task);
      if (!slot) {
        if (this.slots.length >= this.opts.size) return;
        slot = this.spawn();
        this.slots.push(slot);
      }
      const task = this.queue.shift()!;
      slot.task = task;
      if (task.cost > this.opts.recycleAbove) slot.heavy = true;
      const s = slot;
      s.timer = setTimeout(() => {
        this.stats.timedOut++;
        this.kill(s, 'timeout', '시간이 너무 오래 걸려서 멈췄어요');
      }, task.timeoutMs);
      this.stats.maxInflightCost = Math.max(this.stats.maxInflightCost, this.inflightCost);
      // 입력 버퍼는 복사하지 않고 넘긴다(transfer). 넘긴 뒤 메인 쪽 버퍼는 비게 된다.
      s.worker.postMessage(task.req, task.req.inputs.map(i => i.buf));
    }
  }
}

export function defaultPoolSize(hw = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) {
  // 화면 스레드 몫 하나는 남기고, 메모리 폭주를 막으려 최대 6개
  return Math.max(1, Math.min(6, (hw || 4) - 1));
}
