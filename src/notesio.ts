import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { addNote, allNotes } from './db';
import { legacyToMarkdown, notesToMarkdownExport } from './notesconvert';

// ---- Tauri-side actions (dialog + file IO + DB) ----

export async function exportAllNotes(): Promise<'saved' | 'empty' | 'cancelled'> {
  const notes = await allNotes();
  if (notes.length === 0) return 'empty';
  const path = await save({
    title: 'Export notes',
    defaultPath: `foundation-notes-${new Date().toISOString().slice(0, 10)}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (!path) return 'cancelled';
  await invoke('write_file_text', { path, contents: notesToMarkdownExport(notes) });
  return 'saved';
}

export async function importNotesFromFiles(): Promise<number> {
  const picked = await open({
    multiple: true,
    title: 'Import notes',
    filters: [
      { name: 'Notes', extensions: ['md', 'markdown', 'txt', 'rtf', 'html', 'htm'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (!picked) return 0;
  const paths = Array.isArray(picked) ? picked : [picked];
  let count = 0;
  for (const path of paths) {
    const raw = await invoke<string>('read_file_text', { path });
    const { title, content } = legacyToMarkdown(path, raw);
    if (!content) continue;
    // imported notes land as free-floating; the user can re-anchor later
    await addNote({ title: title || null, content });
    count++;
  }
  return count;
}
