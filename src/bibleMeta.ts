// Canonical 66-book Protestant ordering. Seeded translations and verse-keyed
// imports are normalized to these names so navigation and note anchors line
// up across sources.
export const CANONICAL_BOOKS: string[] = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations',
  'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
  'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy',
  '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
  'Jude', 'Revelation',
];

const ALIASES: Record<string, string> = {
  'song of songs': 'Song of Solomon', 'canticles': 'Song of Solomon',
  'psalm': 'Psalms', 'revelations': 'Revelation',
  'revelation of john': 'Revelation', 'revelation of st. john': 'Revelation',
  'acts of the apostles': 'Acts',
};

// Normalize a book name from an imported file to the canonical name if it
// matches (case-insensitive, common aliases, roman/arabic ordinals).
export function canonicalBookName(raw: string): string | null {
  let s = raw.trim().toLowerCase()
    .replace(/^(i{1,3})\s+/, (_, r: string) => `${r.length} `)
    .replace(/^(1st|2nd|3rd)\s+/, (m) => `${m[0]} `)
    .replace(/\s+/g, ' ');
  if (ALIASES[s]) return ALIASES[s];
  const exact = CANONICAL_BOOKS.find((b) => b.toLowerCase() === s);
  if (exact) return exact;
  // unique prefix match ("gen" -> Genesis, "1 cor" -> 1 Corinthians)
  const prefix = CANONICAL_BOOKS.filter((b) => b.toLowerCase().startsWith(s));
  return prefix.length === 1 ? prefix[0] : null;
}

// e-Sword-style numeric book codes (1 = Genesis ... 66 = Revelation)
export function bookNameFromNumber(n: number): string | null {
  return n >= 1 && n <= 66 ? CANONICAL_BOOKS[n - 1] : null;
}
