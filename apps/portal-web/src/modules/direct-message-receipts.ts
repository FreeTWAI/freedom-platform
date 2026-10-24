import { DIRECT_MESSAGE_RECEIPT_BATCH_MAX, type ConversationActivity, type DirectMessageReceiptPage, type Message, type MessagePage } from '../../../../modules/member-communications/types.js';

/** Compare server UTC ISO times without losing microseconds; older pages may still use milliseconds. */
export function compareDirectMessages(a: Pick<Message, 'created_at' | 'message_id'>, b: Pick<Message, 'created_at' | 'message_id'>): number {
  const left = a.created_at, right = b.created_at;
  // Ignore the final Z and zero-pad fractional digits in place, without allocating sort keys.
  for (let index = 0, length = Math.max(left.length, right.length) - 1; index < length; index++) {
    const difference = (index < left.length - 1 ? left.charCodeAt(index) : 48) - (index < right.length - 1 ? right.charCodeAt(index) : 48);
    if (difference) return difference;
  }
  return a.message_id.localeCompare(b.message_id);
}

/** The newest outgoing message is not a receipt revision. A delayed read can
 * affect only an older row, so reconcile visible pending receipts periodically. */
export function directMessageReceiptRefreshDue(items: Message[], sender: string, checkedAt: number, now: number): boolean {
  return now - checkedAt >= 8000 && items.some(item => item.sender_ref === sender && item.read_at === null && !item.retracted_at);
}

export function hasDirectMessageChanges(
  activity: Omit<ConversationActivity, 'last_outgoing'> & Partial<Pick<ConversationActivity, 'last_outgoing'>>,
  shown: Pick<MessagePage, 'items' | 'unread_count' | 'can_send' | 'retraction_count'>,
  receiptDirty = false,
): boolean {
  const sent = activity.last_outgoing;
  const outgoing = sent && shown.items.find(item => item.message_id === sent.message_id);
  return receiptDirty || Boolean(sent && outgoing && sent.read_at !== outgoing.read_at)
    || (activity.retraction_count??'0')!==(shown.retraction_count??'0')
    || activity.last_message_id !== (shown.items[0]?.message_id ?? null)
    || activity.unread_count !== shown.unread_count || activity.can_send !== shown.can_send;
}

/** Re-read actual per-message receipts, not an inferred timestamp/read-through
 * cursor: a transaction may commit a message after another message was read. */
export async function readLoadedDirectMessageReceipts(
  latest: MessagePage,
  loaded: Message[],
  sender: string,
  readPage: (offset: number) => Promise<MessagePage>,
  isCurrent: () => boolean,
  readReceipts?: (ids: string[]) => Promise<DirectMessageReceiptPage>,
): Promise<Map<string, string | null> | null> {
  const remaining = new Set(loaded.filter(item => item.sender_ref === sender && item.read_at === null && !item.retracted_at).map(item => item.message_id));
  const receipts = new Map<string, string | null>();
  const observe = (page: MessagePage) => {
    for (const item of page.items) if (remaining.delete(item.message_id)) receipts.set(item.message_id, item.read_at);
  };
  observe(latest);
  if (readReceipts) {
    const pending = [...remaining];
    for (let offset = 0; offset < pending.length; offset += DIRECT_MESSAGE_RECEIPT_BATCH_MAX) {
      if (!isCurrent()) return null;
      const ids = pending.slice(offset, offset + DIRECT_MESSAGE_RECEIPT_BATCH_MAX), expected = new Set(ids);
      const result = await readReceipts(ids);
      if (!isCurrent()) return null;
      const invalid = () => new Error('較早訊息的已讀狀態尚未確認，請重讀對話。');
      if (!result || !Array.isArray(result.items) || result.items.length !== ids.length) throw invalid();
      for (const item of result.items) {
        if (!item || !expected.delete(item.message_id)
          || !(item.read_at === null || typeof item.read_at === 'string' && Number.isFinite(Date.parse(item.read_at)) && new Date(item.read_at).toISOString() === item.read_at)) throw invalid();
        receipts.set(item.message_id, item.read_at);
      }
    }
    // The caller applies this map only once every batch succeeds. Failures never
    // downgrade to history reads or turn missing receipts into an inferred null.
    return receipts;
  }
  // Older servers do not advertise the additive lookup; retain their pagination.
  let offset = latest.next_offset;
  const visited = new Set<number>();
  while (remaining.size && offset !== null) {
    if (!isCurrent()) return null;
    // The existing API accepts offsets only through 10000. Fail visibly rather
    // than loop or invent read receipts when a history cannot be refreshed.
    if (visited.has(offset) || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('較早訊息的已讀狀態尚未確認，請重讀對話。');
    visited.add(offset);
    const page = await readPage(offset);
    if (!isCurrent()) return null;
    observe(page);
    offset = page.next_offset;
  }
  return receipts;
}

export function mergeDirectMessagePage(latest: Message[], loaded: Message[], receipts: ReadonlyMap<string, string | null> = new Map()): Message[] {
  const rows = new Map(loaded.map(item => [item.message_id, receipts.has(item.message_id) ? { ...item, read_at: receipts.get(item.message_id)! } : item]));
  for (const item of latest) rows.set(item.message_id, item);
  return [...rows.values()].sort((a, b) => compareDirectMessages(b, a));
}
