import { communityCatalog } from '../community/catalog.js';
import { bookRepositoryUrls } from '../community/book-urls.js';

/** owner/name from a GitHub repository URL, lowercased. Trailing slash and .git are ignored. */
export function githubRepositoryPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') return null;
    let pathname = parsed.pathname.replace(/\/+$/, '');
    if (pathname.toLowerCase().endsWith('.git')) pathname = pathname.slice(0, -4);
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    return `${parts[0]}/${parts[1]}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Catalog book whose original or copy repository path equals this full name. Originals match first. */
export function skillBookIdForFullName(fullName: string): string | null {
  const target = fullName.toLowerCase();
  const entries = communityCatalog.skill_books.map(book => ({ id: book.id, urls: bookRepositoryUrls(book) }));
  for (const entry of entries) {
    const originalPath = entry.urls[0] ? githubRepositoryPath(entry.urls[0]) : null;
    if (originalPath && originalPath === target) return entry.id;
  }
  for (const entry of entries) {
    for (const url of entry.urls.slice(1)) {
      const path = githubRepositoryPath(url);
      if (path && path === target) return entry.id;
    }
  }
  return null;
}

export function skillBookTitle(id: string | null | undefined): string | null {
  if (!id) return null;
  return communityCatalog.skill_books.find(book => book.id === id)?.title ?? null;
}

export function isCatalogSkillBook(id: string): boolean {
  return communityCatalog.skill_books.some(book => book.id === id);
}

export function skillBookChoices(): Array<{ skill_book_id: string; title: string }> {
  return communityCatalog.skill_books.map(book => ({ skill_book_id: book.id, title: book.title }));
}
