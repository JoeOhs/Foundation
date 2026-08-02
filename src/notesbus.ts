import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { Reference, SelectedEntry, VerseSelection } from './types';

// Cross-window channels between the main window and the popped-out notes
// window. Both share the same SQLite database; these events keep their UI
// state in sync (they carry intent/context, not the note data itself).
const CTX = 'notes:context'; // main → popout: current reference + selection
const INSERT = 'notes:insert-md'; // main → popout: scripture markdown to insert
const CHANGED = 'notes:changed'; // either → other: notes table changed, reload

export const NOTES_WINDOW_LABEL = 'notes';

export function isNotesWindow(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'notes';
}

// In-window handoff for "Add to note" when the notes panel is opened fresh:
// the editor's insert listener isn't mounted yet, so the markdown is parked
// here and the panel drains it on mount — deterministic, no timing guess.
let pendingInsert: string | null = null;
export function queueInsertMarkdown(md: string): void {
  pendingInsert = md;
}
export function takePendingInsertMarkdown(): string | null {
  const v = pendingInsert;
  pendingInsert = null;
  return v;
}

export interface NotesContext {
  ref: Reference;
  selection: VerseSelection | null;
  entrySelection: SelectedEntry | null;
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

const NAV_ENTRY = 'notes:navigate-entry'; // popout → main: jump to an imported entry
export function emitNotesNavigateEntry(entry: SelectedEntry): void {
  void emit(NAV_ENTRY, entry);
}
export function onNotesNavigateEntry(cb: (entry: SelectedEntry) => void): Promise<UnlistenFn> {
  return listen<SelectedEntry>(NAV_ENTRY, (e) => cb(e.payload));
}

const LINKS_CHANGED = 'links:changed'; // either → other: verse links changed
export function emitLinksChanged(): void {
  void emit(LINKS_CHANGED);
}
export function onLinksChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(LINKS_CHANGED, () => cb());
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

// ---------- original-page (PDF) viewer window ----------

export const REF_PAGE_WINDOW_LABEL = 'refpage';

export interface ReferencePage {
  src: string;
  page: number;
  title: string;
}

export function isReferencePageWindow(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'refpage';
}

// Opens the scanned page a Structure diagram was transcribed from, beside
// the reader. Same pop-out pattern as the notes window — one reusable
// labelled window routed by ?window=refpage — so a second "View original
// page" swaps the document rather than piling up windows.
export async function openReferencePageWindow(ref: ReferencePage): Promise<void> {
  const q = new URLSearchParams({ window: 'refpage', src: ref.src, page: String(ref.page), title: ref.title });
  const existing = await WebviewWindow.getByLabel(REF_PAGE_WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    await emit(REF_PAGE_SHOW, ref);
    return;
  }
  // Taller than wide: these are book pages, and the PDF viewer's own
  // toolbar takes a strip off the top.
  const w = new WebviewWindow(REF_PAGE_WINDOW_LABEL, {
    url: `index.html?${q.toString()}`,
    title: `Foundation — ${ref.title}`,
    width: 780,
    height: 900,
    minWidth: 360,
    minHeight: 360,
  });
  w.once('tauri://error', (e) => console.error('Original-page window failed to open', e));
}

const REF_PAGE_SHOW = 'refpage:show';

export function listenReferencePage(fn: (p: ReferencePage) => void): Promise<UnlistenFn> {
  return listen<ReferencePage>(REF_PAGE_SHOW, (e) => fn(e.payload));
}

export function initialReferencePageFromUrl(): ReferencePage | null {
  const q = new URLSearchParams(window.location.search);
  const src = q.get('src');
  if (!src) return null;
  const page = Number(q.get('page'));
  return {
    src,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    title: q.get('title') ?? 'Original page',
  };
}

export function initialReferenceFromUrl(fallback: Reference): Reference {
  const q = new URLSearchParams(window.location.search);
  const book = q.get('book');
  const chapter = Number(q.get('chapter'));
  return book && chapter ? { book, chapter } : fallback;
}
