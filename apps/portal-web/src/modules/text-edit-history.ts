/** One composer's in-memory text history. Never persist draft snapshots or publication state. */
export type TextEditHistory = {
  value: string;
  past: readonly string[];
  future: readonly string[];
  typedAt: number | null;
};
export const TEXT_HISTORY_LIMIT = 60;
export const newTextHistory = (value = ''): TextEditHistory => ({value, past: [], future: [], typedAt: null});

export function recordText(history: TextEditHistory, value: string, kind: 'typing' | 'replace' = 'typing', now = Date.now()): TextEditHistory {
  if (value === history.value) return history;
  const grouped = kind === 'typing' && history.typedAt !== null && now >= history.typedAt && now - history.typedAt < 750 && !history.future.length;
  return {value, past: grouped ? history.past : [...history.past, history.value].slice(-TEXT_HISTORY_LIMIT), future: [], typedAt: kind === 'typing' ? now : null};
}
export const breakTextGroup = (history: TextEditHistory): TextEditHistory => history.typedAt === null ? history : {...history, typedAt: null};
export function undoText(history: TextEditHistory): TextEditHistory {
  if (!history.past.length) return history;
  return {value: history.past.at(-1)!, past: history.past.slice(0, -1), future: [...history.future, history.value], typedAt: null};
}
export function redoText(history: TextEditHistory): TextEditHistory {
  if (!history.future.length) return history;
  return {value: history.future.at(-1)!, past: [...history.past, history.value], future: history.future.slice(0, -1), typedAt: null};
}
