import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { Reference, VerseSelection } from './types';

// Cross-window channels between the main window and the popped-out notes
// window. Both share the same SQLite database; these events keep their UI
// state in sync (they carry intent/context, not the note data itself).
const CTX = 'notes:context'; // main → popout: current reference + selection
const INSERT = 'notes:insert-md'; // main → popout: scripture markdown to insert
const CHANGED = 'notes:changed'; // either → other: notes table changed, reload
const CLOSED = 'notes:closed'; // popout → main: window is closing

export const NOTES_WINDOW_LABEL = 'notes';

export function isNotesWindow(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'notes';
}

export interface NotesContext {
  ref: Reference;
  selection: VerseSelection | null;
}

export function emitNotesContext(ctx: NotesContext): void {
  void emit(CTX, ctx);
}
export function onNotesContext(cb: (ctx: NotesContext) => void): Promise<UnlistenFn> {
  return listen<NotesContext>(CTX, (e) => cb(e.payload));
}

export function emitInsertMarkdown(md: string): void {
  void emit(INSERT, md);
}
export function onInsertMarkdown(cb: (md: string) => void): Promise<UnlistenFn> {
  return listen<string>(INSERT, (e) => cb(e.payload));
}

export function emitNotesChanged(): void {
  void emit(CHANGED);
}
export function onNotesChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(CHANGED, () => cb());
}

const HL_CHANGED = 'highlights:changed'; // either → other: highlights changed
export function emitHighlightsChanged(): void {
  void emit(HL_CHANGED);
}
export function onHighlightsChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(HL_CHANGED, () => cb());
}

const NAV = 'notes:navigate'; // popout → main: jump the reader to a verse
export function emitNotesNavigate(ref: VerseSelection): void {
  void emit(NAV, ref);
}
export function onNotesNavigate(cb: (ref: VerseSelection) => void): Promise<UnlistenFn> {
  return listen<VerseSelection>(NAV, (e) => cb(e.payload));
}

const LINKS_CHANGED = 'links:changed'; // either → other: verse links changed
export function emitLinksChanged(): void {
  void emit(LINKS_CHANGED);
}
export function onLinksChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(LINKS_CHANGED, () => cb());
}

export function emitNotesClosed(): void {
  void emit(CLOSED);
}
export function onNotesClosed(cb: () => void): Promise<UnlistenFn> {
  return listen(CLOSED, () => cb());
}

// Open (or focus, if already open) the separate notes window, seeding its
// initial reference through the URL. Reuses the same bundle via
// ?window=notes, which main.tsx routes to NotesWindow. `onClosed` fires
// when the window is destroyed — detected from here (the creating window)
// so the popout's own close stays fully native and unblocked.
export async function openNotesWindow(initial: Reference, onClosed?: () => void): Promise<void> {
  const existing = await WebviewWindow.getByLabel(NOTES_WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const url = `index.html?window=notes&book=${encodeURIComponent(initial.book)}&chapter=${initial.chapter}`;
  const w = new WebviewWindow(NOTES_WINDOW_LABEL, {
    url,
    title: 'Foundation — Notes',
    width: 480,
    height: 740,
    minWidth: 340,
    minHeight: 420,
  });
  w.once('tauri://error', (e) => console.error('Notes window failed to open', e));
  if (onClosed) w.once('tauri://destroyed', () => onClosed());
}

export async function focusNotesWindow(): Promise<boolean> {
  const existing = await WebviewWindow.getByLabel(NOTES_WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    return true;
  }
  return false;
}

export function initialReferenceFromUrl(fallback: Reference): Reference {
  const q = new URLSearchParams(window.location.search);
  const book = q.get('book');
  const chapter = Number(q.get('chapter'));
  return book && chapter ? { book, chapter } : fallback;
}
