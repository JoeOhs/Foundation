// Language codes for sources. `sources.language` stores an ISO 639-1 code
// so the Library can group Bibles by language reliably — a display name
// can't be compared across the two places sources are created (the seeder
// wrote 'en' while the Library manifest wrote 'English', which is exactly
// the drift this file exists to prevent).
//
// Only the languages actually shipped or plausibly next are listed; an
// unknown code falls back to showing the code itself rather than guessing.

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ar: 'Arabic',
  ru: 'Russian',
  zh: 'Chinese',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
  pt: 'Portuguese',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  ro: 'Romanian',
  el: 'Greek',
  he: 'Hebrew',
  la: 'Latin',
  ko: 'Korean',
  ja: 'Japanese',
  hi: 'Hindi',
  sw: 'Swahili',
  tl: 'Tagalog',
  vi: 'Vietnamese',
  id: 'Indonesian',
  fi: 'Finnish',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  cs: 'Czech',
  hu: 'Hungarian',
  tr: 'Turkish',
  uk: 'Ukrainian',
};

// Display name for an ISO code. Unknown codes render as the code itself,
// so a source is never mislabelled just because this table is incomplete.
export function languageName(code: string | null | undefined): string {
  if (!code) return 'Unknown language';
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code;
}

// Normalises whatever a source was created with into an ISO code. Accepts a
// code already ('en'), an English display name ('English'), or a locale-ish
// string ('en-GB'). Used by the one-time migration that repairs rows written
// before `language` was standardised, and by the Library manifest loader.
export function toLanguageCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const base = raw.split(/[-_]/)[0].toLowerCase();
  if (LANGUAGE_NAMES[base]) return base;
  const byName = Object.entries(LANGUAGE_NAMES)
    .find(([, name]) => name.toLowerCase() === raw.toLowerCase());
  return byName ? byName[0] : base;
}
