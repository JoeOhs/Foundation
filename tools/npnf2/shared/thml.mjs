// ThML → Foundation bundle, for Nicene and Post-Nicene Fathers, Series II.
//
// This is the unified Series I importer generation carried forward, with the
// changes Series II's markup forced. Series I kept a byte-identical
// copy of this logic in each of its 14 volume folders, which is exactly how
// Vols. 1–8 drifted out of step with the later ones; Series II shares one
// module instead, and each volume keeps only its own constants and its own
// audited provenance/structure notes.
//
// Carried over unchanged from Series I: attribute-agnostic footnote
// stripping, skippable front matter and indexes, title/shorttitle folding,
// the Book-container vs. flat-run decision, and front-matter splitting.
//
// Every volume is read as its own discovery pass, and each batch has turned
// up structure the one before it had not: 1–3 added the first three rules
// below, 4–6 the next four. Whenever a rule changes, all earlier volumes are
// rebuilt and diffed — Vols. 1–3 rebuild byte-identically under the rules
// added for 4–6.
//
// Added for Vols. 1–3:
//
//   1. DEPTH RECURSION. Series I never went past div3. Vols. 1 and 3 here
//      run to div4 (a div2 container holding div3 Books holding div4
//      chapters), so the same container-vs-flat-run test is applied
//      recursively at each level instead of being hard-coded to div2/div3.
//      A container of containers emits a `group` — one extra TOC level —
//      rather than collapsing its Books into single chapters.
//
//   2. PREFIX LABEL RECOVERY. Series I could read a sequence label off a
//      `shorttitle`, or off a leading paragraph that was *only* the label
//      ("Homily II."). Vol. 2's 487 chapters and Vol. 3's 342 carry neither:
//      the number opens the first paragraph as a prefix, "Chapter II.—By
//      what Means…". That prefix is now read too. It is text from the
//      source, not a guess.
//
//   3. SIBLING LABEL-KIND INFERENCE. Some runs number their members with a
//      bare numeral — Vol. 3's 182 letters lead with "II. To the Same."
//      after a first letter whose shorttitle says "Letter I". Without the
//      kind, dozens of those letters are titled "To the Same." and are
//      indistinguishable in the TOC. The kind is taken from whichever
//      siblings in the same run do carry a shorttitle label, so it is still
//      read from the source rather than assumed.
//
// A recovered label is rejected when it merely repeats the enclosing
// division's own title: the first chapter of each Book opens with the Book's
// heading ("Book V."), which numbers the Book, not the chapter.
//
// Added for Vols. 4–6 (the first three found by Vol. 4, the last by Vol. 6;
// each is documented at the function it changed):
//
//   4. APPARATUS-ONLY INDEX SKIPPING. See isApparatusIndex().
//   5. FRONT MATTER EXCLUDED FROM THE RUN-SHAPE VOTE. See resolveRun().
//   6. "From Letter N.—" READ AS A LABEL. See labelFromPrefix().
//   7. REPEATED SIBLING TITLES QUALIFIED. See disambiguateSiblingTitles().
//
// 4 and 5 were data loss, not cosmetics: between them they were dropping all
// fifty of Athanasius's Festal and Personal Letters, and the fix is why
// Vol. 4 carries 4,309 paragraphs rather than 3,449.
//
// Added for Vols. 7–9:
//
//   8. "LECTURE" IS A SEQUENCE KIND. Cyril of Jerusalem's twenty-three
//      Catechetical Lectures (Vol. 7) number themselves "Lecture II." and
//      nothing else in the run carries the number. Without the kind in the
//      list, all twenty-three were titled by subject alone — "On Baptism.",
//      "Of Faith." — with no lecture number anywhere in the TOC.
//
//   9. A DIVISION WITH CHILDREN IS NOT A TITLE PAGE. See isSkippableDiv1()
//      and sectionNameFromTitlePage(). This was data loss on the scale of
//      rules 4 and 5: Vol. 9 files the whole Hilary of Poitiers half of the
//      volume — its Introduction, De Synodis, the twelve books of De
//      Trinitate and the Homilies on the Psalms, 1,042 paragraphs — under a
//      div1 whose title attribute reads, simply, "Title Page". The old rule
//      matched that title and dropped all of it.
//
// Added for Vols. 10–14, which complete the series:
//
//  10. "TITLE PAGES" IS A TITLE PAGE. Vols. 10 and 14 head their front
//      matter with the plural, which the singular pattern missed, so both
//      volumes opened with a section of publisher's boilerplate.
//
//  11. A CONTAINER'S OWN TEXT IS ITS OWN PARAGRAPHS. See ownParagraphs().
//
//  12. A SECTION'S OWN OPENING PARAGRAPHS ARE KEPT. See buildBundle(). This
//      was the batch's silent loss, though a small one: two paragraphs of
//      Vol. 10, the editor's note explaining that his sixteen letters of
//      Ambrose are a selection from ninety-one, were read by nothing.
//
//  13. REPEATED WORK TITLES QUALIFIED. See disambiguateWorks().
//
// Vol. 14 was expected to need a deeper TOC model — it is canons and
// conciliar decrees rather than authored prose — and on inspection does not.
// Each council is a div1, each document within it a div2, each canon a div3,
// which is the section → work → chapter shape the other thirteen use; the
// canon collections carry the text mass, so every council but the Fifth and
// Sixth reads as a container run on the existing vote. Those two enacted no
// canons, so they have no subdivided document and read as flat runs: their
// documents are chapters of one work rather than works. That is the same
// rule reaching a different answer on different data, not a failure of it.
//
// Rules 10–13 change nothing in Vols. 1–9: all nine rebuild byte-identically.

