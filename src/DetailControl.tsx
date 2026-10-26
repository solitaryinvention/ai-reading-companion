import { useEffect, useRef, useState } from 'react';
import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { detailLevels, normalizeDetail } from './detail-level';
import type { DetailLevel } from './types';

export function DetailControl({
  value,
  disabled,
  onChange,
}: {
  value?: DetailLevel;
  disabled: boolean;
  onChange: (level: DetailLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const level = normalizeDetail(value);
  const selected = detailLevels[level - 1];
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        root.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className="detail-control" ref={root}>
      <button
        className="detail-trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-controls="detail-panel"
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal size={13} strokeWidth={1.6} />
        讲解 · {selected.name}
        <ChevronDown size={13} />
      </button>
      {open && !disabled && (
        <div className="detail-panel" id="detail-panel" role="group" aria-label="讲解详略">
          <div className="detail-heading">
            <SlidersHorizontal size={16} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <strong>{selected.name}</strong>
              <span>讲解详略</span>
            </div>
            <button title="恢复标准档" aria-label="恢复标准档" onClick={() => onChange(3)}>
              <RotateCcw size={15} />
            </button>
          </div>
          <p>{selected.description}</p>
          <div className="detail-track">
            <div className="detail-dots" aria-hidden="true">
              {detailLevels.map((item) => (
                <i key={item.value} />
              ))}
            </div>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={level}
              aria-label="讲解详略档位"
              aria-valuetext={selected.name}
              onChange={(e) => onChange(Number(e.target.value) as DetailLevel)}
            />
          </div>
          <div className="detail-labels">
            {detailLevels.map((item) => (
              <button
                key={item.value}
                aria-pressed={item.value === level}
                onClick={() => onChange(item.value)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
