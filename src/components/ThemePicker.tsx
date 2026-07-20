import { useEffect, useRef, useState } from 'react';
import { THEMES, THEME_IDS, applyTheme, type ThemeId } from '../themes';
import { FONT_IDS, READER_FONTS, applyReaderFont, type FontId } from '../fonts';

export const READER_SIZE_MIN = 12;
export const READER_SIZE_MAX = 28;

interface ThemePickerProps {
  currentTheme: ThemeId;
  currentFont: FontId;
  readerSize: number;
  onSelectTheme: (id: ThemeId) => void;
  onSelectFont: (id: FontId) => void;
  onChangeSize: (px: number) => void;
}

// The 🎨 appearance popover: six theme swatches plus the reader-font list.
// Hovering an option applies it live (pure attribute/property swap —
// instant, reversible); leaving the panel restores committed choices;
// clicking commits.
export default function ThemePicker({
  currentTheme, currentFont, readerSize, onSelectTheme, onSelectFont, onChangeSize,
}: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const restorePreview = () => {
    applyTheme(currentTheme);
    applyReaderFont(currentFont);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        restorePreview();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentTheme, currentFont]);

  return (
    <div className="theme-picker" ref={rootRef}>
      <button className="icon" onClick={() => setOpen((v) => !v)} title="Appearance">
        🎨
      </button>
      {open && (
        <div className="theme-pop" onMouseLeave={restorePreview}>
          <div className="theme-section-label">Theme</div>
          <div className="theme-grid">
            {THEME_IDS.map((id) => {
              const meta = THEMES[id];
              return (
                <button
                  key={id}
                  className={`theme-option${id === currentTheme ? ' active' : ''}`}
                  onMouseEnter={() => applyTheme(id)}
                  onClick={() => {
                    onSelectTheme(id);
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
          <div className="theme-section-label">Text size</div>
          <div className="size-slider-row">
            <span className="size-hint" style={{ fontSize: 11 }}>A</span>
            <input
              type="range"
              min={READER_SIZE_MIN}
              max={READER_SIZE_MAX}
              step={1}
              value={readerSize}
              onChange={(e) => onChangeSize(Number(e.target.value))}
              title={`Reader text size: ${readerSize}px`}
            />
            <span className="size-hint" style={{ fontSize: 17 }}>A</span>
            <span className="size-value">{readerSize}px</span>
          </div>
          <div className="theme-section-label">Reader font</div>
          <div className="theme-grid">
            {FONT_IDS.map((id) => {
              const meta = READER_FONTS[id];
              return (
                <button
                  key={id}
                  className={`theme-option${id === currentFont ? ' active' : ''}`}
                  onMouseEnter={() => applyReaderFont(id)}
                  onClick={() => {
                    onSelectFont(id);
                    setOpen(false);
                  }}
                >
                  <span className="font-sample" style={{ fontFamily: meta.stack }}>Aa</span>
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
