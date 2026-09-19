// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads the 45 volumes of Calvin's Commentaries from CCEL as ThML
// XML and writes one bundle per book-group into
// public/library/commentaries/calvin/ — each shaped to feed Foundation's
// verse-keyed import (one source, one `books` row per Bible book, one entry
// per comment), for the study footer's Commentary tab alongside JFB.
//
// PROVENANCE — read before changing any URL below.
// Source: CCEL's "Calvin's Commentaries — Complete"
//   https://www.ccel.org/ccel/calvin/commentaries.i.html
// which is the Calvin Translation Society's English translation (Edinburgh,
// 1844–56; multiple period translators — John King, Charles Bingham, James
// Anderson, William Pringle and others), digitised by CCEL from the OnLine
// Bible project's Ages Software transcription. Each volume is fetched as
// ThML from https://ccel.org/ccel/calvin/calcomNN.xml.
//
// LICENCE GUARD. Every volume's own ThML head carries a Dublin Core rights
// statement, and the build refuses to proceed unless that statement reads
// "Public Domain" for the specific volume being built — the same hard fail
// as jfb/build.mjs, josephus/build.mjs and talmud/build.mjs. This is checked
// per volume rather than once for the set because Internet Archive's mirror
// of this same corpus carries a "mostly public domain, some restricted to
// non-commercial use" caveat; that caveat is about a later reprint layered
// on the CTS text, but the point of a guard is not to take that on trust.
// The CTS translation itself is from the 1840s–50s and has no realistic path
// back into copyright.
//
// WHAT THIS CORPUS ACTUALLY COVERS. Calvin is often described as commenting
// on nearly the whole Bible; the measured set is 48 of the 66 books. Present:
// Genesis, Exodus–Deuteronomy (as the Harmony of the Law), Joshua, Psalms,
// Isaiah, Jeremiah, Lamentations, Ezekiel, Daniel, the Twelve Minor Prophets,
// Matthew/Mark/Luke (as the Harmony of the Evangelists), John, Acts, and
// every epistle except 2 John and 3 John. Absent: Judges through Esther, Job,
// Proverbs, Ecclesiastes, Song of Solomon, 2 John, 3 John and Revelation.
//
// HOW A COMMENT IS FOUND. CCEL's digitisation carries the OnLine Bible's
// verse tagging: each comment opens with a <scripCom> milestone whose osisRef
// names the verse. That milestone is both the anchor and the boundary, and
// neither job is given to the <div class="Commentary"> wrapper that usually
// follows it — see extractVolume() for why the wrapper cannot be trusted with
// either. The corpus carries 14,052 milestones: 591 are chapter-level markers
// heading a Scripture table, and the remaining 13,461 name a verse. None of
// them is a range — every anchor is a single verse, which is the one place
// this corpus is simpler than JFB and its "5-6" spans. Two of the 13,461 are
// empty placeholders CCEL emitted twice for the same verse, leaving 13,459
// comments and 37,569 paragraphs in the bundles.
//
// ONE COMMENT IS ONE ENTRY, in the shape jfb.json already uses: the comment's
// paragraphs are joined by a blank line into a single `text`, with `verse`
// and `verses` carrying the anchor. These bundles feed the study footer's
// Commentary tab, whose buildChapterIndex() treats one entry as one cell, so
// emitting an entry per paragraph would shatter a single comment into a dozen
// identical verse cells.
//
// THE TWO HARMONIES NEED NO SPECIAL MODEL. Harmony of the Law (Exodus–
// Deuteronomy) and Harmony of the Evangelists (Matthew/Mark/Luke) organise
// their divisions topically rather than by book — "The Law: The First
// Commandment", not "Exodus 20" — and Calvin discusses corresponding
// passages side by side. Inspecting the markup settles it: every comment in
// both works still carries exactly one <scripCom> naming one book and one
// verse, so each anchors to that verse like any other comment, and its
// cross-book references stay inline as Calvin's own prose. The topical
// division titles are not needed to place a comment and are not carried.
//
// WHAT IS EXCLUDED, AND WHY.
//   - The parallel Authorised Version / Calvin's-Latin tables that head each
//     chapter. They are Scripture text, not exposition; Foundation already
//     ships the KJV, and a commentary that reprints the text it comments on
//     would duplicate what the reader already has open. <table> marks nothing
//     else in this corpus, so they are removed wholesale before extraction.
//   - Editorial and translators' footnotes (<note place="foot">), the CTS
//     editors' apparatus rather than Calvin. Same call as Whiston's footnotes
//     in josephus/build.mjs and the editorial notes in the ANF/NPNF builds.
//   - Front matter and back matter: the translators' prefaces, the facsimile
//     title pages, the publishers' dedicatory epistles, and CCEL's indexes of
//     Greek/Hebrew/Latin/French words. None of it is verse-anchored, and a
//     verse-keyed source has nowhere to put it — the same call jfb/build.mjs
//     makes for JFB's introductions. Calvin's OWN front matter (his
//     Arguments, Prefaces and Epistles Dedicatory) is kept out of the verse
//     bundles for the same reason but not dropped: it is written to a
//     separate reading bundle, see FRONT_MATTER below.
// Every exclusion is logged to exclusions.txt with its volume, byte count and
// opening words, so the decision stays auditable instead of invisible.
//
// Resumable: raw ThML is cached under raw/, so a re-run skips the download.
//
// Usage:
//   node build.mjs              download (or reuse cache) and build
//   node build.mjs --refetch    ignore the cache and re-download

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(HERE, 'raw');
const OUT_DIR = join(HERE, 'bundles');
const DEPLOY_DIR = join(HERE, '..', '..', 'public', 'library', 'commentaries', 'calvin');
const EXCLUSIONS_PATH = join(HERE, 'exclusions.txt');

const USER_AGENT =
  'FoundationCalvinBuilder/1.0 (personal, non-commercial, offline Bible study app; '
  + 'one-time archival fetch; contact: shintax909@gmail.com)';

const REFETCH = process.argv.includes('--refetch');

