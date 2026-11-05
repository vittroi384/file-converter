// 변환 도구(첫 화면·랜딩 공용). 서버 렌더에서도 그려지므로 렌더 중엔 window·localStorage를 만지지 않는다(효과·이벤트 안에서만).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
// 최근 변환 목록: 화면에 붙은 뒤에만 불러온다(구운 HTML에 없음 → 첫 화면 JS·하이드레이션과 무관)
const History = lazy(() => import('./History.tsx'));
import { formatFromName } from '@fc/shared';
import { actionsFor, actionById, kindOf, smartDefaults, toRunOptions, type ActionDef, type Kind } from './actions.ts';
import type { ActionId, Dict } from '../i18n/types.ts';
import { useI18n } from '../i18n/context.ts';
import type { Options, OutputMeta } from '../core/types.ts';
import { Icon } from './icons.tsx';
import { bytes, saving } from './format.ts';
import { FileTag } from './FileTag.tsx';
import { errorReason } from './error-reason.ts';

type Status = 'idle' | 'running' | 'done' | 'error';
interface ConvertedFile { name: string; blob: Blob }
interface Item {
  id: string; file: File; kind: Kind; thumb?: string; status: Status; progress: number;
  results?: ConvertedFile[]; meta?: OutputMeta; error?: string; reason?: string; took?: number;
}
interface Combined { status: Status; progress: number; results?: ConvertedFile[]; error?: string; reason?: string; meta?: OutputMeta }

const PREVIEWABLE = ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'svg'];
const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장소 막힘: 기억 기능만 빠진다 */ } },
};
let seq = 0;
const vt = (fn: () => void) => {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (d.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) d.startViewTransition(fn);
  else fn();
};
const fieldLabel = (t: Dict, l: string | { raw: string }) => (typeof l === 'string' ? t.fields[l as keyof Dict['fields']] : l.raw);

export interface ToolProps {
  initialAction?: ActionId;
  preset?: Record<string, string>; // 랜딩에서 미리 골라 둘 옵션
  accept?: string;
  onCompare?(c: { before: string; after: string; name: string; label: string }): void;
  registerCommands?(cmds: { id: string; label: string; hint?: string; run(): void }[]): void;
  say(m: string): void;
}

