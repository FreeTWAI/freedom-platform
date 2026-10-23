/** Read-only homepage coordination. No cache, polling, write retry or credentials. */
export type HomeRefreshReason = 'initial' | 'manual' | 'automatic';
export type HomeTaskAction = 'resume' | 'tasks' | 'showcase';

/** Only the platform-owned journal route can be configured. Empty disables the entry. */
export function resolveHomeJournalUrl(value:unknown='/journal'):string|null{return value==='/journal'?'/journal':null;}

export interface HomeReadTicket {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  complete(succeeded: boolean): void;
}

/**
 * One member-card request at a time. Freshness starts at successful completion,
 * not dispatch. A failed return refresh is throttled separately from fresh data.
 * cancel() is reusable so React's setup/cleanup/setup cycle can start again.
 */
export function createHomeReadCycle(
  generation: () => number,
  now: () => number = () => performance.now(),
) {
  const ownerGeneration = generation();
  let current: {controller: AbortController; pending: boolean} | null = null;
  let lastAttempt: number | null = null;
  let lastSuccess: number | null = null;

  return {
    begin(reason: HomeRefreshReason): HomeReadTicket | null {
      if (generation() !== ownerGeneration || current?.pending) return null;
      const time = now();
      if (reason === 'automatic') {
        if (lastSuccess !== null && time - lastSuccess < 60_000) return null;
        if (lastAttempt !== null && time - lastAttempt < 15_000) return null;
      }
      // Cancel any optional reads still belonging to the previous card read.
      const previous = current;
      const run = {controller: new AbortController(), pending: true};
      current = run;
      previous?.controller.abort();
      lastAttempt = time;
      const isCurrent = () => current === run && !run.controller.signal.aborted
        && generation() === ownerGeneration;
      return {
        signal: run.controller.signal,
        isCurrent,
        complete(succeeded) {
          if (!isCurrent() || !run.pending) return;
          run.pending = false;
          if (succeeded) lastSuccess = now();
        },
      };
    },
    cancel() {
      const previous = current;
      current = null;
      lastAttempt = null;
      lastSuccess = null;
      previous?.controller.abort();
    },
  };
}

/** Foreground events are hints; the read cycle enforces freshness/single flight. */
export function observeHomeReturns(
  sources: {page: EventTarget; window: EventTarget; visible: () => boolean; online: () => boolean},
  refresh: () => void,
): () => void {
  const onReturn = () => {
    if (sources.visible() && sources.online()) refresh();
  };
  sources.page.addEventListener('visibilitychange', onReturn);
  for (const event of ['focus', 'online', 'pageshow']) sources.window.addEventListener(event, onReturn);
  return () => {
    sources.page.removeEventListener('visibilitychange', onReturn);
    for (const event of ['focus', 'online', 'pageshow']) sources.window.removeEventListener(event, onReturn);
  };
}

export interface HomeReadClient {
  readonly sessionGeneration: number;
  get<T>(path: string, options: {signal: AbortSignal}): Promise<T>;
}

type BookReference = {book_id?: string; id?: string};
type Outcome = {ok: true; value: unknown} | {ok: false};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function list(value: unknown, key: string): unknown[] | null {
  const items = object(value)?.[key];
  return Array.isArray(items) ? items : null;
}
function bookId(value: unknown): string | null {
  const row = object(value);
  const id = row?.book_id ?? row?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * All four reads start together, but unrelated sections do not wait for each
 * other. The task board may only be used after the dashboard has ruled out an
 * unfinished claim (or failed); a positive claim never waits for the board.
 * The promise is a cleanup/testing join, not a UI publication barrier.
 */
export async function loadHomeNextSteps<Book extends BookReference>(options: {
  client: HomeReadClient;
  guildKey: string;
  signal: AbortSignal;
  /** Keep the last same-guild projection when an automatic read is unknown. */
  preserveOnFailure?: boolean;
  onBook: (book: Book | null) => void;
  onTask: (action: HomeTaskAction | null) => void;
}): Promise<void> {
  const {client, guildKey, signal, preserveOnFailure = false, onBook, onTask} = options;
  if (signal.aborted) return;
  const generation = client.sessionGeneration;
  const current = () => !signal.aborted && generation === client.sessionGeneration;
  const read = async (path: string): Promise<Outcome> => {
    try { return {ok: true, value: await client.get<unknown>(path, {signal})}; }
    catch { return {ok: false}; }
  };
  const directory = read('/guilds/directory');
  const grants = read('/me/skill-books');
  const board = read('/task-board/preview');
  const dashboard = read('/dashboard');

  // Only book metadata and the member's actual grants are prerequisites here.
  const booksDone = Promise.all([directory, grants]).then(([catalog, permissions]) => {
    if (!current()) return;
    const guilds = catalog.ok ? list(catalog.value, 'items') : null;
    const owned = permissions.ok ? list(permissions.value, 'items') : null;
    const guild = guilds?.map(object).find(item => item?.guild_key === guildKey);
    const books = list(guild, 'skill_books');
    if (!books || !owned) { if (!preserveOnFailure) onBook(null); return; }
    const unlocked = new Set(owned.map(bookId).filter((id): id is string => id !== null));
    const book = books.find(item => {
      const id = bookId(item);
      return id !== null && unlocked.has(id);
    });
    onBook((book as Book | undefined) ?? null);
  });

  let boardResult: Outcome | undefined;
  let dashboardResult: Outcome | undefined;
  let taskPublished = false;
  const publishTask = () => {
    if (!current() || taskPublished || dashboardResult === undefined) return;
    const work = dashboardResult.ok ? list(dashboardResult.value, 'now') : null;
    if (!work && preserveOnFailure) return;
    if (work && work.length > 0) {
      taskPublished = true;
      onTask('resume');
      return;
    }
    if (boardResult === undefined) return;
    const tasks = boardResult.ok ? list(boardResult.value, 'items') : null;
    if (!tasks && preserveOnFailure) return;
    taskPublished = true;
    onTask(tasks ? (tasks.length > 0 ? 'tasks' : 'showcase') : null);
  };
  const boardDone = board.then(result => { boardResult = result; publishTask(); });
  const workDone = dashboard.then(result => { dashboardResult = result; publishTask(); });
  await Promise.all([booksDone, boardDone, workDone]);
}