// ---------- canonical book names ----------
//
// OSIS abbreviations as they appear in CCEL's scripCom osisRefs, paired with
// the book names Foundation uses (src/bibleMeta.ts CANONICAL_BOOKS).
// Duplicated here rather than imported because this script runs outside the
// app's TypeScript build — the same reason jfb/build.mjs duplicates it.
// Only the 48 books this corpus actually reaches are listed; an osisRef
// naming anything else is a hard error rather than a silent drop.
const OSIS_TO_CANONICAL = new Map(Object.entries({
  Gen: 'Genesis',
  Exod: 'Exodus',
  Lev: 'Leviticus',
  Num: 'Numbers',
  Deut: 'Deuteronomy',
  Josh: 'Joshua',
  Ps: 'Psalms',
  Isa: 'Isaiah',
  Jer: 'Jeremiah',
  Lam: 'Lamentations',
  Ezek: 'Ezekiel',
  Dan: 'Daniel',
  Hos: 'Hosea',
  Joel: 'Joel',
  Amos: 'Amos',
  Obad: 'Obadiah',
  Jonah: 'Jonah',
  Mic: 'Micah',
  Nah: 'Nahum',
  Hab: 'Habakkuk',
  Zeph: 'Zephaniah',
  Hag: 'Haggai',
  Zech: 'Zechariah',
  Mal: 'Malachi',
  Matt: 'Matthew',
  Mark: 'Mark',
  Luke: 'Luke',
  John: 'John',
  Acts: 'Acts',
  Rom: 'Romans',
  '1Cor': '1 Corinthians',
  '2Cor': '2 Corinthians',
  Gal: 'Galatians',
  Eph: 'Ephesians',
  Phil: 'Philippians',
  Col: 'Colossians',
  '1Thess': '1 Thessalonians',
  '2Thess': '2 Thessalonians',
  '1Tim': '1 Timothy',
  '2Tim': '2 Timothy',
  Titus: 'Titus',
  Phlm: 'Philemon',
  Heb: 'Hebrews',
  Jas: 'James',
  '1Pet': '1 Peter',
  '2Pet': '2 Peter',
  '1John': '1 John',
  Jude: 'Jude',
}));

// Canonical Protestant order, used to sort the `books` rows within a group.
const BOOK_ORDER = new Map([
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Psalms',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', 'Jude',
].map((name, i) => [name, i]));

// ---------- the book-group split ----------
//
// One source per natural book-group, following how CCEL itself groups the
// work rather than the 45 physical CTS volumes. `order` is carried into the
// title because the Library sorts rows within a series group by title, and
// these groups have no number of their own — without one they would shelve
// alphabetically, opening on Acts. Same fix the Talmud's Sedarim and the
// Church Fathers' volumes use.
const GROUPS = [
  { key: 'genesis', order: 1, label: 'Genesis', volumes: ['calcom01', 'calcom02'] },
  { key: 'harmony-law', order: 2, label: 'Harmony of the Law (Exodus–Deuteronomy)', volumes: ['calcom03', 'calcom04', 'calcom05', 'calcom06'] },
  { key: 'joshua', order: 3, label: 'Joshua', volumes: ['calcom07'] },
  { key: 'psalms', order: 4, label: 'Psalms', volumes: ['calcom08', 'calcom09', 'calcom10', 'calcom11', 'calcom12'] },
  { key: 'isaiah', order: 5, label: 'Isaiah', volumes: ['calcom13', 'calcom14', 'calcom15', 'calcom16'] },
  { key: 'jeremiah', order: 6, label: 'Jeremiah and Lamentations', volumes: ['calcom17', 'calcom18', 'calcom19', 'calcom20', 'calcom21'] },
  { key: 'ezekiel', order: 7, label: 'Ezekiel', volumes: ['calcom22', 'calcom23'] },
  { key: 'daniel', order: 8, label: 'Daniel', volumes: ['calcom24', 'calcom25'] },
  { key: 'hosea', order: 9, label: 'Hosea', volumes: ['calcom26'] },
  { key: 'joel-amos-obadiah', order: 10, label: 'Joel, Amos, Obadiah', volumes: ['calcom27'] },
  { key: 'jonah-micah-nahum', order: 11, label: 'Jonah, Micah, Nahum', volumes: ['calcom28'] },
  { key: 'habakkuk-zephaniah-haggai', order: 12, label: 'Habakkuk, Zephaniah, Haggai', volumes: ['calcom29'] },
  { key: 'zechariah-malachi', order: 13, label: 'Zechariah, Malachi', volumes: ['calcom30'] },
  { key: 'harmony-gospels', order: 14, label: 'Harmony of the Evangelists (Matthew, Mark, Luke)', volumes: ['calcom31', 'calcom32', 'calcom33'] },
  { key: 'john', order: 15, label: 'John', volumes: ['calcom34', 'calcom35'] },
  { key: 'acts', order: 16, label: 'Acts', volumes: ['calcom36', 'calcom37'] },
  { key: 'romans', order: 17, label: 'Romans', volumes: ['calcom38'] },
  { key: 'corinthians', order: 18, label: 'Corinthians', volumes: ['calcom39', 'calcom40'] },
  { key: 'galatians-ephesians', order: 19, label: 'Galatians, Ephesians', volumes: ['calcom41'] },
  { key: 'philippians-colossians-thessalonians', order: 20, label: 'Philippians, Colossians, Thessalonians', volumes: ['calcom42'] },
  { key: 'timothy-titus-philemon', order: 21, label: 'Timothy, Titus, Philemon', volumes: ['calcom43'] },
  { key: 'hebrews', order: 22, label: 'Hebrews', volumes: ['calcom44'] },
  { key: 'catholic-epistles', order: 23, label: 'Catholic Epistles (James, Peter, John, Jude)', volumes: ['calcom45'] },
];

