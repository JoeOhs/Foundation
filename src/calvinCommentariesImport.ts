// Dedicated, fixed-schema importer for Calvin's Commentaries. Deliberately
// NOT routed through importer.ts's format sniffing: the input is a known set
// of bundles produced by tools/calvin-commentaries/build.mjs.
//
// Source text: John Calvin's verse-by-verse commentaries in the Calvin
// Translation Society's English translation (Edinburgh, 1844–56), digitised
// by CCEL as ThML. Public domain — the translators died over a century ago,
// and every one of the 45 CCEL volumes declares DC.Rights "Public Domain",
// which the build script checks per volume and refuses to build without. See
// tools/calvin-commentaries/build.mjs for provenance, that licence guard, and
// what the build excludes.
//
// Reads bundles shipped inside the app (public/library/commentaries/calvin/),
// so this makes no network request.
//
// TYPE — 'footer-commentary', the same as JFB: read in the study footer's
// Commentary tab as a strip of verse cells following Pane 1's chapter, with
// `isFooterOnly` (sourceRoles.ts) keeping it out of every pane's source
// picker. One comment is ONE entry, its paragraphs joined by a blank line,
// which is what the footer cell splits on to lay them out — an entry per
// paragraph would shatter a single comment into a dozen identical verse
// cells, since buildChapterIndex() treats one entry as one cell.
//
// ONE SOURCE, NOT ONE PER BOOK-GROUP. The 23 bundles on disk stay as they
// are — they are the build's unit, and keeping them lets the largest single
// file stay at 4.3MB — but they install as a SINGLE source with one `books`
// row per Bible book, so the Library and the footer's dropdown each carry one
// row reading "John Calvin's Commentaries", beside JFB.
//
// This replaced an earlier split into 23 independently installable sources.
// The split's justification was that the corpus is 34MB against JFB's 12MB,
// but that compared file sizes when the cost that actually governs an install
// is row count — and Calvin is 13,459 entries against JFB's 19,442, a third
// FEWER. The 34MB is long comments (2,590 chars average, against JFB's 540),
// not more of them. Against that non-reason sat a real cost: the footer's
// commentary picker is one dropdown that does not follow the book being read,
// so 23 sources meant a 24-entry list and a manual switch at every book
// boundary — "No commentary on Romans 1" until you worked out that Romans
// lived in "Calvin 17". JFB never poses that question because one source
// covers all 66 books, and the whole point of the strip is that it follows
// you. One source restores that.
//
// A book Calvin never wrote on (Judges through Esther, Job, Proverbs,
// Ecclesiastes, Song of Solomon, 2 John, 3 John, Revelation — 18 of the 66)
// simply has no `books` row, so the footer finds no comments and says so,
// exactly as it does for a chapter JFB passes over. That is the intended
// behaviour, not a gap to paper over.
//
// ANCHORING — entries.verse carries the verse and entries.position_ref the
// range covered, the same two columns JFB uses. Every range here is a single
// verse: no comment in this corpus is anchored to a span, so no cell ever
// nests inside another the way 2,713 of JFB's verses do.
//
// Re-running rebuilds the source from scratch rather than duplicating it, and
// deleting the source removes everything below.

import { CANONICAL_BOOKS } from './bibleMeta';
import { deleteSource, findSourceByTitle, insertParsedSource } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource } from './types';

export const CALVIN_TITLE = "John Calvin's Commentaries";

const LICENSE_NOTE =
  'John Calvin (1509–1564) — public domain. English text from the Calvin Translation Society '
  + 'edition (Edinburgh, 1844–56), translated by a team of period translators including John King, '
  + 'Charles Bingham, James Anderson and William Pringle, and digitised by CCEL from the OnLine '
  + 'Bible project\'s transcription of all 45 volumes, each of which declares DC.Rights "Public '
  + 'Domain". Calvin\'s own Scripture citations are kept; the parallel Authorised Version / '
  + 'Calvin\'s-Latin Scripture tables, the CTS editors\' footnotes and the volumes\' front and back '
  + 'matter are excluded and logged to tools/calvin-commentaries/exclusions.txt. Built by '
  + 'tools/calvin-commentaries/build.mjs, which refuses any volume that does not declare itself '
  + 'public domain and name Calvin as its author.';

// The bundle files to fold together, in the order the build writes them.
// `label` is used only for the install progress message — the book-group is
// no longer a unit the user ever sees, so it carries no number and no title.
const CALVIN_BUNDLES: { key: string; label: string }[] = [
  { key: 'genesis', label: 'Genesis' },
  { key: 'harmony-law', label: 'the Harmony of the Law' },
  { key: 'joshua', label: 'Joshua' },
  { key: 'psalms', label: 'the Psalms' },
  { key: 'isaiah', label: 'Isaiah' },
  { key: 'jeremiah', label: 'Jeremiah and Lamentations' },
  { key: 'ezekiel', label: 'Ezekiel' },
  { key: 'daniel', label: 'Daniel' },
  { key: 'hosea', label: 'Hosea' },
  { key: 'joel-amos-obadiah', label: 'Joel, Amos and Obadiah' },
  { key: 'jonah-micah-nahum', label: 'Jonah, Micah and Nahum' },
  { key: 'habakkuk-zephaniah-haggai', label: 'Habakkuk, Zephaniah and Haggai' },
  { key: 'zechariah-malachi', label: 'Zechariah and Malachi' },
  { key: 'harmony-gospels', label: 'the Harmony of the Evangelists' },
  { key: 'john', label: 'John' },
  { key: 'acts', label: 'Acts' },
  { key: 'romans', label: 'Romans' },
  { key: 'corinthians', label: 'the Corinthian epistles' },
  { key: 'galatians-ephesians', label: 'Galatians and Ephesians' },
  { key: 'philippians-colossians-thessalonians', label: 'Philippians, Colossians and Thessalonians' },
  { key: 'timothy-titus-philemon', label: 'Timothy, Titus and Philemon' },
  { key: 'hebrews', label: 'Hebrews' },
  { key: 'catholic-epistles', label: 'the Catholic Epistles' },
];

