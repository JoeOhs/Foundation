import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

export const NPNF214_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 14: The Seven Ecumenical Councils';

const BUNDLE_URL = '/library/patristic/npnf214.json';

interface BundledChapter { number: number; title: string; paragraphs: string[]; }
// `group` marks a work that sits inside a container of works — a local
// synod printed inside one of this volume's collections of them, so that
// Ancyra's canons and its historical note sit under Ancyra rather than
// beside the canons of Gangra.
interface BundledWork { title: string; group?: string; chapters: BundledChapter[]; }
// In this volume alone an "author" section is not a person: it is a council,
// a collection of local synods, or a piece of the editor's front matter. The
// shape is the same — section → work → chapter, here council → document →
// canon — so the field keeps the name the other thirteen volumes give it.
interface BundledAuthor { name: string; works: BundledWork[]; }
interface BundledNPNFFile {
  metadata: { title: string; series: string; volume: number; editor: string; license_note: string; total_paragraphs: number; };
  authors: BundledAuthor[];
}

async function loadBundle(): Promise<BundledNPNFFile> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`Couldn't load the bundled NPNF2-14 text (HTTP ${res.status})`);
  const data = (await res.json()) as BundledNPNFFile;
  if (!Array.isArray(data.authors) || data.authors.length === 0) {
    throw new Error('The bundled NPNF2-14 file is empty or malformed.');
  }
  return data;
}

function buildParsedSource(data: BundledNPNFFile): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  for (const author of data.authors) {
    // A section holding exactly one work of its own name needs no separate
    // group header: it would render as the same text twice, once as a
    // disabled header and again as the work beneath it. Dropping it lifts
    // the work and its chapters up a level.
    const soleSelfNamedWork =
      author.works.length === 1 && author.works[0].title === author.name && !author.works[0].group;
    if (!soleSelfNamedWork) toc.push({ title: author.name, level: 0, entryIndex: -1 });
    const workLevel = soleSelfNamedWork ? 0 : 1;

    let openGroup: string | null = null;
    for (const work of author.works) {
      const level = work.group ? workLevel + 1 : workLevel;
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
          chapterRows.push({ title: chapter.title, level: level + 1, entryIndex: firstEntryOfChapter, bookIndex });
        }
      }
      if (entries.length === 0) continue;

      // Grouped works are emitted contiguously by the builder, so the header
      // goes in when the group changes and never repeats.
      if (work.group !== openGroup) {
        openGroup = work.group ?? null;
        if (openGroup) toc.push({ title: openGroup, level: workLevel, entryIndex: -1 });
      }

      // A flat-run work is named after its own section, and a group's own
      // opening text after its group, so joining them unconditionally would
      // double the title in the pane's book list.
      const parts = [author.name, work.group, work.title]
        .filter((p, i, all): p is string => !!p && all.indexOf(p) === i);
      books.push({ name: parts.join(' — '), entries });
      toc.push({ title: work.title, level, entryIndex: 0, bookIndex });
      toc.push(...chapterRows);
    }
  }

  return {
    suggestedTitle: NPNF214_TITLE, suggestedType: 'extra-biblical', structure: 'freeform',
    books, warnings: [], suggestedAuthor: data.metadata.editor,
    suggestedLanguage: 'en', suggestedLicenseNote: data.metadata.license_note, toc,
  };
}

export async function installNPNF214(onProgress: (msg: string) => void): Promise<number> {
  onProgress('Loading bundled text…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);
  const sourceId = await insertParsedSource(parsed, {
    title: NPNF214_TITLE, type: 'extra-biblical', language: 'en',
    license_note: data.metadata.license_note, category: 'patristic',
  }, (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`));
  onProgress('Building table of contents…');
  await insertTocEntries(sourceId, parsed);
  return sourceId;
}