const SEQUENCE_KINDS =
  'homily|homilies|letter|lecture|instruction|book|sermon|tractate|discourse|chapter|part|section|note|dialogue|demonstration|oration';

export function stripNotes(xml) { return xml.replace(/<note\b[^>]*>[\s\S]*?<\/note>/gi, ''); }
function stripIndexes(xml) { return xml.replace(/<index\b[^>]*\/>/gi, ''); }
function stripPageBreaks(xml) { return xml.replace(/<pb\b[^>]*\/?>/gi, ''); }

function attr(tag, name) {
  const m = tag.match(new RegExp(String.raw`(?:^|\s)${name}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

function stripTags(html) {
  return html
    .replace(/<scripRef\b[^>]*>([\s\S]*?)<\/scripRef>/gi, '$1')
    .replace(/<span\b[^>]*>([\s\S]*?)<\/span>/gi, '$1')
    .replace(/<\/?(i|b|em|strong|sup|sub|u)\b[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+\/>/g, '')
    .replace(/<\/?\w[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&\w+;/g, '')
    .trim();
}

function normalizeParagraph(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\x00PP\x00')
    .replace(/\n/g, ' ').replace(/\x00PP\x00/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
}

function splitDivs(xml, level) {
  const openRe = new RegExp(String.raw`<div${level}\b([^>]*)>`, 'gi');
  const closeTag = `</div${level}>`;
  const results = [];
  let m;
  while ((m = openRe.exec(xml)) !== null) {
    const start = m.index + m[0].length;
    const end = xml.indexOf(closeTag, start);
    if (end === -1) continue;
    results.push({
      title: attr(m[1], 'title') || '',
      shorttitle: attr(m[1], 'shorttitle') || '',
      id: attr(m[1], 'id') || '',
      content: xml.slice(start, end),
    });
  }
  return results;
}

function extractParagraphs(content) {
  const paragraphs = [];
  const pRe = /<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/gi;
  let pm;
  while ((pm = pRe.exec(content)) !== null) {
    const text = normalizeParagraph(stripTags(pm[1]));
    if (text.length > 0) paragraphs.push(text);
  }
  if (paragraphs.length === 0) {
    const bare = content.replace(/<div\d\b[\s\S]*$/gi, '');
    const text = normalizeParagraph(stripTags(bare));
    if (text.length > 10) paragraphs.push(text);
  }
  return paragraphs;
}

// Paragraphs the division holds itself, i.e. everything before its first
// child division. A container's own opening paragraphs are real text —
// the Prolegomena of Vol. 1 opens with five of them — so they are kept
// rather than dropped along with the child markup.
//
// RULE 11. Only real paragraph elements count as own text. extractParagraphs
// falls back to the bare text of a division carrying no <p> at all, which is
// right for a leaf whose text was never marked up and wrong for a container:
// the only thing standing between a container's opening tag and its first
// child is the printed heading. Vols. 1-9 and 12-14 never reach the fallback
// here; Vol. 10 and Vol. 11 reach it sixty-eight times between them, and all
// sixty-eight are display headings restating the division's own title — "On
// the Mysteries.", "Three Books on the Duties of the Clergy. by St. Ambrose,
// Bishop of Milan. Book I." Left in, each became either a one-paragraph work
// sitting beside the work it names or a spurious opening chapter, which is
// why Ambrose's De Officiis Book I read as 51 chapters against the source's
// 50, and De Mysteriis as 11 against its 9.
function ownParagraphs(content) {
  const pre = content.replace(/<div\d\b[\s\S]*$/i, '');
  if (!/<(?:p|li)\b[^>]*>[\s\S]*?<\/(?:p|li)>/i.test(pre)) return [];
  return extractParagraphs(pre);
}

function cleanTitle(raw) { return stripTags(raw).replace(/\s+/g, ' ').trim(); }

// The heading a division prints above its own text, before any child
// division. Used only to name a section's opening note (rule 12).
function leadingHeading(content) {
  const m = content.replace(/<div\d\b[\s\S]*$/i, '').match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);
  return m ? cleanTitle(m[1]) : '';
}

function normalizeForMatch(t) {
  return t.toLowerCase().replace(/[‘’“”]/g, "'").replace(/[.\s]+$/, '').trim();
}

// A sequence label — "Homily II", "Book VI", "Letter I" — as opposed to a
// descriptive title.
function isSequenceLabel(t) {
  return new RegExp(String.raw`^(${SEQUENCE_KINDS})\s+[ivxlcdm\d]+\.?$`, 'i').test(t);
}

function labelKind(t) {
  const m = t.match(new RegExp(String.raw`^(${SEQUENCE_KINDS})\s`, 'i'));
  return m ? m[1] : '';
}

// "Chapter II.—By what Means…" — the label opens the paragraph and a
// dash or period separates it from the heading text.
//
// "From " is allowed in front of the kind because Vol. 4 prints the Festal
// Letters that survive only in excerpt as "From Letter XXVIII.—(For 356.)".
// Without it those seven rows are titled by their year alone, beside fifty
// siblings that all read "Letter N."
function labelFromPrefix(text) {
  const m = text.match(new RegExp(String.raw`^(?:from\s+)?(${SEQUENCE_KINDS})\s+([ivxlcdm]+|\d+)\s*[.．]?\s*[—–-]`, 'i'));
  return m ? `${m[1]} ${m[2]}` : '';
}

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function numberValue(s) {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  const digits = s.toLowerCase().split('').map((c) => ROMAN[c] ?? 0);
  for (let i = 0; i < digits.length; i++) {
    total += digits[i] < (digits[i + 1] ?? 0) ? -digits[i] : digits[i];
  }
  return total;
}

// "II.—To the Same." — a bare numeral, which only names a member once the
// run's own kind is known.
//
// A bare numeral is the weakest of the three signals, because a division's
// first paragraph can open with a numeral that counts something else: the
// first of Jerome's 135 Lives opens "II. Jerome.", numbering Jerome's part
// of the volume, not that Life. It is believed only where it behaves like a
// count of the run — larger than the last number the run yielded, and no
// larger than the number of members up to and including this one. Jerome's
// "II." in first place fails the second test; Theodoret's letters pass both
// all the way to CLXXXI.
//
// Requiring a separator matters as much as the numeral: without it "I have
// read the document…" reads as a roman numeral opening a sentence.
function labelFromBareNumber(text, kind, lastNumber, position) {
  if (!kind) return '';
  const m = text.match(/^(?:§\s*)?([IVXLCDM]+|\d+)\s*(?:[.．]|[—–-])[\s—–-]*\S/);
  if (!m) return '';
  const n = numberValue(m[1]);
  if (n <= lastNumber || n > position) return '';
  return `${kind} ${m[1]}`;
}

function labelNumber(label) {
  const m = label.match(/\s([IVXLCDM]+|\d+)\.?$/i);
  return m ? numberValue(m[1]) : 0;
}

// Folds a sequence label into a descriptive title, but only when it adds
// something: a title that is already the label, or already opens with it,
// is left alone.
function foldSequenceLabel(title, label) {
  if (!label) return title;
  if (!title) return label;
  if (isSequenceLabel(title)) return title;
  if (normalizeForMatch(title).startsWith(normalizeForMatch(label))) return title;
  return `${label}. ${title}`;
}

// Reads a division's own label out of its shorttitle, or failing that out of
// its opening paragraph. `runKind` is the kind its siblings use, and
// `containerTitle` is the enclosing division's title — a label equal to it
// numbers the container, not this division.
function divLabel(div, paragraphs, runKind, containerTitle, lastNumber, position) {
  const short = cleanTitle(div.shorttitle);
  if (isSequenceLabel(short)) return short;

  const lead = (paragraphs && paragraphs[0] ? paragraphs[0] : '').trim();
  if (!lead) return '';
  const label = isSequenceLabel(lead)
    ? lead.replace(/\.$/, '')
    : labelFromPrefix(lead) || labelFromBareNumber(lead, runKind, lastNumber, position);
  if (!label) return '';
  if (containerTitle && normalizeForMatch(label) === normalizeForMatch(containerTitle)) return '';
  return label;
}

function divTitle(div, label) {
  const title = cleanTitle(div.title);
  const short = cleanTitle(div.shorttitle);
  if (short && !title) return short;
  if (short && title === short) return title;
  // "Homily I" in shorttitle vs "Homily 1" in title — prefer the shorttitle,
  // whose numbering matches its siblings
  if (label && isSequenceLabel(title) && isSequenceLabel(short)) return short;
  return foldSequenceLabel(title || short, label);
}

// CCEL's apparatus indexes are always named for what they index — "Indexes",
// "General Index to Socrates' Ecceliastical History", "Index of Scripture
// References". Matching the bare word anywhere in a title, which is what
// this used to do, is too loose: it silently swallowed Vol. 4's div2 "The
// Festal Letters, and their Index." and with it all fifty Festal and
// Personal Letters of Athanasius. A bare "Index." is left alone for the same
// reason — in Vol. 4 that is the ancient Festal Index, 110 paragraphs of
// text, not apparatus.
function isApparatusIndex(t) {
  return /^(general )?indexes$/.test(t) || /^(general )?index(es)? (of|to)\b/.test(t);
}

// Volume front matter by the editor, translator or publisher, as opposed to
// the Prolegomena, which is scholarly introduction and is kept. Vols. 1–3
// only ever showed "Preface."; Vol. 4 titles the same document "Editorial
// Preface." and prints a second, inner title page, and Vol. 6 has
// "Translator's Preface." — all the same class of page.
//
// `hasChildren` is what stops this from being data loss. A title page, a
// preface or a series title is a leaf — one page of front matter, no
// divisions under it — and that is how it looked in every volume up to
// Vol. 8. Vol. 9 breaks it: the entire Hilary of Poitiers half of that
// volume, six div2s and 1,042 paragraphs, sits inside a div1 whose title
// attribute is the bare string "Title Page". The page itself is really
// there, as that div1's first child; the attribute simply names the
// container after its opening page. So the front-matter titles are only
// believed of a division that holds no divisions, and apparatus indexes —
// which genuinely are containers, of index sections — keep being skipped
// either way.
function isSkippableDiv1(div, hasChildren) {
  const t = normalizeForMatch(div.title);
  if (isApparatusIndex(t)) return true;
  if (hasChildren) return false;
  if (t === '' || t === 'preface' || t === 'contents') return true;
  if (t === 'table of contents' || t === 'credits') return true;
  if (/^(second |third |inner )?title pages?$/.test(t)) return true;
  if (/^(editorial|editor's|translator's|author's|publishers') preface$/.test(t)) return true;
  if (/^series title( page)?$/.test(t)) return true;
  return false;
}

// The name of a section whose own title attribute is only front matter,
// read off the section's printed title page — the child division the
// attribute was named after. Vol. 9's Hilary half opens "St. Hilary of
// Poitiers." / "Select Works.", which is exactly the "Author: Work." form
// its sibling div1 spells out in its own title attribute.
//
// Only the leading title lines are taken; the credits below them
// ("Translated", "by", "The Rev. E. W. Watson, M.A.") name people, not the
// section. The volume's own series title page is rejected outright — it
// belongs to no one section — so a volume that files everything under one
// untitled div1 still yields nothing here rather than a wrong name.
function sectionNameFromTitlePage(div2s) {
  const page = div2s.find((d) => normalizeForMatch(cleanTitle(d.title || d.shorttitle)) === 'title page');
  if (!page) return '';
  const lines = extractParagraphs(page.content)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p && !/^(translated|edited|by|and others|with)\b/i.test(p));
  const name = lines.slice(0, 2).join(' ').trim();
  if (!name || /^(a select library|nicene and post-nicene fathers)/i.test(name)) return '';
  return name;
}

function isSkippableDiv(title) {
  const t = normalizeForMatch(title);
  if (t === '' || t === 'title page' || t === 'title pages') return true;
  if (isApparatusIndex(t)) return true;
  if (/\bpages? of the print edition\b/.test(t)) return true;
  if (/^(greek|hebrew|german|latin|french) words and phrases$/.test(t)) return true;
  return false;
}

// Editorial apparatus that opens a treatise rather than forming part of its
// argument. Kept (it's real content) but as its own single-chapter work, so
// it doesn't get swept into the run of body chapters below it.
function isFrontMatterDiv(title) {
  const t = normalizeForMatch(title).replace(/^the\s+/, '');
  return /^(preface|advertisement|argument|introduction|introductory (essay|note|notice))\b/.test(t)
    || /^(translator|editor|author)'s (preface|introductory note|introductory notice|note|notice)\b/.test(t)
    || /^(introductory note|note on the following work|extract from|retractations)\b/.test(t)
    || /^(prolegomena|general prolegomena|special prolegomena)\b/.test(t)
    || /^contents\b/.test(t);
}

function countParagraphs(content) { return extractParagraphs(content).length; }

// Resolves one run of sibling divisions into works.
//
// A division carrying children is either a container (its children are the
// real units) or a single long piece that merely happens to be subdivided,
// and which of those it is cannot be read off the division alone. The signal
// that separates them is where the body text actually lives:
//
//   * Most text inside the children → a container run. Each child-bearing
//     division becomes a work (or, when its own children are containers in
//     turn, a group of works); divisions holding text directly are apparatus
//     beside them and each becomes its own single-chapter work.
//   * Most text held directly → a flat run. These divisions ARE the chapters
//     of one work named for the container — the shape of Vol. 2's Books and
//     of Series I's 150 Psalm expositions. A subdivided member of such a run
//     stays one chapter, its child headings kept inline so no text or
//     structure is lost. Leading front matter is split off so the run starts
//     at the real first chapter.
//
// `level` is the div level of the siblings in `divs`.
function resolveRun(divs, level, containerTitle) {
  const kept = [];
  for (const div of divs) {
    // skippability is judged on the source's own title, before any folding
    const rawTitle = cleanTitle(div.title || div.shorttitle);
    if (!rawTitle || isSkippableDiv(rawTitle)) continue;
    const children = splitDivs(div.content, level + 1)
      .filter((c) => { const t = cleanTitle(c.title || c.shorttitle); return t && !isSkippableDiv(t); });
    kept.push({ div, children, own: ownParagraphs(div.content) });
  }

  // The run's numbering kind, taken from whichever siblings spell it out.
  const kinds = new Map();
  for (const k of kept) {
    const short = cleanTitle(k.div.shorttitle);
    if (!isSequenceLabel(short)) continue;
    const kind = labelKind(short);
    if (kind) kinds.set(kind, (kinds.get(kind) || 0) + 1);
  }
  const runKind = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  let lastNumber = 0;
  kept.forEach((k, i) => {
    const lead = k.children.length > 0 ? k.own : extractParagraphs(k.div.content);
    k.label = divLabel(k.div, lead, runKind, containerTitle, lastNumber, i + 1);
    k.title = divTitle(k.div, k.label);
    const n = labelNumber(k.label);
    if (n > 0) lastNumber = n;
  });

  // Apparatus gets no vote. Every division here is either front matter or
  // body, and the front matter is split off into its own work by both
  // branches below, so its bulk says nothing about how the body is shaped —
  // yet in Vol. 4 it decided the answer and got it wrong. The editor's
  // introduction to the Festal Letters runs to 564 paragraphs, more than the
  // fifty letters it introduces put together, and on the raw comparison it
  // outweighed them: the run read as flat and all fifty letters, each with
  // its own title, collapsed into two chapters. Excluding front matter from
  // the count changes no run in Vols. 1–3, 5 or 6.
  const body = kept.filter((k) => !(k.children.length === 0 && isFrontMatterDiv(k.title)));
  const nestedText = body.reduce((n, k) => n + k.children.reduce((m, c) => m + countParagraphs(c.content), 0), 0);
  const directText = body.reduce((n, k) => n + (k.children.length > 0 ? k.own.length : countParagraphs(k.div.content)), 0);
  const isContainerRun = nestedText > directText;

  const works = [];
  const bodyChapters = [];
  let counted = 0;

  for (const k of kept) {
    if (!k.title) continue;

    if (k.children.length === 0) {
      const paragraphs = extractParagraphs(k.div.content);
      if (paragraphs.length === 0) continue;
      counted += paragraphs.length;
      if (isContainerRun || (isFrontMatterDiv(k.title) && bodyChapters.length === 0)) {
        works.push({ title: k.title, chapters: [{ number: 1, title: k.title, paragraphs }] });
      } else {
        bodyChapters.push({ number: bodyChapters.length + 1, title: k.title, paragraphs });
      }
      continue;
    }

    if (isContainerRun) {
      const nested = resolveRun(k.children, level + 1, k.title);
      counted += nested.counted + k.own.length;
      // Children that are containers in their own right — Vol. 1's Life of
      // Constantine, four Books of div4 chapters — make this division a TOC
      // group rather than a work. Children that merely resolved into more
      // than one work do not: a Book whose first chapter is an untitled
      // Introduction splits that off as front matter, and it belongs back
      // among the Book's chapters, not beside the Book as a sibling.
      if (nested.isContainerRun) {
        if (k.own.length > 0) {
          works.push({ title: k.title, group: k.title, chapters: [{ number: 1, title: k.title, paragraphs: k.own }] });
        }
        // Nothing in Vols. 1–3 nests containers three deep — the markup
        // stops at div4 — but if a later volume does, the outer name is
        // kept alongside the inner one rather than silently replacing it.
        for (const w of nested.works) works.push({ ...w, group: w.group ? `${k.title} — ${w.group}` : k.title });
      } else {
        const chapters = [];
        if (k.own.length > 0) chapters.push({ number: 1, title: k.title, paragraphs: k.own });
        for (const w of nested.works) {
          for (const ch of w.chapters) chapters.push({ ...ch, number: chapters.length + 1 });
        }
        works.push({ title: k.title, chapters });
      }
      continue;
    }

    // flat run: one chapter, child headings preserved as leading lines
    const merged = [...k.own];
    for (const child of k.children) {
      const childParagraphs = extractParagraphs(child.content);
      if (childParagraphs.length === 0) continue;
      const childTitle = divTitle(child, '');
      if (childTitle) merged.push(childTitle);
      merged.push(...childParagraphs);
    }
    if (merged.length === 0) continue;
    counted += merged.length;
    if (isFrontMatterDiv(k.title) && bodyChapters.length === 0) {
      works.push({ title: k.title, chapters: [{ number: 1, title: k.title, paragraphs: merged }] });
    } else {
      bodyChapters.push({ number: bodyChapters.length + 1, title: k.title, paragraphs: merged });
    }
  }

  if (bodyChapters.length > 0) works.push({ title: containerTitle, chapters: bodyChapters });
  for (const w of works) disambiguateSiblingTitles(w.chapters);
  return { works, counted, isContainerRun };
}

// Two chapters of one work that read the same in the table of contents are
// the failure this repairs. It happens for two reasons, both of them the
// source's own doing and neither of them marked up:
//
//   * A DIVIDER. Vol. 6's twenty Vulgate prefaces are one flat list, but
//     "Translations from the Septuagint and Chaldee." sits at position 15
//     and everything below it prefaces the Septuagint version, so
//     "Chronicles." appears at 5 and again at 16.
//   * A CONTINUATION. Three of Vol. 4's Festal Letters survive only as
//     excerpts headed "Another Fragment.", each belonging to the letter
//     printed above it.
//
// Both are answered the same way: a repeated title takes the nearest
// preceding sibling with a title of its own as a qualifier — its sequence
// label where it has one, so "Letter XXIX" rather than that letter's full
// forty-word heading, and its title otherwise. The first occurrence is left
// as the source wrote it, because the qualifier describes what a row falls
// under and the first one falls under nothing.
//
// The structure is not re-nested. The source gives no markup for either
// case, and inventing a level from a guess is worse than a longer title.
//
// Two fragments of the same letter still collide after that — they are
// genuinely the same thing twice, and the source distinguishes them only by
// order — so a final pass numbers whatever is left. It should stay rare; it
// is a guarantee that no two rows read alike, not the main mechanism.
function chapterQualifier(title) {
  const m = title.match(new RegExp(String.raw`^(${SEQUENCE_KINDS})\s+([ivxlcdm]+|\d+)\b`, 'i'));
  return m ? `${m[1]} ${m[2]}` : title;
}

// RULE 13. The same repair, applied to the works of one section rather than
// the chapters of one work. Vol. 14 is the first volume to need it: a
// council's documents are printed in the order the acts were read, so the
// extracts resume under the same heading after each document quoted in full,
// and Ephesus carries two works titled "Extracts from the Acts. Session I.
// (Continued)." with Chalcedon two of "…Session II. (Continued)." Works are
// bucketed by their TOC group first, because two works of the same name under
// different groups already read apart in the table of contents.
function disambiguateWorks(works) {
  const buckets = new Map();
  for (const w of works) {
    const key = w.group ?? '';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(w);
  }
  for (const bucket of buckets.values()) disambiguateSiblingTitles(bucket);
}

function disambiguateSiblingTitles(chapters) {
  const original = chapters.map((ch) => ch.title);
  const counts = new Map();
  for (const t of original) counts.set(t, (counts.get(t) || 0) + 1);

  const seen = new Map();
  chapters.forEach((ch, i) => {
    const t = original[i];
    const n = (seen.get(t) || 0) + 1;
    seen.set(t, n);
    if (counts.get(t) < 2 || n === 1) return;
    for (let j = i - 1; j >= 0; j--) {
      if (counts.get(original[j]) === 1) { ch.title = `${chapterQualifier(original[j])} — ${t}`; return; }
    }
  });

  const used = new Map();
  for (const ch of chapters) {
    const n = (used.get(ch.title) || 0) + 1;
    used.set(ch.title, n);
    if (n > 1) ch.title = `${ch.title} (${n})`;
  }
}

export function buildBundle(xml, opts) {
  let clean = stripNotes(xml);
  clean = stripIndexes(clean);
  clean = stripPageBreaks(clean);

  const div1s = splitDivs(clean, 1);
  const authors = [];
  let totalParagraphs = 0;

  for (const div1 of div1s) {
    const div2s = splitDivs(div1.content, 2);
    if (isSkippableDiv1(div1, div2s.length > 0)) continue;
    const rawName = cleanTitle(div1.title || div1.shorttitle);
    const sectionName = isSkippableDiv1(div1, false)
      ? sectionNameFromTitlePage(div2s) : rawName;
    if (!sectionName) continue;

    let works = [];

    if (div2s.length > 0) {
      const resolved = resolveRun(div2s, 2, sectionName);
      works = resolved.works;
      totalParagraphs += resolved.counted;
      // RULE 12. A section's own opening paragraphs, i.e. what the div1 holds
      // before its first div2. resolveRun is handed the children and never
      // sees them, so until Vol. 10 they were dropped unread — which was
      // silent, because no volume before it had any. Vol. 10 has two: the
      // editor's "Note on the Letters of St. Ambrose.", explaining that these
      // sixteen are a selection out of the ninety-one epistles the Benedictine
      // editors count genuine. It goes in ahead of the works it introduces, as
      // its own work, the same shape resolveRun gives front matter one level
      // down. (Vol. 2 also has one such paragraph, inside its "General
      // Indexes" div1, which is skipped as apparatus before reaching here.)
      const opening = ownParagraphs(div1.content);
      if (opening.length > 0) {
        // The note prints its own heading, and that heading names the row
        // better than the section's title does — Vol. 10's reads "Note on
        // the Letters of St. Ambrose." beside a section called "Selections
        // from the Letters of St. Ambrose." It is read off the heading
        // element, so it is the source's own words; where there is no
        // heading the section's name stands in.
        const title = leadingHeading(div1.content) || sectionName;
        works.unshift({ title, chapters: [{ number: 1, title, paragraphs: opening }] });
        totalParagraphs += opening.length;
      }
    } else {
      const paragraphs = extractParagraphs(div1.content);
      if (paragraphs.length > 0) {
        works = [{ title: sectionName, chapters: [{ number: 1, title: sectionName, paragraphs }] }];
        totalParagraphs += paragraphs.length;
      }
    }

    if (works.length === 0) continue;
    disambiguateWorks(works);
    authors.push({ name: sectionName, works });
  }

  return {
    metadata: {
      title: opts.volumeTitle,
      series: 'Nicene and Post-Nicene Fathers, Series II',
      volume: opts.volumeNumber,
      editor: 'Philip Schaff and Henry Wace',
      source_url: `https://ccel.org/ccel/schaff/${opts.volumeId}`,
      source_format: 'ThML XML',
      license_note: opts.licenseNote,
      footnotes: 'excluded',
      build_date: new Date().toISOString().slice(0, 10),
      total_paragraphs: totalParagraphs,
    },
    authors,
  };
}