// ---------- Calvin's own front matter ----------
//
// The Arguments, Prefaces and Epistles Dedicatory Calvin wrote for his
// commentaries. They are not verse-anchored, so the verse bundles above
// cannot hold them; they ship instead as one reading work beside the
// Institutes (public/library/reformation/calvin-prefaces.json).
//
// An explicit allow-list, one decision per piece, like the Institutes'
// PREFATORY_KEEP. A volume's front matter mixes Calvin with his translators,
// printers and later dedicators (Golding, Cotton, Paget, Featherstone,
// Beza, Gallars, Budaeus, Crispin, Jonviller), so nothing is swept in by
// pattern. Each piece is found by the opening words of its division's text,
// not by its title attribute: several volumes title every piece "front ii"
// or "The Argument", and the attributes are not consistently formed. Every
// entry must match exactly one division or the build stops, so a CCEL
// restructure cannot silently drop a piece or ship the wrong one.
//
// Not here: Calvin's Prefaces to Jeremiah, Daniel and Malachi, whose
// divisions are headings only (the preface is spoken at the start of Lecture
// One, part of the verse commentary). Nor the prayers that close each
// lecture, or the Harmony of the Law's topical introductions; see ROADMAP.md.
const FRONT_MATTER = [
  { volume: 'calcom01', group: 'genesis', title: 'Epistle Dedicatory, to Henry, Duke of Vendôme', opens: 'THE AUTHOR’S EPISTLE DEDICATORY John Calvin to the Most Illustrious Prince, Henry' },
  { volume: 'calcom01', group: 'genesis', title: 'The Argument', opens: 'Argument. Since the infinite wisdom of God' },
  { volume: 'calcom03', group: 'harmony-law', title: 'Preface', opens: 'THE PREFACE OF JOHN CALVIN TO THE FOUR LAST BOOKS OF MOSES' },
  { volume: 'calcom07', group: 'joshua', title: 'The Argument', opens: 'ARGUMENT OF THE BOOK OF JOSHUA.' },
  { volume: 'calcom08', group: 'psalms', title: 'Preface, to the Godly Readers', opens: 'THE AUTHOR’S PREFACE JOHN CALVIN TO THE GODLY AND INGENUOUS READERS' },
  { volume: 'calcom13', group: 'isaiah', title: 'Epistle Dedicatory, to Edward VI (1550)', opens: 'TO HIS SERENE HIGHNESS, EDWARD SIXTH, KING OF ENGLAND' },
  { volume: 'calcom13', group: 'isaiah', title: 'Epistle Dedicatory, to Queen Elizabeth (1559)', opens: 'TO HER SERENE HIGHNESS, NOT LESS ILLUSTRIOUS BY HER OWN VIRTUES' },
  { volume: 'calcom13', group: 'isaiah', title: 'Preface', opens: 'THE PREFACE TO THE PROPHET ISAIAH BY JOHN CALVIN' },
  { volume: 'calcom17', group: 'jeremiah', title: 'Epistle Dedicatory, to Frederick, Elector Palatine', opens: 'TO THE MOST ILLUSTRIOUS PRINCE, D. FREDERICK, LORD PALATINE' },
  { volume: 'calcom21', group: 'jeremiah', title: 'Preface to Lamentations', opens: 'PRELECTIONS OF JOHN CALVIN ON THE LAMENTATIONS OF JEREMIAH PREFACE' },
  { volume: 'calcom24', group: 'daniel', title: 'Epistle Dedicatory, to the Worshippers of God in France', opens: 'DEDICATORY EPISTLE. JOHN CALVIN To ALL THE Pious WORSHIPPERS OF GOD' },
  { volume: 'calcom26', group: 'hosea', title: 'Epistle Dedicatory, to Gustavus, King of Sweden', opens: 'THE EPISTLE DEDICATORY JOHN CALVIN To The Most Serene And Most Mighty KING GUSTAVUS' },
  { volume: 'calcom26', group: 'hosea', title: 'To the Christian Reader', opens: 'JOHN CALVIN TO THE CHRISTIAN READER, HEALTH' },
  { volume: 'calcom26', group: 'hosea', title: 'The Argument', opens: 'The Commentaries of John Calvin on the Prophet Hosea' },
  { volume: 'calcom27', group: 'joel-amos-obadiah', title: 'Preface to Joel', opens: 'Calvin’s Preface to Joel' },
  { volume: 'calcom27', group: 'joel-amos-obadiah', title: 'Preface to Obadiah', opens: 'Calvin’s Preface To Obadiah' },
  { volume: 'calcom28', group: 'jonah-micah-nahum', title: 'Preface to Micah', opens: 'Calvin’s Preface to Micah' },
  { volume: 'calcom28', group: 'jonah-micah-nahum', title: 'Preface to Nahum', opens: 'Calvin’s Preface to Nahum' },
  { volume: 'calcom29', group: 'habakkuk-zephaniah-haggai', title: 'Preface to Habakkuk', opens: 'Calvin’s Preface to Habakkuk' },
  { volume: 'calcom29', group: 'habakkuk-zephaniah-haggai', title: 'Preface to Zephaniah', opens: 'Calvin’s Preface to zephaniah' },
  { volume: 'calcom29', group: 'habakkuk-zephaniah-haggai', title: 'Preface to Haggai', opens: 'Calvin’s Preface to Haggai' },
  { volume: 'calcom30', group: 'zechariah-malachi', title: 'Preface to Zechariah', opens: 'calvin’s preface to zechariah' },
  { volume: 'calcom31', group: 'harmony-gospels', title: 'Epistle Dedicatory, to the Magistrates of Frankfort', opens: 'THE AUTHOR’S EPISTLE DEDICATORY TO The Very Noble And Illustrious Lords, THE BURGOMASTERS' },
  { volume: 'calcom31', group: 'harmony-gospels', title: 'The Argument', opens: 'THE ARGUMENT ON THE GOSPEL OF JESUS CHRIST ACCORDING TO MATTHEW, MARK, AND LUKE' },
  { volume: 'calcom34', group: 'john', title: 'Epistle Dedicatory, to the Syndics and Council of Geneva', opens: 'THE AUTHOR’S EPISTLE DEDICATORY To The TRULY HONOURABLE AND ILLUSTRIOUS LORDS, THE SYNDICS' },
  { volume: 'calcom34', group: 'john', title: 'The Argument', opens: 'THE ARGUMENT OF THE GOSPEL OF JOHN' },
  { volume: 'calcom36', group: 'acts', title: 'Epistle Dedicatory, to Nicolas Radziwiłł', opens: 'TO THE MOST RENOWNED PRINCE, THE LORD NICOLAS RADZIWILL' },
  { volume: 'calcom36', group: 'acts', title: 'The Argument', opens: 'THE ARGUMENT UPON THE ACTS OF THE APOSTLES.' },
  { volume: 'calcom38', group: 'romans', title: 'Epistle Dedicatory, to Simon Grynaeus', opens: 'THE EPISTLE DEDICATORY JOHN CALVIN TO SIMON GRYNÆUS' },
  { volume: 'calcom38', group: 'romans', title: 'The Argument', opens: 'EPISTLE TO THE ROMANS. THE ARGUMENT' },
  { volume: 'calcom39', group: 'corinthians', title: '1 Corinthians: First Epistle Dedicatory, to James of Burgundy', opens: 'THE AUTHOR’S FIRST EPISTLE DEDICATORY TO THAT ILLUSTRIOUS MAN, JAMES OF BURGUNDY' },
  { volume: 'calcom39', group: 'corinthians', title: '1 Corinthians: Second Epistle Dedicatory, to Galeazzo Caracciolo', opens: 'THE AUTHOR’S SECOND EPISTLE DEDICATORY TO LORD GALLIAZUS CARACCIOLUS' },
  { volume: 'calcom39', group: 'corinthians', title: '1 Corinthians: The Argument', opens: 'THE ARGUMENT ON THE FIRST EPISTLE TO THE CORINTHIANS' },
  { volume: 'calcom40', group: 'corinthians', title: '2 Corinthians: Epistle Dedicatory, to Melchior Wolmar', opens: 'THE AUTHOR’S DEDICATORY EPISTLE. TO THAT MOST ACCOMPLISHED MAN, MELCHIOR WOLMAR' },
  { volume: 'calcom40', group: 'corinthians', title: '2 Corinthians: The Argument', opens: 'THE ARGUMENT ON THE SECOND EPISTLE TO THE CORINTHIANS.' },
  { volume: 'calcom41', group: 'galatians-ephesians', title: 'Epistle Dedicatory, to Christopher, Duke of Württemberg', opens: 'TO THE MOST ILLUSTRIOUS PRINCE CHRISTOPER, DUKE OF WIRTEMBERG' },
  { volume: 'calcom41', group: 'galatians-ephesians', title: 'Galatians: The Argument', opens: 'THE ARGUMENT OF THE EPISTLE OF PAUL TO THE GALATIANS.' },
  { volume: 'calcom41', group: 'galatians-ephesians', title: 'Ephesians: The Argument', opens: 'THE ARGUMENT Ephesus, which is familiarly known' },
  { volume: 'calcom42', group: 'philippians-colossians-thessalonians', title: 'Philippians: The Argument', opens: 'THE ARGUMENT ON THE EPISTLE OF PAUL TO THE PHILIPPIANS' },
  { volume: 'calcom42', group: 'philippians-colossians-thessalonians', title: 'Colossians: The Argument', opens: 'THE ARGUMENT ON THE EPISTLE OF PAUL TO THE COLOSSIANS.' },
  { volume: 'calcom42', group: 'philippians-colossians-thessalonians', title: '1 Thessalonians: Epistle Dedicatory, to Mathurin Cordier', opens: 'THE AUTHOR’S DEDICATORY EPISTLE. TO MATURINUS CORDERIUS' },
  { volume: 'calcom42', group: 'philippians-colossians-thessalonians', title: '1 Thessalonians: The Argument', opens: 'ARGUMENT ON THE FIRST EPISTLE TO THE THESSALONIANS.' },
  { volume: 'calcom42', group: 'philippians-colossians-thessalonians', title: '2 Thessalonians: Epistle Dedicatory, to Benedict Textor', opens: 'THE AUTHOR’S DEDICATORY EPISTLE. TO THAT DISTINGUISHED MAN BENEDICT TEXTOR' },
  { volume: 'calcom42', group: 'philippians-colossians-thessalonians', title: '2 Thessalonians: The Argument', opens: 'THE ARGUMENT ON THE SECOND EPISTLE TO THE THESSALONIANS.' },
  { volume: 'calcom43', group: 'timothy-titus-philemon', title: '1 Timothy: Epistle Dedicatory, to Edward, Duke of Somerset', opens: 'TO THE MOST NOBLE AND TRULY CHRISTIAN PRINCE, EDWARD, DUKE OF SOMERSET' },
  { volume: 'calcom43', group: 'timothy-titus-philemon', title: '1 Timothy: The Argument', opens: 'THE ARGUMENT ON THE FIRST EPISTLE TO TIMOTHY' },
  { volume: 'calcom43', group: 'timothy-titus-philemon', title: '2 Timothy: The Argument', opens: 'THE ARGUMENT ON THE SECOND EPISTLE TO TIMOTHY' },
  { volume: 'calcom43', group: 'timothy-titus-philemon', title: 'Titus: Epistle Dedicatory, to William Farel and Peter Viret', opens: 'TO TWO EMINENT SERVANTS OF CHRIST, WILLIAM FARELL AND PETER VIRET' },
  { volume: 'calcom43', group: 'timothy-titus-philemon', title: 'Titus: The Argument', opens: 'COMMENTARIES ON THE EPISTLE TO TITUS THE ARGUMENT' },
  { volume: 'calcom44', group: 'hebrews', title: 'Epistle Dedicatory, to Sigismund Augustus, King of Poland', opens: 'EPISTLE DEDICATORY JOHN CALVIN TO THE MOST MIGHTY AND MOST SERENE PRINCE, SIGISMUND AUGUSTUS' },
  { volume: 'calcom44', group: 'hebrews', title: 'The Argument', opens: 'THE EPISTLE TO THE HEBREWS THE ARGUMENT' },
  { volume: 'calcom45', group: 'catholic-epistles', title: 'Epistle Dedicatory, to Edward VI', opens: 'DEDICATION TO HIS MOST SERENE HIGHNESS, EDWARD THE SIXTH' },
  { volume: 'calcom45', group: 'catholic-epistles', title: '1 Peter: The Argument', opens: 'THE ARGUMENT The design of Peter in this Epistle' },
  { volume: 'calcom45', group: 'catholic-epistles', title: '1 John: The Argument', opens: 'THE ARGUMENT This Epistle is altogether worthy of the spirit' },
  { volume: 'calcom45', group: 'catholic-epistles', title: 'James: The Argument', opens: 'THE ARGUMENT It appears from the writings of Jerome and Eusebius' },
  { volume: 'calcom45', group: 'catholic-epistles', title: '2 Peter: The Argument', opens: 'THE ARGUMENT The doubts respecting this Epistle mentioned by Eusebius' },
  { volume: 'calcom45', group: 'catholic-epistles', title: 'Jude: The Argument', opens: 'THE ARGUMENT Though there was a dispute among the ancients' },
];

