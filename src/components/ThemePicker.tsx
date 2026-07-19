import { useEffect, useRef, useState } from 'react';
import { THEMES, THEME_IDS, applyTheme, type ThemeId } from '../themes';

interface ThemePickerProps {
  current: ThemeId;
  onSelect: (id: ThemeId) => void;
}

// Six swatch buttons rather than a dropdown of names. Hovering an option
// applies its theme live (pure attribute swap — instant, reversible);
// leaving the panel restores the committed theme; clicking commits.
export default function ThemePicker({ current, onSelect }: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        applyTheme(current);
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, current]);

  return (
    <div className="theme-picker" ref={rootRef}>
      <button className="icon" onClick={() => setOpen((v) => !v)} title="Theme">
        🎨
      </button>
      {open && (
        <div className="theme-pop" onMouseLeave={() => applyTheme(current)}>
          {THEME_IDS.map((id) => {
            const meta = THEMES[id];
            return (
              <button
                key={id}
                className={`theme-option${id === current ? ' active' : ''}`}
                onMouseEnter={() => applyTheme(id)}
                onClick={() => {
                  onSelect(id);
                  setOpen(false);
                }}
              >
                <span className="theme-chips">
                  {meta.swatch.map((c) => (
                    <span key={c} className="theme-chip" style={{ background: c }} />
                  ))}
                </span>
                {meta.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
