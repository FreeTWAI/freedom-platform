/** Public reading continuity only. Never a grant, referral, checkout or arbitrary redirect. */
export type SkillAcquisitionIntent = {path: string; intro: number | null};
const catalogPath = /^\/development\/skills\/([a-z0-9-]{1,64})$/;
const submissionPath = /^\/development\/submissions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export function publicSkillPath(value: unknown): string | null {
  return typeof value === 'string' && (catalogPath.exec(value)?.[0] === value || submissionPath.exec(value)?.[0] === value) ? value : null;
}
function introduction(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && /^(?:[1-9][0-9]?|100)$/.exec(text)?.[0] === text ? Number(text) : null;
}
export function skillAcquisitionFromSearch(search: string): SkillAcquisitionIntent | null {
  const params = new URLSearchParams(search);
  // Legacy Star links use return_to alone and retain the member entry.
  if (params.getAll('skill_acquisition').length !== 1 || params.get('skill_acquisition') !== '1' || params.getAll('return_to').length !== 1) return null;
  const path = publicSkillPath(params.get('return_to'));
  if (!path) return null;
  const intro = params.getAll('skill_intro').length === 1 ? introduction(params.get('skill_intro')) : null;
  return {path, intro};
}
export function skillReadingPath(intent: SkillAcquisitionIntent): string | null {
  const value = intent.path;
  if (typeof value !== 'string') return null;
  const catalog = catalogPath.exec(value);
  const submission = submissionPath.exec(value);
  const path = catalog?.[0] === value ? '/development/skills/' + catalog[1]
    : submission?.[0] === value ? '/development/submissions/' + submission[1] : null;
  if (!path) return null;
  const intro = introduction(intent.intro);
  return path + (intro === null ? '' : '?intro=' + intro) + '#skill-use-title';
}
export function skillAccountHref(path: string, intro: unknown, register: boolean): string | null {
  if (!publicSkillPath(path)) return null;
  const params = new URLSearchParams();
  if (register) params.set('join', '1');
  params.set('skill_acquisition', '1');
  params.set('return_to', path);
  const selected = introduction(intro);
  if (selected !== null) params.set('skill_intro', String(selected));
  return '/?' + params.toString();
}
/** Confirm anonymous readability again; no credentials, redirect following or stale cache. */
export async function validateSkillReturn(intent: SkillAcquisitionIntent, options: {fetcher?: typeof fetch; signal?: AbortSignal} = {}): Promise<boolean> {
  const path = publicSkillPath(intent.path);
  if (!path || options.signal?.aborted) return false;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, {once: true});
  // A failed content check must never leave an already-created account waiting forever.
  const timeout = setTimeout(cancel, 8_000);
  try {
    const response = await (options.fetcher ?? fetch)(path, {method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal});
    const readable = !controller.signal.aborted && response.ok && !response.redirected && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'text/html';
    // Only headers are needed, not a second copy of the complete reading document.
    void response.body?.cancel().catch(() => {});
    return readable;
  } catch { return false; }
  finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel); }
}