const frontMatter = [];

const FRONT_MATTER_DEPLOY_PATH = join(HERE, '..', '..', 'public', 'library', 'reformation', 'calvin-prefaces.json');

// A division's own paragraphs: from its opening tag to the next division
// boundary of any level, so a piece never runs on into its sibling or into
// the commentary it introduces. Footnotes are already logged by
// extractVolume's pass over the same volume, so they are dropped quietly.
function divisionParagraphs(xml) {
  const out = [];
  for (const m of xml.matchAll(/<div[1-4]\b[^>]*>/gi)) {
    const rest = xml.slice(m.index + m[0].length);
    const stop = rest.search(/<div[1-4]\b|<\/div[1-4]>/i);
    const body = (stop === -1 ? rest : rest.slice(0, stop)).replace(/<note\b[^>]*>[\s\S]*?<\/note>/gi, ' ');
    const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((p) => inlineToText(p[1]))
      .filter(Boolean);
    if (paragraphs.length > 0) out.push(paragraphs);
  }
  return out;
}

function extractFrontMatter(volumeId, xml) {
  const divisions = divisionParagraphs(xml);
  return FRONT_MATTER.filter((f) => f.volume === volumeId).map((f) => {
    const hits = divisions.filter((ps) => ps.join(' ').startsWith(f.opens));
    if (hits.length !== 1) {
      throw new Error(
        `${volumeId}: "${f.title}" matched ${hits.length} divisions opening "${f.opens}" — expected exactly 1. `
        + 'CCEL may have restructured the volume; re-inspect it and update FRONT_MATTER.',
      );
    }
    return { group: f.group, title: f.title, paragraphs: hits[0] };
  });
}