export function Tool({ initialAction, preset, accept, onCompare, registerCommands, say }: ToolProps) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const [actionId, setActionId] = useState<string | null>(initialAction ?? null);
  // 저장된 설정은 첫 렌더 뒤에 읽는다(서버 렌더와 첫 화면이 같아야 이어받기가 깨지지 않는다)
  const [opts, setOpts] = useState<Record<string, Options>>({});
  useEffect(() => { setOpts(store.get('fc:opts', {})); }, []);
  const [combined, setCombined] = useState<Combined | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const jobs = useRef(new Map<string, { cancel(): void }>());
  const pendingAction = useRef<string | null>(null);

  const kinds = useMemo(() => items.map(i => i.kind), [items]);
  const available = useMemo(() => actionsFor(kinds), [kinds]);
  const action: ActionDef | undefined = available.find(a => a.id === actionId) ?? available[0];
  const actionOpts: Options = action ? {
    ...smartDefaults(action, items.map(i => i.file.name)),
    ...(action.id === initialAction ? preset : {}), // 랜딩 주소가 정한 값이 기본값을 이긴다
    ...(opts[action.id] ?? {}),
  } : {};
  const fits = (i: Item) => !!action && action.kinds.includes(i.kind);
  const running = items.some(i => i.status === 'running') || combined?.status === 'running';
  const allResults: ConvertedFile[] = combined?.results ?? items.filter(i => i.status === 'done').flatMap(i => i.results ?? []);

  const addFiles = useCallback((list: FileList | File[]) => {
    const files = [...list].filter(f => f.size > 0);
    if (!files.length) return;
    const next = files.map(file => ({
      id: `f${++seq}`, file, kind: kindOf(file.name), status: 'idle' as Status, progress: 0,
      thumb: PREVIEWABLE.includes(formatFromName(file.name)) ? URL.createObjectURL(file) : undefined,
    }));
    const unknown = next.filter(n => n.kind === 'other').length;
    if (unknown) say(t.ui.skippedUnsupported(unknown));
    vt(() => {
      setItems(prev => [...prev.filter(p => p.status !== 'done'), ...next.filter(n => n.kind !== 'other')]);
      setCombined(null);
      if (pendingAction.current) { setActionId(pendingAction.current); pendingAction.current = null; }
    });
  }, [say, t]);

  // 창 어디에 떨어뜨려도 받기 + 붙여넣기 + 공유하기로 들어온 파일
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; depth++; document.body.classList.add('dragging'); };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; document.body.classList.remove('dragging'); if (e.dataTransfer?.files) addFiles(e.dataTransfer.files); };
    const paste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
      addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `paste-${stamp}${i ? '-' + i : ''}.${f.type.split('/')[1] || 'png'}`, { type: f.type }))));
      say(t.ui.pasted);
    };
    const onShare = (e: Event) => addFiles((e as CustomEvent<File[]>).detail);
    const lq = (window as { launchQueue?: { setConsumer(cb: (p: { files: { getFile(): Promise<File> }[] }) => void): void } }).launchQueue;
    lq?.setConsumer(async p => { if (p.files?.length) addFiles(await Promise.all(p.files.map(h => h.getFile()))); });
    addEventListener('dragenter', enter); addEventListener('dragleave', leave); addEventListener('dragover', over); addEventListener('drop', drop); addEventListener('paste', paste); addEventListener('fc:shared-files', onShare);
    return () => { removeEventListener('dragenter', enter); removeEventListener('dragleave', leave); removeEventListener('dragover', over); removeEventListener('drop', drop); removeEventListener('paste', paste); removeEventListener('fc:shared-files', onShare); };
  }, [addFiles, say, t]);

  const setOpt = (key: string, value: string) => {
    if (!action) return;
    const next = { ...opts, [action.id]: { ...(opts[action.id] ?? {}), [key]: value } };
    setOpts(next);
    store.set('fc:opts', next);
    setItems(prev => prev.map(i => (i.status === 'done' || i.status === 'error' ? { ...i, status: 'idle', results: undefined, error: undefined, reason: undefined, progress: 0 } : i)));
    setCombined(null);
  };
  const pickAction = (id: string) => { setActionId(id); setCombined(null); setItems(prev => prev.map(i => (i.status === 'running' ? i : { ...i, status: 'idle', results: undefined, error: undefined, reason: undefined, progress: 0 }))); };
  const patch = (id: string, p: Partial<Item>) => setItems(prev => prev.map(i => (i.id === id ? { ...i, ...p } : i)));
  const errText = (e: unknown) => {
    const { code, info } = e as { code?: keyof Dict['errors']; info?: { need?: number; limit?: number } };
    const base = (code && t.errors[code]) || t.errors.unknown;
    // 너무 큰 파일: 얼마나 필요하고 이 기기 한도가 얼마인지, 무엇을 하면 되는지까지
    const gb = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)}GB` : `${Math.round(b / 1048576)}MB`);
    return code === 'too-large' && info?.need && info.limit ? `${base} ${t.ui.tooLarge(gb(info.need), gb(info.limit))}` : base;
  };
  // 일반 문구 밑에 붙일 구체적 이유(영상: 코덱 미지원·GIF 길이 등). 목록에 있는 것만, 없으면 undefined
  const reasonOf = (e: unknown) => errorReason(t, e) ?? undefined;

  const run = async () => {
    if (!action || running) return;
    const { convert } = await import('../core/client.ts'); // 변환 엔진은 처음 쓸 때 받는다(첫 화면을 가볍게)
    const targets = items.filter(i => fits(i) && (action.combine || i.status !== 'done'));
    if (!targets.length) return;
    const runOpts = (name: string) => toRunOptions(action, actionOpts, name, locale);
    if (action.combine) {
      setCombined({ status: 'running', progress: 0 });
      const job = convert(targets.map(x => x.file), action.op(targets[0]!.file.name), runOpts(targets[0]!.file.name), v => setCombined(c => (c ? { ...c, progress: v } : c)));
      jobs.current.set('combined', job);
      try {
        const r = await job.promise;
        setCombined({ status: 'done', progress: 1, results: r.files, meta: r.meta });
        void import('../core/history.ts').then(h => h.add(r.files, action.id));
        say(t.ui.doneDownload);
      } catch (e) {
        setCombined({ status: 'error', progress: 0, error: errText(e), reason: reasonOf(e) });
      } finally { jobs.current.delete('combined'); }
      return;
    }
    await Promise.all(targets.map(async x => {
      patch(x.id, { status: 'running', progress: 0, error: undefined, reason: undefined, results: undefined });
      // 스마트 압축을 파일 하나만 돌릴 때만 병렬 후보(남는 코어 사용). 일괄 처리는 코어가 이미 다 바쁘다
      const opts = action.id === 'compress' && targets.length === 1 ? { ...runOpts(x.file.name), parallel: true } : runOpts(x.file.name);
      const job = convert([x.file], action.op(x.file.name), opts, v => patch(x.id, { progress: v }));
      jobs.current.set(x.id, job);
      try {
        const r = await job.promise;
        patch(x.id, { status: 'done', progress: 1, results: r.files, meta: r.meta, took: r.ms });
        void import('../core/history.ts').then(h => h.add(r.files, action.id));
      } catch (e) {
        const cancelled = (e as { code?: string }).code === 'cancelled';
        patch(x.id, { status: cancelled ? 'idle' : 'error', error: cancelled ? undefined : errText(e), reason: cancelled ? undefined : reasonOf(e), progress: 0 });
      } finally { jobs.current.delete(x.id); }
    }));
    say(t.ui.done);
  };

  const cancelAll = () => { for (const j of jobs.current.values()) j.cancel(); };
  const remove = (id: string) => {
    jobs.current.get(id)?.cancel();
    setItems(prev => { const it = prev.find(i => i.id === id); if (it?.thumb) URL.revokeObjectURL(it.thumb); return prev.filter(i => i.id !== id); });
    setCombined(null);
  };
  const clear = () => { cancelAll(); vt(() => { items.forEach(i => i.thumb && URL.revokeObjectURL(i.thumb)); setItems([]); setCombined(null); setActionId(initialAction ?? null); }); };
  const move = (id: string, dir: -1 | 1) => setItems(prev => {
    const i = prev.findIndex(p => p.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= prev.length) return prev;
    const next = prev.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  });
  const dropOn = (targetId: string) => {
    if (!moving || moving === targetId) return;
    setItems(prev => {
      const from = prev.findIndex(p => p.id === moving), to = prev.findIndex(p => p.id === targetId);
      const next = prev.slice();
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m!);
      return next;
    });
    setMoving(null);
    setCombined(null);
  };
  const saveAll = async () => {
    const { downloadBlob, downloadZip } = await import('./download.ts');
    if (allResults.length === 1) { downloadBlob(allResults[0]!.blob, allResults[0]!.name); return; }
    say(t.ui.zipping);
    await downloadZip(allResults, 'localconvert.zip');
  };
  const saveOne = async (r: ConvertedFile) => (await import('./download.ts')).downloadBlob(r.blob, r.name);
  const saveZip = async (rs: ConvertedFile[], name: string) => (await import('./download.ts')).downloadZip(rs, name);

  const openPicker = () => { if (inputRef.current) { inputRef.current.accept = accept ?? ''; inputRef.current.click(); } };

  // 명령 팔레트에 이 도구의 명령을 올린다
  useEffect(() => {
    registerCommands?.([
      { id: 'add', label: t.ui.addMore.replace(/^\+\s*/, ''), hint: 'Ctrl+O', run: openPicker },
      ...available.map(a => ({ id: 'act-' + a.id, label: t.actions[a.id].label, run: () => pickAction(a.id) })),
      ...(items.length && !running ? [{ id: 'run', label: action ? t.actions[action.id].label : '', run }] : []),
      ...(allResults.length ? [{ id: 'save', label: allResults.length > 1 ? t.ui.saveAll(allResults.length) : t.ui.save, run: saveAll }] : []),
      ...(running ? [{ id: 'cancel', label: t.ui.cancel, run: cancelAll }] : []),
      ...(items.length ? [{ id: 'clear', label: t.ui.startOver, run: clear }] : []),
    ]);
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); openPicker(); } };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  const actionCount = items.filter(fits).length;
  const remaining = action && !action.combine ? items.filter(i => fits(i) && i.status !== 'done').length : 0;
  const hasResults = allResults.length > 0;
  const totalIn = items.filter(fits).reduce((s, i) => s + i.file.size, 0);
  const totalOut = allResults.reduce((s, r) => s + r.blob.size, 0);
  // 화면 낭독기용 요약 한 줄(파일 목록 전체를 aria-live로 두면 진행률이 바뀔 때마다 목록을 통째로 읽었다)
  const doneN = items.filter(i => i.status === 'done').length, failN = items.filter(i => i.status === 'error').length;
  const statusText = combined && combined.status !== 'idle' && combined.status !== 'running'
    ? t.ui.status(combined.status === 'done' ? 1 : 0, 1, combined.status === 'error' ? 1 : 0)
    : doneN + failN ? t.ui.status(doneN, items.filter(fits).length, failN) : '';
  // 작업 탭 키보드: 좌우 화살표·Home·End로 옮기고 바로 연다(관리자 화면과 같은 방식)
  const tabKeys = (e: React.KeyboardEvent) => {
    const i = available.findIndex(a => a.id === action?.id), n = available.length;
    const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    pickAction(available[j]!.id);
    document.getElementById(`act-tab-${available[j]!.id}`)?.focus();
  };

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div className={`tool${items.length ? ' has-files' : ''}`} style={{ viewTransitionName: 'tool' }}>
      <input ref={inputRef} type="file" multiple hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} data-testid="file-input" />
      {!items.length ? (
        <button className="drop" onClick={openPicker}>
          <span className="drop-mark" aria-hidden="true"><Icon name="upload" size={22} /></span>
          <strong>{t.hero.drop}</strong>
          <span className="drop-hint">{t.hero.dropHint}</span>
        </button>
      ) : (
        <div className="work">
          <section className="sheet files-sheet" aria-label={t.ui.files}>
            <header className="sheet-head">
              <h2>{t.ui.files} <span className="num">{items.length}</span></h2>
              {hasResults && <span className="num total">{bytes(totalIn)} → <b>{bytes(totalOut)}</b></span>}
              <button className="link-btn" onClick={clear}>{t.ui.clear}</button>
            </header>
            <div role="status" className="sr-only">{statusText}</div>
            <ul className="files">
              {items.map((it, idx) => (
                <FileRow key={it.id} it={it} t={t} idx={idx} total={items.length} fits={fits(it)} reorder={!!action?.combine}
                  onRemove={() => remove(it.id)} onMove={d => move(it.id, d)} onSave={saveOne} onZip={saveZip}
                  onCompare={r => it.thumb && onCompare?.({ before: it.thumb, after: URL.createObjectURL(r.blob), name: r.name, label: `${bytes(it.file.size)} → ${bytes(r.blob.size)}` })}
                  dragProps={{
                    draggable: !!action?.combine,
                    onDragStart: () => setMoving(it.id),
                    onDragOver: e => { if (moving) e.preventDefault(); },
                    onDrop: e => { if (moving) { e.preventDefault(); e.stopPropagation(); dropOn(it.id); } },
                    onDragEnd: () => setMoving(null),
                  }}
                  dragging={moving === it.id}
                />
              ))}
            </ul>
            <button className="add-more" onClick={openPicker}>{t.ui.addMore}</button>
          </section>

          <aside className="sheet side">
            {available.length ? (
              <>
                <div className="tabs" role="tablist" onKeyDown={tabKeys}>
                  {available.map(a => (
                    <button key={a.id} id={`act-tab-${a.id}`} className="tab" role="tab" aria-selected={a.id === action?.id} aria-controls="action-panel" tabIndex={a.id === action?.id ? 0 : -1} onClick={() => pickAction(a.id)}>{t.actions[a.id].label}</button>
                  ))}
                </div>
                {action && (
                  <div className="action-body" role="tabpanel" id="action-panel" aria-labelledby={`act-tab-${action.id}`}>
                    <p className="action-desc">{t.actions[action.id].desc}</p>
                    {action.fields.map(f => (
                      <div key={f.key} className="field">
                        <div className="field-label" id={`lbl-${f.key}`}>{t.fields[f.label]}</div>
                        {f.type === 'chips' ? (
                          <div className="chips" role="radiogroup" aria-labelledby={`lbl-${f.key}`}>
                            {f.choices.map(c => (
                              <button key={c.value} className="chip" role="radio" aria-checked={String(actionOpts[f.key] ?? '') === c.value} onClick={() => setOpt(f.key, c.value)}>
                                {fieldLabel(t, c.label)}{c.hint && <small>{c.hint}</small>}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <input className="text-input" aria-labelledby={`lbl-${f.key}`} placeholder={t.fields[f.placeholder]} value={String(actionOpts[f.key] ?? '')} onChange={e => setOpt(f.key, e.target.value)} />
                        )}
                      </div>
                    ))}
                    {actionCount < items.length && <div className="note">{t.ui.skipped(items.length - actionCount)}</div>}
                    {combined?.status === 'error' && <div className="note err">{combined.error}{combined.reason && <><br />{combined.reason}</>}</div>}
                    {combined?.status === 'done' && combined.meta?.pages !== undefined && <div className="note">{t.ui.pages(Number(combined.meta.pages))}</div>}
                  </div>
                )}
              </>
            ) : <div className="action-body"><p className="action-desc">{t.ui.noActions}</p></div>}
            <div className="run-bar">
              {hasResults && !running ? (
                <div className="result-actions">
                  <button className="btn primary" onClick={saveAll}><Icon name="download" />{allResults.length > 1 ? t.ui.saveAll(allResults.length) : t.ui.save}</button>
                  {remaining > 0
                    ? <button className="btn" onClick={run}>{t.ui.remaining(remaining)}</button>
                    : <button className="btn" onClick={clear}>{t.ui.startOver}</button>}
                </div>
              ) : running ? (
                <>
                  {combined?.status === 'running' && <div className="progress" role="progressbar" aria-label={action ? t.actions[action.id].label : t.ui.processing} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(combined.progress * 100)}><i style={{ width: `${Math.round(combined.progress * 100)}%` }} /></div>}
                  <button className="btn" onClick={cancelAll}>{t.ui.cancel}</button>
                </>
              ) : (
                <button className="btn primary" disabled={!action || !actionCount} onClick={run}>
                  {action ? (action.combine ? t.ui.runCombined(t.actions[action.id].label) : t.ui.run(t.actions[action.id].label, actionCount)) : ''}
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
      {mounted && <Suspense fallback={null}><History /></Suspense>}
    </div>
  );
}

function FileRow({ it, t, idx, total, fits, reorder, onRemove, onMove, onCompare, onSave, onZip, dragProps, dragging }: {
  it: Item; t: Dict; idx: number; total: number; fits: boolean; reorder: boolean;
  onRemove(): void; onMove(d: -1 | 1): void; onCompare(r: ConvertedFile): void; onSave(r: ConvertedFile): void; onZip(r: ConvertedFile[], name: string): void;
  dragProps: React.LiHTMLAttributes<HTMLLIElement>; dragging: boolean;
}) {
  const fmt = formatFromName(it.file.name);
  const out = it.results?.reduce((s, r) => s + r.blob.size, 0) ?? 0;
  const pct = it.status === 'done' && it.results?.length === 1 ? saving(it.file.size, out) : null;
  const first = it.results?.[0];
  const outFmt = first ? formatFromName(first.name) : null;
  const name = it.file.name;
  const canCompare = !!it.thumb && first && /\.(jpe?g|png|webp|avif)$/i.test(first.name);
  return (
    <li className={`file${dragging ? ' dragging' : ''}${fits ? '' : ' unfit'}`} {...dragProps}>
      <div className="thumb">{it.thumb ? <img src={it.thumb} alt="" loading="lazy" decoding="async" /> : <FileTag fmt={fmt} />}</div>
      <div className="file-main">
        <div className="fname" title={it.file.name}>{it.file.name}</div>
        <div className="fmeta">
          <FileTag fmt={fmt} small />
          <span className="num">{bytes(it.file.size)}</span>
          {it.status === 'done' && it.results && (
            it.results.length === 1
              ? <><span aria-hidden="true">→</span>{outFmt && <FileTag fmt={outFmt} small />}<span className="num">{bytes(out)}</span>{pct !== null && (pct > 0 ? <span className="delta down">−{pct}%</span> : <span className="delta up">+{-pct}%</span>)}</>
              : <span>→ {t.ui.filesN(it.results.length)}</span>
          )}
          {it.status === 'done' && it.meta?.tries !== undefined && <span className="dim">{t.ui.tries(Number(it.meta.q), Number(it.meta.tries))}</span>}
          {it.status === 'done' && it.meta?.keptOriginal === true && <span className="dim">{t.ui.keptOriginal}</span>}
          {it.status === 'done' && it.meta?.color === '444' && <span className="dim">{t.ui.color444}</span>}
          {it.status === 'done' && it.meta?.color === 'warn' && <span className="warn-note">{t.ui.colorWarn}</span>}
          {it.status === 'done' && it.meta?.note && <span className="dim">{t.ui.psdNote}</span>}
          {it.status === 'done' && it.meta?.audio === 'dropped' && <span className="warn-note">{t.ui.audioDropped}</span>}
          {it.status === 'running' && <span className="dim">{t.ui.processing}</span>}
          {it.status === 'error' && <span className="err">{it.error}</span>}
          {!fits && <span className="dim">{t.ui.notForThis}</span>}
        </div>
        {it.status === 'error' && it.reason && <div className="fmeta"><span className="err">{it.reason}</span></div>}
        {it.status === 'running' && <div className="progress" role="progressbar" aria-label={`${t.ui.processing}: ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(it.progress * 100)}><i style={{ width: `${Math.max(4, Math.round(it.progress * 100))}%` }} /></div>}
      </div>
      <div className="file-actions">
        {reorder && (
          <>
            <button className="icon-btn" aria-label={`${t.ui.up}: ${name}`} disabled={idx === 0} onClick={() => onMove(-1)}><Icon name="up" size={16} /></button>
            <button className="icon-btn" aria-label={`${t.ui.down}: ${name}`} disabled={idx === total - 1} onClick={() => onMove(1)}><Icon name="down" size={16} /></button>
          </>
        )}
        {canCompare && <button className="icon-btn" aria-label={`${t.ui.compare}: ${name}`} onClick={() => onCompare(first!)}><Icon name="compare" size={17} /></button>}
        {it.status === 'done' && it.results?.length === 1 && <button className="icon-btn" aria-label={`${t.ui.download}: ${name}`} onClick={() => onSave(first!)}><Icon name="download" size={17} /></button>}
        {it.status === 'done' && it.results && it.results.length > 1 && <button className="icon-btn" aria-label={`${t.ui.download}: ${name}`} onClick={() => onZip(it.results!, it.file.name.replace(/\.[^.]+$/, '') + '.zip')}><Icon name="download" size={17} /></button>}
        <button className="icon-btn" aria-label={`${t.ui.remove}: ${name}`} onClick={onRemove}><Icon name="x" size={16} /></button>
      </div>
    </li>
  );
}

