import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

export const ANF06_TITLE =
  'Ante-Nicene Fathers, Vol. 6: Gregory Thaumaturgus, Dionysius the Great, Julius Africanus, Anatolius, and Minor Writers, Methodius, Arnobius';

const BUNDLE_URL = '/library/anf06.json';

interface BundledChapter {
  number: number;
  title: string;
  paragraphs: string[];
}

interface BundledWork {
  title: string;
  chapters: BundledChapter[];
}

interface BundledAuthor {
  name: string;
  works: BundledWork[];
}

interface BundledANF06File {
  metadata: {
    title: string;
    series: string;
    volume: number;
    editors: string;
    license_note: string;
    total_paragraphs: number;
  };
  authors: BundledAuthor[];
}

async function loadBundle(): Promise<BundledANF06File> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`Couldn't load the bundled ANF06 text (HTTP ${res.status})`);
  const data = (await res.json()) as BundledANF06File;
  if (!Array.isArray(data.authors) || data.authors.length === 0) {
    throw new Error('The bundled ANF06 file is empty or malformed.');
  }
  return data;
}

function buildParsedSource(data: BundledANF06File): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  for (const author of data.authors) {
    toc.push({ title: author.name, level: 0, entryIndex: -1 });

    for (const work of author.works) {
      const entries: ParsedEntry[] = [];
      const bookIndex = books.length;
      const chapterRows: ParsedTocEntry[] = [];

      for (const chapter of work.chapters) {
        if (chapter.paragraphs.length === 0) continue;
        const firstEntryOfChapter = entries.length;
        chapter.paragraphs.forEach((text, i) => {
          entries.push({
            chapter: chapter.number,
            verse: null,
            position_ref: i === 0 ? chapter.title : null,
            text,
          });
        });
        if (work.chapters.length > 1) {
          chapterRows.push({
            title: chapter.title,
            level: 2,
            entryIndex: firstEntryOfChapter,
            bookIndex,
          });
        }
      }

      if (entries.length === 0) continue;
      books.push({ name: `${author.name} — ${work.title}`, entries });
      toc.push({ title: work.title, level: 1, entryIndex: 0, bookIndex });
      toc.push(...chapterRows);
    }
  }

  return {
    suggestedTitle: ANF06_TITLE,
    suggestedType: 'extra-biblical',
    structure: 'freeform',
    books,
    warnings: [],
    suggestedAuthor: data.metadata.editors,
    suggestedLanguage: 'en',
    suggestedLicenseNote: data.metadata.license_note,
    toc,
  };
}

export async function installANF06(onProgress: (msg: string) => void): Promise<number> {
  onProgress('Loading bundled text…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);

  const sourceId = await insertParsedSource(
    parsed,
    {
      title: ANF06_TITLE,
      type: 'extra-biblical',
      language: 'en',
      license_note: data.metadata.license_note,
      category: 'patristic',
    },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );

  onProgress('Building table of contents…');
  await insertTocEntries(sourceId, parsed);
  return sourceId;
}