// ---------- Calvin's lecture prayers ----------
//
// Each of Calvin's lectures on the Prophets (Jeremiah through Malachi)
// closes with a prayer, which CCEL gives its own <div type="prayer"> titled
// "Prayer Lecture N". The verse commentary never reaches them: they carry no
// verse milestone, so extractVolume has nothing to anchor them to. They ship
// as their own verse-keyed work instead (public/library/reformation/
// calvin-prayers.json), read in a pane that follows the Bible reference.
//
// A prayer's passage is the lecture it closes: the verse milestones between
// the previous prayer and this one. CCEL sometimes places the NEXT lecture's
// first milestone inside the prayer division itself, after the prayer text;
// counting from prayer to prayer puts that milestone with the lecture it
// opens, where it belongs. The prayer is filed under its passage's opening
// chapter, since a lecture that crosses a chapter boundary begins in the
// earlier one.

const PRAYERS_DEPLOY_PATH = join(HERE, '..', '..', 'public', 'library', 'reformation', 'calvin-prayers.json');
const prayers = [];

function extractPrayers(volumeId, xml) {
  const out = [];
  // Scripture tables go first, as in extractVolume, so only real comment
  // milestones count toward a lecture's passage.
  const clean = xml.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, ' ');
  const events = [...clean.matchAll(/<div[1-4]\b[^>]*type="prayer"[^>]*>|<scripCom\b[^>]*\/?>/gi)];
  let passage = [];
  let lastVerse = null;
  for (const ev of events) {
    const tag = ev[0];
    if (/^<scripCom/i.test(tag)) {
      const ref = /osisRef="Bible:([^".]+)\.(\d+)\.(\d+)"/i.exec(tag);
      if (ref && Number(ref[3]) > 0) {
        passage.push({ book: OSIS_TO_CANONICAL.get(ref[1]), chapter: Number(ref[2]), verse: Number(ref[3]) });
      }
      continue;
    }
    const title = /\stitle="([^"]*)"/i.exec(tag)?.[1] ?? '';
    const lecture = /^Prayer Lecture (\d+)$/i.exec(title);
    if (!lecture) throw new Error(`${volumeId}: prayer division titled "${title}" names no lecture.`);
    // A lecture CCEL left untagged (Malachi's 170th, which carries on from
    // the day before without reaching a new verse) is filed at the last verse
    // reached, and labelled as continuing from it.
    if (passage.length === 0 && !lastVerse) throw new Error(`${volumeId}: ${title} follows no verse comment.`);

    const rest = clean.slice(ev.index + tag.length);
    const stop = rest.search(/<div[1-4]\b|<\/div[1-4]>|<scripCom\b/i);
    const body = rest.slice(0, stop === -1 ? rest.length : stop).replace(/<note\b[^>]*>[\s\S]*?<\/note>/gi, ' ');
    const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((p) => inlineToText(p[1]))
      .filter((t) => t && !/^prayer[.,:]?$/i.test(t));
    if (paragraphs.length === 0) throw new Error(`${volumeId}: ${title} has no prayer text.`);

    const first = passage[0] ?? lastVerse;
    const last = passage[passage.length - 1] ?? lastVerse;
    out.push({
      book: first.book,
      chapter: first.chapter,
      label: passage.length > 0
        ? `Lecture ${lecture[1]} · ${passageLabel(first, last)}`
        : `Lecture ${lecture[1]} · continuing ${passageLabel(first, first)}`,
      text: paragraphs.join('\n\n'),
    });
    lastVerse = last;
    passage = [];
  }
  return out;
}

// "Ezekiel 8:16–9:3", "Jeremiah 5:1–9", "Hosea 14:9–Joel 1:4".
function passageLabel(a, b) {
  const start = `${a.book} ${a.chapter}:${a.verse}`;
  if (a.book !== b.book) return `${start}–${b.book} ${b.chapter}:${b.verse}`;
  if (a.chapter !== b.chapter) return `${start}–${b.chapter}:${b.verse}`;
  return a.verse === b.verse ? start : `${start}–${b.verse}`;
}

async function writePrayers() {
  const byBook = new Map();
  for (const p of prayers) {
    if (!byBook.has(p.book)) byBook.set(p.book, []);
    byBook.get(p.book).push({ chapter: p.chapter, label: p.label, text: p.text });
  }
  const books = [...byBook.entries()]
    .sort((a, b) => BOOK_ORDER.get(a[0]) - BOOK_ORDER.get(b[0]))
    .map(([name, rows]) => ({ name, prayers: rows }));
  const bundle = {
    metadata: {
      build_date: new Date().toISOString().slice(0, 10),
      work: 'John Calvin — Prayers from the Lectures on the Prophets',
      author: 'John Calvin',
      translator: 'Calvin Translation Society (Edinburgh, 1844–56)',
      source_site: 'https://www.ccel.org/ccel/calvin/commentaries.i.html',
      license: 'public domain',
      license_note:
        'John Calvin (1509–1564), the prayers closing his lectures on Jeremiah, Lamentations, '
        + 'Ezekiel, Daniel and the Minor Prophets — public domain, in the Calvin Translation '
        + 'Society’s English translation (Edinburgh, 1844–56), digitised by CCEL, whose every '
        + 'volume declares DC.Rights "Public Domain". Each prayer is filed at the passage its '
        + 'lecture expounded. Built by tools/calvin-commentaries/build.mjs.',
      book_count: books.length,
      prayer_count: prayers.length,
    },
    books,
  };
  const json = JSON.stringify(bundle);
  await writeFile(join(OUT_DIR, 'calvin-prayers.json'), json, 'utf8');
  await writeFile(PRAYERS_DEPLOY_PATH, json, 'utf8');
  console.log(`Prayers: ${prayers.length} across ${books.length} books, `
    + `${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`);
}