export function validate(bundle, minParagraphs) {
  const { authors, metadata } = bundle;
  if (authors.length < 1) throw new Error(`Expected at least 1 author group; got ${authors.length}.`);
  if (metadata.total_paragraphs < minParagraphs) {
    throw new Error(`Expected at least ${minParagraphs} paragraphs; got ${metadata.total_paragraphs}.`);
  }

  let tagLeaks = 0;
  let noteLeaks = 0;
  for (const a of authors) {
    for (const w of a.works) {
      for (const ch of w.chapters) {
        for (const p of ch.paragraphs) {
          if (/<[a-z]\w*[\s>]/i.test(p)) tagLeaks++;
          if (/<\/?note\b/i.test(p)) noteLeaks++;
        }
      }
    }
  }
  if (noteLeaks > 0) throw new Error(`Found ${noteLeaks} paragraphs with leaked footnote markup.`);
  if (tagLeaks > 10) throw new Error(`Found ${tagLeaks} paragraphs with leaked HTML/XML tags.`);

  // A TOC row the reader can't tell from its neighbour is the failure mode
  // the label recovery exists to prevent, so collisions are reported rather
  // than left to be found by eye.
  let collisions = 0;
  for (const a of authors) {
    const workTitles = new Map();
    for (const w of a.works) {
      const wk = `${w.group ?? ''} ${w.title}`;
      workTitles.set(wk, (workTitles.get(wk) || 0) + 1);
      const chapterTitles = new Map();
      for (const ch of w.chapters) chapterTitles.set(ch.title, (chapterTitles.get(ch.title) || 0) + 1);
      for (const [t, n] of chapterTitles) {
        if (n > 1) { collisions++; console.log(`  ⚠ ${a.name} / ${w.title}: ${n}× chapter "${t}"`); }
      }
    }
    for (const [t, n] of workTitles) {
      if (n > 1) { collisions++; console.log(`  ⚠ ${a.name}: ${n}× work "${t.replace(' ', ' / ')}"`); }
    }
  }

  let totalWorks = 0; let totalChapters = 0;
  const groups = new Set();
  for (const a of authors) {
    totalWorks += a.works.length;
    for (const w of a.works) { totalChapters += w.chapters.length; if (w.group) groups.add(`${a.name}/${w.group}`); }
  }
  console.log(`  ${authors.length} author/section groups`);
  console.log(`  ${groups.size} work groups`);
  console.log(`  ${totalWorks} works`);
  console.log(`  ${totalChapters} chapters/sections`);
  console.log(`  ${metadata.total_paragraphs} paragraphs`);
  if (collisions > 0) console.log(`  ⚠ ${collisions} duplicate titles`);
  if (tagLeaks > 0) console.log(`  ⚠ ${tagLeaks} paragraphs with minor tag leaks`);
}
