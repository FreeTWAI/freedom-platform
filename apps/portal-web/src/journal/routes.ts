import type {JournalCommunity} from '../../../../modules/community-journal/community.js';
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validSlug = (value:string) => value.length <= 64 && slug.test(value);
export const communityUrl = (community:JournalCommunity='freedom') => community==='claude'?'/journal/claude':community==='codex'?'/journal/codex':'/journal';
export const journalUrl = (date:string, chapter = '',community:JournalCommunity='freedom') => `${communityUrl(community)}/entries/${encodeURIComponent(date)}${chapter ? '#' + encodeURIComponent(chapter) : ''}`;
export const personUrl = (id:string,community:JournalCommunity='freedom') => `${communityUrl(community)}/people/${encodeURIComponent(id)}`;

export function parseRoute(pathname:string):{page:string;date?:string;person?:string;community?:JournalCommunity} {
  const scoped=pathname.match(/^\/journal\/(claude|codex)(?=\/|$)/);
  if(scoped){const rest=pathname.slice(scoped[0].length);if(/^\/(claude|codex)(?:\/|$)/.test(rest))return {page:'not-found'};const route=parseRoute('/journal'+rest);return {...route,community:scoped[1] as JournalCommunity};}
  if (pathname === '/journal') return {page: 'home'};
  if (pathname === '/journal/people') return {page: 'people'};
  const person = pathname.match(/^\/journal\/people\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  if (person && validSlug(person[1])) return {page: 'people', person: person[1]};
  const journal = pathname.match(/^\/journal\/entries\/(\d{4}-\d{2}-\d{2})$/);
  if (journal && Number(journal[1].slice(0,4)) > 0) {
    const date = new Date(journal[1] + 'T00:00:00Z');
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === journal[1]) return {page: 'journal', date: journal[1]};
  }
  return {page: 'not-found'};
}

// Preserve bookmarked prototype links without adding an extra Back entry.
export function canonicalPath(url:string) {
  let target = new URL(url);
  if (target.hash.startsWith('#/') && !target.hash.startsWith('#//')) {
    const legacy = new URL(target.hash.slice(1), target.origin);
    const legacyPath = legacy.pathname.replace(/\/+$/, '') || '/';
    if (legacy.origin === target.origin && parseRoute(legacyPath).page !== 'not-found') target = legacy;
  }
  const path = target.pathname.replace(/\/+$/, '') || '/';
  if (parseRoute(path).page !== 'not-found') {
    target.pathname = path;
    const person = target.searchParams.get('person');
    if (path === communityUrl(parseRoute(path).community)+'/people' && person && validSlug(person)) {
      target.pathname = personUrl(person,parseRoute(path).community);
      target.searchParams.delete('person');
    }
    const chapter = target.searchParams.get('chapter');
    if (parseRoute(path).page === 'journal' && chapter && slug.test(chapter)) {
      target.hash = chapter;
      target.searchParams.delete('chapter');
    }
  }
  return target.pathname + target.search + target.hash;
}