function licenseNote(group) {
  return `John Calvin (1509–1564), Commentary on ${group.label} — public domain. English text `
    + 'from the Calvin Translation Society edition (Edinburgh, 1844–56), translated by a team of '
    + 'period translators including John King, Charles Bingham, James Anderson and William Pringle; '
    + 'digitised by CCEL from the OnLine Bible project\'s transcription (volumes '
    + `${group.volumes.join(', ')}), each of which declares DC.Rights "Public Domain". The `
    + 'translators died more than a century ago and the edition is from the 1840s–50s. The parallel '
    + 'Authorised Version / Calvin\'s-Latin Scripture tables, the CTS editors\' footnotes, and the '
    + 'front and back matter are excluded and logged to tools/calvin-commentaries/exclusions.txt. '
    + 'Built by tools/calvin-commentaries/build.mjs, which refuses any volume that does not declare '
    + 'itself public domain and name Calvin as its author.';
}

const exclusions = [];
function logExclusion(volume, kind, text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  exclusions.push(`${volume}\t${kind}\t${flat.length} bytes\t${flat.slice(0, 140)}`);
}

// ---------- download ----------

async function loadVolume(volumeId) {
  const cached = join(RAW_DIR, `${volumeId}.xml`);
  if (!REFETCH && existsSync(cached)) return readFile(cached, 'utf8');
  console.log(`  downloading ${volumeId}.xml`);
  const res = await fetch(`https://ccel.org/ccel/calvin/${volumeId}.xml`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml' },
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${volumeId}.xml`);
  const text = await res.text();
  if (text.length < 100_000) throw new Error(`${volumeId}.xml is only ${text.length} bytes — truncated?`);
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(cached, text, 'utf8');
  return text;
}

// Refuse to build from a volume that does not declare itself public domain,
// and refuse one that is not the work we think it is. Foundation only ever
// ships public-domain or explicitly licence-checked texts, and a silent
// upstream change must stop the build rather than quietly ship a restricted
// text. Both checks run per volume: the set is 45 separately digitised files.
function assertPublicDomainCalvin(volumeId, xml) {
  const headEnd = xml.indexOf('</ThML.head>');
  if (headEnd === -1) throw new Error(`${volumeId}: no ThML head — refusing to build.`);
  const head = xml.slice(0, headEnd);

  const rights = /<DC\.Rights>([^<]*)<\/DC\.Rights>/i.exec(head);
  if (!rights) throw new Error(`${volumeId} declares no DC.Rights — refusing to build.`);
  if (!/^\s*public domain\s*$/i.test(rights[1])) {
    throw new Error(
      `${volumeId} declares DC.Rights="${rights[1].trim()}", not "Public Domain" — refusing to build.`,
    );
  }

  const bookId = /<bookID>([^<]*)<\/bookID>/i.exec(head);
  if (!bookId || bookId[1].trim() !== volumeId) {
    throw new Error(`${volumeId} declares bookID="${bookId?.[1]?.trim() ?? 'none'}" — not the volume expected.`);
  }
  // Whitespace-tolerant: the volumes disagree on how they punctuate the
  // dates ("Calvin, John (1509-1564)" in calcom01, "(1509 - 1564)" in
  // calcom03), and a guard that trips on a space is a guard that gets
  // loosened rather than heeded.
  if (!/Calvin,\s*John\s*\(\s*1509\s*-\s*1564\s*\)/i.test(head)) {
    throw new Error(`${volumeId} does not name John Calvin as its author — refusing to build.`);
  }
  return rights[1].trim();
}

// ---------- ThML → text ----------

// Footnotes are the CTS editors' apparatus, not Calvin. Stripped whole,
// attribute-agnostically (place="foot" is not always present), and logged.
function stripNotes(xml, volumeId) {
  return xml.replace(/<note\b[^>]*>[\s\S]*?<\/note>/gi, (m) => {
    logExclusion(volumeId, 'footnote', m.replace(/<[^>]*>/g, ' '));
    return ' ';
  });
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    // Last, so an escaped entity ("&amp;lt;") does not decode twice.
    .replace(/&amp;/gi, '&');
}

// Inline markup is unwrapped rather than dropped: entries.text is plain text
// everywhere in this app and no pane renders markup. <scripRef> holds
// Calvin's own Scripture citations, which are primary content — the tag goes,
// the reference text stays. Hebrew and Greek <span lang=…> likewise keep
// their text; the pane's font stack already handles them (src/fonts.ts).
function inlineToText(html) {
  return decodeEntities(
    html
      .replace(/<scripRef\b[^>]*>([\s\S]*?)<\/scripRef>/gi, '$1')
      .replace(/<scripCom\b[^>]*\/?>/gi, '')
      .replace(/<pb\b[^>]*\/?>/gi, '')
      .replace(/<index\b[^>]*\/?>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?(span|i|b|em|strong|sup|sub|u|a|font|small)\b[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function stripInlineTags(html) {
  return html.replace(/<[^>]+>/g, '');
}

// Wrap a comment's opening catchword in ** ** the way jfb/build.mjs does.
//
// Calvin opens almost every comment by quoting the words he is about to
// expound — "<b>1.</b> <i>In the beginning.</i> To expound the term…" — which
// is the same job JFB's bold lemma does ("**1. In the beginning--**"), and
// the study footer already renders ** ** as bold (renderMarkedUp in
// FooterCommentary.tsx). Marking it is what makes a cell skimmable rather
// than a wall of prose.
//
// Run on the raw markup before tags are stripped, because the <b>/<i> pair is
// the only thing identifying the lemma — by the time it is plain text there
// is nothing left to find. Applied to a comment's FIRST paragraph only:
// unlike JFB, where each paragraph opens a new catchword, Calvin quotes once
// and then argues. A comment that does not open this way is left alone rather
// than guessed at.
function markLemma(html) {
  return html.replace(
    /^(\s*)(<b\b[^>]*>[^<]*<\/b>)?(\s*)(<i\b[^>]*>[^<]*<\/i>)/i,
    (match, lead, bold, _gap, italic) => {
      const text = `${bold ? `${stripInlineTags(bold)} ` : ''}${stripInlineTags(italic)}`
        .replace(/\s+/g, ' ')
        .trim();
      // Trailing space deliberate. The corpus often parks the space that
      // separates lemma from exposition INSIDE the italic
      // ("<i>…the leper. </i>Moses now treats"), and trimming the lemma for
      // the bold run would otherwise close it straight onto the next word.
      // inlineToText collapses runs of whitespace, so this never doubles a
      // space the source already has outside the tag.
      return text ? `${lead}**${text}** ` : match;
    },
  );
}

// Remove the parallel Authorised Version / Calvin's-Latin Scripture tables.
//
// These are Scripture text rather than exposition (see the header note). In
// most volumes they sit outside any commentary, but the Harmony volumes nest
// the *next* passage's table inside the previous comment's span, so the
// removal has to be a filter rather than a matter of where the boundaries
// fall. Tables are never used for anything but these parallel columns in
// this corpus — asserted below.
function stripScriptureTables(xml, volumeId) {
  return xml.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (m) => {
    logExclusion(volumeId, 'parallel AV/Latin Scripture table', m.replace(/<[^>]*>/g, ' '));
    return ' ';
  });
}

// Pull every verse-anchored comment out of one volume.
//
// WHY A FLAT MILESTONE STREAM, NOT A DOM WALK. Each comment opens with a
// <scripCom> milestone, and in most volumes a <div class="Commentary">
// wrapper follows that holds exactly that comment. The Harmony volumes break
// that: CCEL does not close the wrapper before the next passage begins, so
// the div around Exodus 10:18's comment runs on through the Scripture table
// for 10:21-29 and into the comments after it. Element nesting therefore
// cannot be the extraction unit — the wrapper is decoration in those
// volumes, not structure. What is uniform across all 45 volumes is the
// milestone itself, so a comment is taken to run from its own milestone to
// the next one, which is the same call jfb/build.mjs makes about OSIS verse
// milestones for the same reason.
//
// A span is additionally cut at a division boundary, so the last comment of
// a chapter cannot run on into front matter, an index, or the next division.
//
// A milestone whose verse is 0 is a whole-chapter marker heading a Scripture
// table, not a comment. It yields no comment of its own, but it still ends
// the span before it.
function extractVolume(volumeId, rawXml) {
  const xml = stripScriptureTables(stripNotes(rawXml, volumeId), volumeId);
  const comments = [];

  const milestones = [...xml.matchAll(/<scripCom\b[^>]*>/gi)];
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    const tag = m[0];
    const ref = /osisRef="Bible:([^"]+)"/i.exec(tag);
    if (!ref) {
      logExclusion(volumeId, 'scripCom-without-osisRef', tag);
      continue;
    }
    const [osisBook, chapterStr, verseStr] = ref[1].split('.');
    const chapter = Number(chapterStr);
    const verse = Number(verseStr);
    if (!Number.isInteger(chapter) || !Number.isInteger(verse) || verse === 0) continue;

    const book = OSIS_TO_CANONICAL.get(osisBook);
    if (!book) {
      throw new Error(`${volumeId}: osisRef names book "${osisBook}", which is not in the expected set.`);
    }

    const from = m.index + tag.length;
    const until = milestones[i + 1]?.index ?? xml.length;
    let body = xml.slice(from, until);

    // Cut at the first division boundary in the span: a comment belongs to
    // the division it opens in, and never continues past its end.
    const boundary = body.search(/<\/?div[12]\b/i);
    if (boundary !== -1) body = body.slice(0, boundary);

    const paragraphs = [];
    const pre = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let p;
    while ((p = pre.exec(body)) !== null) {
      const text = inlineToText(paragraphs.length === 0 ? markLemma(p[1]) : p[1]);
      if (text) paragraphs.push(text);
    }
    if (paragraphs.length === 0) {
      logExclusion(volumeId, 'empty-comment', ref[1]);
      continue;
    }
    // One comment is ONE entry, with its paragraphs joined by a blank line —
    // byte-for-byte the shape jfb.json uses, because the study footer splits
    // a cell's text on /\n{2,}/ to lay it out. See the note at the head of
    // this file on why the footer, not a pane.
    comments.push({ book, chapter, verse, text: paragraphs.join('\n\n'), paragraphs: paragraphs.length });
  }
  return comments;
}

// Log the volume's top-level divisions that carry no verse-anchored comment
// at all, so the exclusion list says what was actually left behind: the
// translators' prefaces, the facsimile title pages, the dedicatory epistles,
// Calvin's own Arguments, and CCEL's indexes of Greek/Hebrew/Latin/French
// words.
//
// The test is whether the division contains a verse-level <scripCom>, not
// what its type attribute says. Extraction here is a milestone stream that
// pays no attention to division types, and those types are not consistent
// enough to stand in for the question — across the 45 volumes they include
// "chapter", "Chapter", "section", "Psalm", "psalm", "book", "Book",
// "lecture", "front", "Front", "back", "translation", "Scripture" and no
// type at all. Judging by type logged all 150 of the Psalms commentary's own
// divisions as excluded while their contents were in fact being imported,
// which is worse than not logging: an audit list that is wrong is one that
// gets trusted and then quietly stops matching the bundles.
function logDivisionsWithoutComments(volumeId, rawXml) {
  const divisions = [...rawXml.matchAll(/<div1\b[^>]*>/gi)];
  for (let i = 0; i < divisions.length; i++) {
    const span = rawXml.slice(
      divisions[i].index,
      divisions[i + 1]?.index ?? rawXml.length,
    );
    if (/<scripCom\b[^>]*osisRef="Bible:[^".]+\.\d+\.\d+"/i.test(span)) continue;
    const type = /type="([^"]*)"/i.exec(divisions[i][0])?.[1] ?? '';
    const title = /title="([^"]*)"/i.exec(divisions[i][0])?.[1] ?? '(untitled)';
    logExclusion(volumeId, `division with no verse-anchored comment (${type || 'untyped'})`, title);
  }
}

// ---------- build ----------

async function buildGroup(group) {
  const byBook = new Map();
  let commentCount = 0;
  const licences = new Set();

  for (const volumeId of group.volumes) {
    const xml = await loadVolume(volumeId);
    licences.add(assertPublicDomainCalvin(volumeId, xml));
    logDivisionsWithoutComments(volumeId, xml);
    frontMatter.push(...extractFrontMatter(volumeId, xml));
    prayers.push(...extractPrayers(volumeId, xml));
    for (const c of extractVolume(volumeId, xml)) {
      if (!byBook.has(c.book)) byBook.set(c.book, []);
      byBook.get(c.book).push(c);
      commentCount += 1;
    }
  }

  if (licences.size !== 1 || !licences.has('Public Domain')) {
    throw new Error(`${group.key}: inconsistent licence across volumes: ${[...licences].join(', ')}`);
  }

  const books = [...byBook.entries()]
    .sort((a, b) => BOOK_ORDER.get(a[0]) - BOOK_ORDER.get(b[0]))
    .map(([book, comments]) => ({
      book,
      // A group's volumes are read in printed order, but the Harmonies
      // revisit a book across several of them, so one book's comments are
      // sorted by reference before they are written. Ties keep their
      // document order, which is the order Calvin argues in.
      comments: comments
        .map((c, i) => ({ c, i }))
        .sort((a, b) => (a.c.chapter - b.c.chapter) || (a.c.verse - b.c.verse) || (a.i - b.i))
        .map(({ c }) => ({
          chapter: c.chapter,
          verse: c.verse,
          // The covered range, in the notation versesInRefRange() parses —
          // always a single verse here, since this corpus has no ranged
          // anchors. Written anyway so the bundle carries the same fields
          // jfb.json does and the footer reads both the same way.
          verses: String(c.verse),
          text: c.text,
        })),
    }));

  if (books.length === 0) throw new Error(`${group.key}: no comments extracted.`);

  const paragraphCount = books.reduce(
    (n, b) => n + b.comments.reduce((m, c) => m + c.text.split('\n\n').length, 0),
    0,
  );

  return {
    metadata: {
      build_date: new Date().toISOString().slice(0, 10),
      work: `Calvin's Commentaries — ${group.label}`,
      group_key: group.key,
      group_order: group.order,
      group_label: group.label,
      author: 'John Calvin',
      translator: 'Calvin Translation Society (Edinburgh, 1844–56)',
      source_volumes: group.volumes,
      source_site: 'https://www.ccel.org/ccel/calvin/commentaries.i.html',
      license: 'public domain',
      license_note: licenseNote(group),
      book_count: books.length,
      comment_count: commentCount,
      paragraph_count: paragraphCount,
    },
    books,
  };
}

