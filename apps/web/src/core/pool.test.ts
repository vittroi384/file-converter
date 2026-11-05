import { describe, it, expect } from 'vitest';
import { WorkerPool, type WorkerLike, defaultPoolSize } from './pool.ts';
import type { RunRequest, WorkerMessage } from './types.ts';

// 가짜 워커: options.mode 로 동작을 고른다
class FakeWorker implements WorkerLike {
  static live = 0;
  static maxLive = 0;
  static terminated = 0;
  static transfers: number[] = [];
  onmessage: ((e: { data: WorkerMessage }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private dead = false;
  postMessage(msg: unknown, transfer?: Transferable[]) {
    const req = msg as RunRequest;
    FakeWorker.transfers.push(transfer?.length ?? 0);
    const { mode = 'ok', delay = 5 } = req.options as { mode?: string; delay?: number };
    FakeWorker.live++;
    FakeWorker.maxLive = Math.max(FakeWorker.maxLive, FakeWorker.live);
    const emit = (data: WorkerMessage) => { if (this.onmessage) this.onmessage({ data }); };
    setTimeout(() => emit({ type: 'progress', id: req.id, value: 0.5 }), 1);
    setTimeout(() => {
      FakeWorker.live--;
      if (mode === 'hang') return;
      if (mode === 'crash') { this.onerror?.(new Error('boom')); return; }
      // 종료된 워커가 늦게 보내는 메시지도 흉내 낸다(풀이 무시해야 함)
      if (this.dead && mode !== 'zombie') return;
      if (mode === 'fail') emit({ type: 'error', id: req.id, code: 'decode', message: 'bad' });
      else emit({ type: 'done', id: req.id, outputs: [{ name: 'out', type: 'x', buf: new ArrayBuffer(1) }], meta: { n: req.id } });
    }, delay);
  }
  terminate() { this.dead = true; FakeWorker.terminated++; }
}

const reset = () => { FakeWorker.live = 0; FakeWorker.maxLive = 0; FakeWorker.terminated = 0; FakeWorker.transfers = []; };
const input = () => [{ name: 'a.png', type: 'image/png', buf: new ArrayBuffer(8) }];
const mk = (size = 2, defaultTimeoutMs?: number) => new WorkerPool({ size, create: () => new FakeWorker(), defaultTimeoutMs });

describe('WorkerPool', () => {
  it('작업을 끝내고 진행률을 전달한다', async () => {
    reset();
    const pool = mk();
    const prog: number[] = [];
    const r = await pool.run({ op: 'image', inputs: input(), options: {} }, { onProgress: v => prog.push(v) }).promise;
    expect(r.outputs).toHaveLength(1);
    expect(prog).toEqual([0.5]);
    expect(FakeWorker.transfers[0]).toBe(1); // 버퍼를 복사 대신 이전
  });

  it('동시 실행 수를 넘지 않고, 들어온 순서대로 처리한다', async () => {
    reset();
    const pool = mk(3);
    const order: number[] = [];
    const jobs = Array.from({ length: 10 }, (_, i) =>
      pool.run({ op: 'image', inputs: input(), options: { delay: 10 } }).promise.then(r => order.push(r.meta!.n as number)));
    await Promise.all(jobs);
    expect(FakeWorker.maxLive).toBe(3);
    expect(pool.stats.spawned).toBe(3); // 워커 재사용
    expect(order.slice(0, 3).sort()).toEqual([1, 2, 3]);
  });

  it('대기 중인 작업 취소', async () => {
    reset();
    const pool = mk(1);
    const a = pool.run({ op: 'image', inputs: input(), options: { delay: 20 } });
    const b = pool.run({ op: 'image', inputs: input(), options: {} });
    expect(pool.cancel(b.id)).toBe(true);
    await expect(b.promise).rejects.toMatchObject({ code: 'cancelled' });
    await expect(a.promise).resolves.toBeTruthy();
    expect(FakeWorker.terminated).toBe(0); // 대기 중 취소는 워커를 죽이지 않음
  });

  it('실행 중 취소: 워커 교체, 늦은 메시지 무시, 다음 작업은 정상', async () => {
    reset();
    const pool = mk(1);
    const a = pool.run({ op: 'image', inputs: input(), options: { delay: 30, mode: 'zombie' } });
    const b = pool.run({ op: 'image', inputs: input(), options: { delay: 50 } });
    await new Promise(r => setTimeout(r, 5));
    pool.cancel(a.id);
    await expect(a.promise).rejects.toMatchObject({ code: 'cancelled' });
    const rb = await b.promise;
    expect(rb.meta!.n).toBe(b.id);
    expect(FakeWorker.terminated).toBe(1);
    expect(pool.stats.spawned).toBe(2);
  });

  it('작업마다 시간 초과를 따로 줄 수 있다(기본값보다 우선)', async () => {
    reset();
    const pool = mk(2, 10_000);
    const short = pool.run({ op: 'image', inputs: input(), options: { mode: 'hang' } }, { timeoutMs: 20 });
    const long = pool.run({ op: 'video', inputs: input(), options: { delay: 60 } }, { timeoutMs: 5_000 });
    await expect(short.promise).rejects.toMatchObject({ code: 'timeout' });
    expect((await long.promise).outputs).toHaveLength(1);
    const pool2 = mk(1, 20);
    const slow = pool2.run({ op: 'video', inputs: input(), options: { delay: 60 } }, { timeoutMs: 5_000 });
    expect((await slow.promise).outputs).toHaveLength(1); // 기본값(20ms)이었으면 끊겼다
    expect(pool2.stats.timedOut).toBe(0);
  });

  it('시간 초과', async () => {
    reset();
    const pool = mk(1, 30);
    const a = pool.run({ op: 'image', inputs: input(), options: { mode: 'hang' } });
    await expect(a.promise).rejects.toMatchObject({ code: 'timeout' });
    const b = await pool.run({ op: 'image', inputs: input(), options: {} }).promise;
    expect(b.outputs).toHaveLength(1);
    expect(pool.stats.timedOut).toBe(1);
  });

  it('워커 충돌 후에도 계속 동작', async () => {
    reset();
    const pool = mk(1);
    const a = pool.run({ op: 'image', inputs: input(), options: { mode: 'crash' } });
    const b = pool.run({ op: 'image', inputs: input(), options: {} });
    await expect(a.promise).rejects.toMatchObject({ code: 'worker-crash' });
    await expect(b.promise).resolves.toBeTruthy();
    expect(pool.stats.crashed).toBe(1);
  });

  it('변환 실패는 오류 코드 그대로 전달, 워커는 재사용', async () => {
    reset();
    const pool = mk(1);
    await expect(pool.run({ op: 'image', inputs: input(), options: { mode: 'fail' } }).promise).rejects.toMatchObject({ code: 'decode' });
    await pool.run({ op: 'image', inputs: input(), options: {} }).promise;
    expect(pool.stats.spawned).toBe(1);
  });

  it('풀 크기 기본값', () => {
    expect(defaultPoolSize(1)).toBe(1);
    expect(defaultPoolSize(4)).toBe(3);
    expect(defaultPoolSize(32)).toBe(6);
  });
});

describe('메모리 예산', () => {
  it('동시에 도는 작업의 예상 메모리 합이 예산을 넘지 않는다', async () => {
    reset();
    const MB = 1024 * 1024;
    const pool = new WorkerPool({ size: 6, create: () => new FakeWorker(), memoryBudget: 1000 * MB });
    const jobs = Array.from({ length: 12 }, () => pool.run({ op: 'image', inputs: input(), options: { delay: 10 } }, { cost: 300 * MB }).promise);
    await Promise.all(jobs);
    expect(pool.stats.maxInflightCost).toBeLessThanOrEqual(1000 * MB);
    expect(FakeWorker.maxLive).toBe(3); // 300MB × 3 = 900MB
  });
  it('혼자서 예산을 넘는 작업도 혼자는 돈다(영원히 기다리지 않는다)', async () => {
    reset();
    const pool = new WorkerPool({ size: 4, create: () => new FakeWorker(), memoryBudget: 100 });
    const r = await pool.run({ op: 'image', inputs: input(), options: {} }, { cost: 5000 }).promise;
    expect(r.outputs).toHaveLength(1);
  });
  it('큰 작업을 마친 워커는 버리고 새로 만든다', async () => {
    reset();
    const pool = new WorkerPool({ size: 1, create: () => new FakeWorker(), recycleAbove: 100 });
    await pool.run({ op: 'image', inputs: input(), options: {} }, { cost: 500 }).promise;
    await pool.run({ op: 'image', inputs: input(), options: {} }, { cost: 10 }).promise;
    await pool.run({ op: 'image', inputs: input(), options: {} }, { cost: 10 }).promise;
    expect(pool.stats.recycled).toBe(1);
    expect(pool.stats.spawned).toBe(2); // 큰 작업 뒤 한 번만 새로
    expect(FakeWorker.terminated).toBe(1);
  });
});
