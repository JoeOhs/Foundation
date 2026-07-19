// Reader font registry. System-installed stacks only — the app ships no
// font files, so there is nothing to license; every stack falls back
// gracefully if a face is missing. Curated for long-form reading: four
// screen-tuned serifs, two high-legibility sans faces.
export type FontId = 'georgia' | 'palatino' | 'cambria' | 'constantia' | 'segoe' | 'verdana';

export interface FontMeta {
  label: string;
  kind: 'serif' | 'sans';
  stack: string;
}

export const READER_FONTS: Record<FontId, FontMeta> = {
  georgia: { label: 'Georgia', kind: 'serif', stack: `Georgia, 'Times New Roman', serif` },
  palatino: { label: 'Palatino', kind: 'serif', stack: `'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif` },
  cambria: { label: 'Cambria', kind: 'serif', stack: `Cambria, Georgia, serif` },
  constantia: { label: 'Constantia', kind: 'serif', stack: `Constantia, Cambria, Georgia, serif` },
  segoe: { label: 'Segoe UI', kind: 'sans', stack: `'Segoe UI', system-ui, sans-serif` },
  verdana: { label: 'Verdana', kind: 'sans', stack: `Verdana, Geneva, sans-serif` },
};

export const FONT_IDS = Object.keys(READER_FONTS) as FontId[];

export function normalizeStoredFont(value: unknown): FontId | null {
  return typeof value === 'string' && value in READER_FONTS ? (value as FontId) : null;
}

export function applyReaderFont(id: FontId): void {
  document.documentElement.style.setProperty('--font-reader', READER_FONTS[id].stack);
}
