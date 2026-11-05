import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.tsx';

// 대화상자 키보드 처리(명령 팔레트도 같이 쓴다): 열리면 안으로 초점, Tab은 안에서만 돌고, 닫히면 연 자리로 초점을 돌려준다
export function useDialogFocus(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const items = () => [...(box?.querySelectorAll<HTMLElement>('button, input, [tabindex="0"], a[href]') ?? [])].filter(e => !e.hasAttribute('disabled'));
    if (box && !box.contains(document.activeElement)) items()[0]?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !box) return;
      const f = items();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
      e.preventDefault();
      f[next]!.focus();
    };
    addEventListener('keydown', k);
    return () => {
      removeEventListener('keydown', k);
      // 명령이 초점을 다른 데로 옮겼으면 그대로 둔다
      const now = document.activeElement;
      if (prev?.isConnected && (!now || now === document.body || box?.contains(now))) prev.focus();
    };
  }, [ref]);
}

// 전후 비교 슬라이더(첫 화면 데모와 결과 비교 창이 같이 쓴다)
export function Compare({ before, after, beforeLabel, afterLabel, zoom = false, width, height }: {
  before: string; after: string; beforeLabel: string; afterLabel: string; zoom?: boolean; width?: number; height?: number;
}) {
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const track = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  };
  return (
    <div ref={box} className={`compare${zoom ? ' zoom' : ''}`} style={{ ['--pos' as string]: `${pos}%`, ...(width && height ? { aspectRatio: `${width} / ${height}` } : {}) }}
      onPointerDown={e => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); track(e); }}
      onPointerMove={e => { if (e.buttons) track(e); }}
      onKeyDown={e => { if (e.key === 'ArrowLeft') setPos(p => Math.max(0, p - 5)); if (e.key === 'ArrowRight') setPos(p => Math.min(100, p + 5)); }}
      role="slider" aria-label={`${beforeLabel} / ${afterLabel}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)} tabIndex={0}>
      <img src={before} alt={beforeLabel} width={width} height={height} decoding="async" loading="lazy" draggable={false} />
      <img src={after} alt={afterLabel} className="after" width={width} height={height} decoding="async" loading="lazy" draggable={false} />
      <span className="tag left">{beforeLabel}</span>
      <span className="tag right">{afterLabel}</span>
      <div className="handle" aria-hidden="true" />
    </div>
  );
}

export function CompareModal({ before, after, name, label, onClose, t }: {
  before: string; after: string; name: string; label: string; onClose(): void;
  t: { before: string; after: string; fit: string; actualSize: string; close: string; compare: string };
}) {
  const [zoom, setZoom] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={t.compare} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{name} <span className="num dim">{label}</span></h3>
          <button className="link-btn" onClick={() => setZoom(z => !z)} aria-pressed={zoom}><Icon name="zoom" size={16} />{zoom ? t.fit : t.actualSize}</button>
          <button className="icon-btn" onClick={onClose} aria-label={t.close}><Icon name="x" /></button>
        </div>
        <div className="compare-box"><Compare before={before} after={after} beforeLabel={t.before} afterLabel={t.after} zoom={zoom} /></div>
      </div>
    </div>
  );
}
