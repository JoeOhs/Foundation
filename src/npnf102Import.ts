import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

export const NPNF102_TITLE =
  'Nicene and Post-Nicene Fathers, Series I, Vol. 2: Augustine: City of God, On Christian Doctrine';

const BUNDLE_URL = '/library/patristic/npnf102.json';

interface BundledChapter { number: number; title: string; paragraphs: string[]; }
interface BundledWork { title: string; chapters: BundledChapter[]; }
interface BundledAuthor { name: string; works: BundledWork[]; }
interface BundledNPNFFile {
  metadata: { title: string; series: string; volume: number; editor: string; license_note: string; total_paragraphs: number; };
  authors: BundledAuthor[];
}

async function loadBundle(): Promise<BundledNPNFFile> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`Couldn't load the bundled NPNF1-02 text (HTTP ${res.status})`);
  const data = (await res.json()) as BundledNPNFFile;
  if (!Array.isArray(data.authors) || data.authors.length === 0) {
    throw new Error('The bundled NPNF1-02 file is empty or malformed.');
  }
  return data;
}

function buildParsedSource(data: BundledNPNFFile): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  for (const author of data.authors) {
    // A section holding exactly one work of its own name — Vol. 11's 55
    // homilies on Acts — needs no separate group header: it would render as
    // the same text twice, once as a disabled header and again as the work
    // beneath it. Dropping it lifts the work and its homilies up a level, so
    // a homily set reads Work → Homily rather than being pushed to the
    // Book → Chapter depth the Augustine treatises need.
    const soleSelfNamedWork = author.works.length === 1 && author.works[0].title === author.name;
    if (!soleSelfNamedWork) toc.push({ title: author.name, level: 0, entryIndex: -1 });
    const workLevel = soleSelfNamedWork ? 0 : 1;

    for (const work of author.works) {
      const entries: ParsedEntry[] = [];
      const bookIndex = books.length;
      const chapterRows: ParsedTocEntry[] = [];
      for (const chapter of work.chapters) {
        if (chapter.paragraphs.length === 0) continue;
        const firstEntryOfChapter = entries.length;
        chapter.paragraphs.forEach((text, i) => {
          entries.push({ chapter: chapter.number, verse: null, position_ref: i === 0 ? chapter.title : null, text });
        });
        if (work.chapters.length > 1) {
          chapterRows.push({ title: chapter.title, level: workLevel + 1, entryIndex: firstEntryOfChapter, bookIndex });
        }
      }
      if (entries.length === 0) continue;
      // A flat-run work is named after its own section, so joining them
      // unconditionally would double the title in the pane's book list.
      const bookName = work.title === author.name ? author.name : `${author.name} — ${work.title}`;
      books.push({ name: bookName, entries });
      toc.push({ title: work.title, level: workLevel, entryIndex: 0, bookIndex });
      toc.push(...chapterRows);
    }
  }

  return {
    suggestedTitle: NPNF102_TITLE, suggestedType: 'extra-biblical', structure: 'freeform',
    books, warnings: [], suggestedAuthor: data.metadata.editor,
    suggestedLanguage: 'en', suggestedLicenseNote: data.metadata.license_note, toc,
  };
}

export async function installNPNF102(onProgress: (msg: string) => void): Promise<number> {
  onProgress('Loading bundled text…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);
  const sourceId = await insertParsedSource(parsed, {
    title: NPNF102_TITLE, type: 'extra-biblical', language: 'en',
    license_note: data.metadata.license_note, category: 'patristic',
  }, (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`));
  onProgress('Building table of contents…');
  await insertTocEntries(sourceId, parsed);
  return sourceId;
}
