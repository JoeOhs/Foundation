// Shared, persistent, bounded search history — fed by both the search
// modal and the docked concordance pane. Most recent first, deduped,
// capped so it never grows without limit.
const KEY = 'foundation.searchHistory';
const MAX = 20;

export function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushSearchHistory(term: string): string[] {
  const t = term.trim();
  if (!t) return loadSearchHistory();
  const next = [t, ...loadSearchHistory().filter((h) => h.toLowerCase() !== t.toLowerCase())].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearSearchHistory(): string[] {
  localStorage.removeItem(KEY);
  return [];
}
