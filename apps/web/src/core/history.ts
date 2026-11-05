// 변환 기록(기기 안, IndexedDB). 새로고침·탭을 닫았다 열어도 최근 결과를 다시 받을 수 있게.
// 서버로 가는 건 없다. 7일이 지나거나 합계 300MB를 넘으면 오래된 것부터 지운다. 끌 수 있다(localStorage).
export interface HistoryItem { id: number; at: number; name: string; size: number; type: string; op: string; data: ArrayBuffer }
// Blob 대신 ArrayBuffer로 저장: WebKit은 IndexedDB에 넣은 Blob을 새로고침 뒤 못 읽었다('Cannot load blob', e2e로 재현)
export const toBlob = (it: HistoryItem) => new Blob([it.data], { type: it.type });

const DB = 'lc-history', STORE = 'items', OFF_KEY = 'lc_history_off';
export const KEEP_DAYS = 7, KEEP_BYTES = 300 * 1024 * 1024;
export const CHANGED = 'lc-history-changed';

export function isOff(): boolean { try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; } }
export function setOff(off: boolean) { try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY); } catch { /* 저장 불가(사생활 모드 등) */ } }

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }).createIndex('at', 'at');
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}
const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};

export async function list(): Promise<HistoryItem[]> {
  const all = (await tx<HistoryItem[]>('readonly', s => s.getAll())) ?? [];
  return all.sort((a, b) => b.at - a.at);
}

export async function add(files: { name: string; blob: Blob }[], op: string, now = Date.now()) {
  if (isOff() || !files.length) return;
  try {
    for (const f of files) { const data = await f.blob.arrayBuffer(); await tx('readwrite', s => s.add({ at: now, name: f.name, size: f.blob.size, type: f.blob.type, op, data })); }
    await prune(now);
  } catch { /* 저장 공간 부족·사생활 모드: 기록만 건너뛴다(변환에는 영향 없음) */ }
  dispatchEvent(new Event(CHANGED));
}

// 7일 지난 것, 그리고 합계가 300MB를 넘으면 오래된 것부터
export async function prune(now = Date.now()) {
  const items = await list();
  let total = 0;
  const drop: number[] = [];
  for (const it of items) {
    total += it.size;
    if (now - it.at > KEEP_DAYS * 86400_000 || total > KEEP_BYTES) drop.push(it.id);
  }
  for (const id of drop) await tx('readwrite', s => s.delete(id));
  return drop.length;
}

export async function remove(id: number) { await tx('readwrite', s => s.delete(id)); dispatchEvent(new Event(CHANGED)); }
export async function clear() { await tx('readwrite', s => s.clear()); dispatchEvent(new Event(CHANGED)); }
