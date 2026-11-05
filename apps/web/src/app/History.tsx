// 최근 변환(기기 안 기록). Tool이 화면에 붙은 뒤에만 불러온다(구운 HTML에 없음 → 첫 화면 JS·하이드레이션과 무관).
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/context.ts';
import * as h from '../core/history.ts';
import { FileTag } from './FileTag.tsx';
import { bytes } from './format.ts';
import { downloadBlob } from './download.ts';

export default function History() {
  const { t, locale } = useI18n();
  const s = t.history;
  const [items, setItems] = useState<h.HistoryItem[] | null>(null);
  const [off, setOffState] = useState(h.isOff());
  const load = useCallback(() => { void h.list().then(setItems).catch(() => setItems([])); }, []);
  useEffect(() => {
    load();
    addEventListener(h.CHANGED, load);
    return () => removeEventListener(h.CHANGED, load);
  }, [load]);
  if (items === null) return null;
  const fmtTime = (at: number) => new Date(at).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
  return (
    <details className="history" open={false}>
      <summary><span>{s.title}</span><span className="num dim">{items.length}</span></summary>
      <div className="history-body">
        <p className="dim history-note">{s.note(h.KEEP_DAYS)}</p>
        {items.length === 0 ? <p className="dim">{s.empty}</p> : (
          <ul className="history-list">
            {items.map(it => (
              <li key={it.id}>
                <FileTag fmt={ext(it.name)} small />
                <span className="history-name" title={it.name}>{it.name}</span>
                <span className="num dim">{bytes(it.size)} · {fmtTime(it.at)}</span>
                <button className="btn" onClick={() => downloadBlob(h.toBlob(it), it.name)}>{s.download}</button>
                <button className="icon-btn" aria-label={`${s.remove}: ${it.name}`} onClick={() => void h.remove(it.id)}>×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="history-foot">
          <label className="toggle"><input type="checkbox" checked={!off} onChange={e => { h.setOff(!e.target.checked); setOffState(!e.target.checked); }} /> {s.keep}</label>
          {items.length > 0 && <button className="btn" onClick={() => void h.clear()}>{s.clear}</button>}
        </div>
      </div>
    </details>
  );
}