interface BundleComment {
  chapter: number;
  // first verse covered — entries.verse, and what the strip sorts on
  verse: number;
  // every verse covered, as a range string; always a single verse here
  verses: string;
  // the whole comment, paragraphs separated by a blank line
  text: string;
}

interface BundleBook {
  book: string;
  comments: BundleComment[];
}

interface CalvinBundle {
  metadata: { work: string; comment_count: number };
  books: BundleBook[];
}

async function loadBundle(key: string): Promise<CalvinBundle> {
  const res = await fetch(`/library/commentaries/calvin/calvin-${key}.json`);
  if (!res.ok) {
    throw new Error(
      `Could not load the bundled Calvin commentary (${key}): ${res.status} ${res.statusText}.`,
    );
  }
  const data = (await res.json()) as CalvinBundle;
  if (!data.books || data.books.length === 0) {
    throw new Error(`The bundled Calvin commentary for ${key} contains no books.`);
  }
  return data;
}

const BOOK_ORDER = new Map(CANONICAL_BOOKS.map((name, i) => [name, i]));

// Fold every bundle's books into one source. No Bible book is split across
// two bundles today — each falls wholly inside one book-group — but the
// comments are accumulated per book name and re-sorted anyway rather than
// assuming that, since the alternative is a silently half-ordered book if a
// future regrouping ever splits one.
function buildParsedSource(bundles: CalvinBundle[]): ParsedSource {
  const byBook = new Map<string, BundleComment[]>();
  for (const bundle of bundles) {
    for (const b of bundle.books) {
      const existing = byBook.get(b.book);
      if (existing) existing.push(...b.comments);
      else byBook.set(b.book, [...b.comments]);
    }
  }

  const books: ParsedBook[] = [...byBook.entries()]
    // Canonical order, so the source's books read Genesis-to-Jude rather than
    // in whatever order the bundles happened to be fetched. insertParsedSource
    // takes books.sort_order from this array's index.
    .sort((a, b) => (BOOK_ORDER.get(a[0]) ?? 0) - (BOOK_ORDER.get(b[0]) ?? 0))
    .map(([name, comments]): ParsedBook => ({
      name,
      entries: comments
        .slice()
        .sort((x, y) => (x.chapter - y.chapter) || (x.verse - y.verse))
        .map((c): ParsedEntry => ({
          chapter: c.chapter,
          verse: c.verse,
          position_ref: c.verses,
          text: c.text,
        })),
    }));

  return {
    suggestedTitle: CALVIN_TITLE,
    suggestedType: 'footer-commentary',
    // Verse-keyed, so it follows a book/chapter reference. Like JFB and
    // unlike the Companion Bible's notes it never becomes a pane —
    // sourceRoles' isFooterOnly keeps it out of every pane's source picker.
    structure: 'verse-keyed',
    books,
    warnings: [],
    suggestedAuthor: 'John Calvin',
    suggestedLanguage: 'en',
    suggestedLicenseNote: LICENSE_NOTE,
  };
}

// Returns the new source's id so the caller can open it straight away.
//
// The bundles are fetched one at a time rather than in parallel: only one
// raw JSON string is then alive at once (the largest is 4.3MB), instead of
// all 34MB of them, and the progress message can name what it is reading.
export async function installCalvinCommentaries(
  onProgress: (msg: string) => void,
): Promise<number> {
  const bundles: CalvinBundle[] = [];
  for (let i = 0; i < CALVIN_BUNDLES.length; i++) {
    const { key, label } = CALVIN_BUNDLES[i];
    onProgress(`Loading Calvin on ${label}… (${i + 1}/${CALVIN_BUNDLES.length})`);
    bundles.push(await loadBundle(key));
  }

  onProgress('Arranging the commentary by book…');
  const parsed = buildParsedSource(bundles);

  // Idempotent rebuild, reusing deleteSource rather than a bespoke clear so
  // "re-install" and "delete" stay on exactly the same cascade.
  const existing = await findSourceByTitle(CALVIN_TITLE);
  if (existing) {
    onProgress('Removing the previous copy…');
    await deleteSource(existing.id);
  }

  return insertParsedSource(
    parsed,
    {
      title: CALVIN_TITLE,
      type: 'footer-commentary',
      language: 'en',
      license_note: LICENSE_NOTE,
      category: 'commentary',
    },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );
}
