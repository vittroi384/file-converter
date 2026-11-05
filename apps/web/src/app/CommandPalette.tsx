import { useEffect, useMemo, useRef, useState } from 'react';
import { matches } from './search-text.ts';
import { useDialogFocus } from './CompareModal.tsx';

export interface Command { id: string; label: string; hint?: string; run(): void }

export function CommandPalette({ commands, onClose, hint, empty, title }: { commands: Command[]; onClose(): void; hint: string; empty: string; title: string }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog);
  const list = useMemo(() => commands.filter(c => matches(c.label, q)), [commands, q]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setSel(0); }, [q]);
  const go = (c?: Command) => { if (!c) return; onClose(); c.run(); };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialog} className="palette" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder={hint} aria-label={title}
          role="combobox" aria-autocomplete="list" aria-expanded={list.length > 0} aria-controls="cmd-list" aria-activedescendant={list[sel] ? `cmd-${list[sel]!.id}` : undefined}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(list.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); go(list[sel]); }
            if (e.key === 'Escape') onClose();
          }} />
        <ul id="cmd-list" role="listbox" aria-label={title} tabIndex={-1}>
          {list.map((c, i) => (
            <li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => go(c)}>
              {c.label}{c.hint && <small>{c.hint}</small>}
            </li>
          ))}
        </ul>
        <div role="status">{!list.length && <p className="empty">{empty}</p>}</div>
      </div>
    </div>
  );
}