// One book per commentary group, in the order the groups shelve; each piece
// keeps its allow-list order within its group.
async function writeFrontMatter() {
  if (frontMatter.length !== FRONT_MATTER.length) {
    throw new Error(`Front matter: extracted ${frontMatter.length} of ${FRONT_MATTER.length} pieces.`);
  }
  const books = GROUPS
    .map((g) => ({
      name: g.label,
      pieces: frontMatter.filter((f) => f.group === g.key).map(({ title, paragraphs }) => ({ title, paragraphs })),
    }))
    .filter((b) => b.pieces.length > 0);
  const paragraphCount = frontMatter.reduce((n, f) => n + f.paragraphs.length, 0);
  const bundle = {
    metadata: {
      build_date: new Date().toISOString().slice(0, 10),
      work: 'John Calvin — Arguments, Prefaces and Dedications to the Commentaries',
      author: 'John Calvin',
      translator: 'Calvin Translation Society (Edinburgh, 1844–56)',
      source_site: 'https://www.ccel.org/ccel/calvin/commentaries.i.html',
      license: 'public domain',
      license_note:
        'John Calvin (1509–1564), the Arguments, Prefaces and Epistles Dedicatory from his '
        + 'Commentaries — public domain, in the Calvin Translation Society’s English translation '
        + '(Edinburgh, 1844–56), digitised by CCEL, whose every volume declares DC.Rights "Public '
        + 'Domain". Only Calvin’s own pieces are included, each chosen by name: the translators’ '
        + 'prefaces and the dedications and addresses written by his printers, editors and earlier '
        + 'English translators are left out, as are the CTS editors’ footnotes. Built by '
        + 'tools/calvin-commentaries/build.mjs, which refuses any volume that does not declare itself '
        + 'public domain and stops if any listed piece cannot be found exactly once.',
      book_count: books.length,
      piece_count: frontMatter.length,
      paragraph_count: paragraphCount,
    },
    books,
  };
  const json = JSON.stringify(bundle);
  await writeFile(join(OUT_DIR, 'calvin-prefaces.json'), json, 'utf8');
  await mkdir(dirname(FRONT_MATTER_DEPLOY_PATH), { recursive: true });
  await writeFile(FRONT_MATTER_DEPLOY_PATH, json, 'utf8');
  console.log(`
Front matter: ${frontMatter.length} pieces in ${books.length} groups, `
    + `${paragraphCount} paragraphs, ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(DEPLOY_DIR, { recursive: true });

  const summary = [];
  for (const group of GROUPS) {
    console.log(`\n${group.order}. ${group.label}`);
    const bundle = await buildGroup(group);
    const json = JSON.stringify(bundle);
    await writeFile(join(OUT_DIR, `calvin-${group.key}.json`), json, 'utf8');
    await writeFile(join(DEPLOY_DIR, `calvin-${group.key}.json`), json, 'utf8');
    const mb = Buffer.byteLength(json) / 1_048_576;
    summary.push({ label: group.label, mb, ...bundle.metadata });
    console.log(
      `   ${bundle.metadata.book_count} book(s), ${bundle.metadata.comment_count} comments, `
      + `${bundle.metadata.paragraph_count} paragraphs, ${mb.toFixed(2)} MB`,
    );
  }

  await writeFrontMatter();
  await writePrayers();

  await writeFile(
    EXCLUSIONS_PATH,
    'Excluded from the Calvin\'s Commentaries bundles by tools/calvin-commentaries/build.mjs.\n'
    + 'Columns: volume, kind, size, opening words.\n\n'
    + `${exclusions.join('\n')}\n`,
    'utf8',
  );

  const totalMb = summary.reduce((n, s) => n + s.mb, 0);
  const totalComments = summary.reduce((n, s) => n + s.comment_count, 0);
  const totalParagraphs = summary.reduce((n, s) => n + s.paragraph_count, 0);
  console.log(
    `\n${summary.length} bundles, ${totalComments} comments, ${totalParagraphs} paragraphs, `
    + `${totalMb.toFixed(1)} MB total, ${exclusions.length} exclusions logged.`,
  );
  console.log('Largest:', [...summary].sort((a, b) => b.mb - a.mb).slice(0, 5)
    .map((s) => `${s.label} ${s.mb.toFixed(1)}MB`).join(', '));
}

main().catch((err) => { console.error(err); process.exit(1); });
