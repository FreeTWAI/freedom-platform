import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { Actor } from '../identity-membership/service.js';
import { readWithMemberSession } from '../../packages/db/member-session.js';
import { Problem, requireCondition } from '../../packages/shared/problem.js';
import { guildSearchPageSchema, type GuildSearchPage } from '../../packages/shared/community-search.js';

const keyPattern = /^(guild_[a-z0-9_]+|guild_custom_[0-9A-Fa-f]{32})$/;
const invalidQuery = () => new Problem(422, 'invalid_guild_search', '請提供 1–80 字的公會關鍵字與有效分頁條件。');
const invalidCursor = () => new Problem(422, 'invalid_cursor', '公會搜尋分頁已失效，請從第一頁重新搜尋。');

export function parseGuildSearchQuery(params: URLSearchParams) {
  for (const key of params.keys()) {
    if (!['view', 'q', 'limit', 'cursor'].includes(key) || params.getAll(key).length !== 1) throw invalidQuery();
  }
  const raw = params.get('q') ?? '';
  if (params.get('view') !== 'search' || !raw.trim() || raw.length > 80 || /[\u0000-\u001f\u007f]/.test(raw)) throw invalidQuery();
  const limit = params.get('limit') ?? '20';
  if (!/^(?:[1-9]|1[0-9]|20)$/.test(limit)) throw invalidQuery();
  const cursor = params.get('cursor');
  if (cursor !== null && (!cursor || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))) throw invalidCursor();
  return { q: raw.trim(), limit: Number(limit), cursor };
}

function continuationBinding(actor: Actor, query: string) {
  // Correlation only, not a bearer credential or a signed authorization token.
  // No cookie, raw session hash, identity or query text is placed in the cursor.
  return createHash('sha256').update(JSON.stringify([
    'freedom.member-guild-search/v1', actor.community_id, actor.user_id, actor.session_hash, query,
  ])).digest('hex');
}

function decodeCursor(raw: string | null, binding: string): string | null {
  if (raw === null) return null;
  try {
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw invalidCursor();
    const text = bytes.toString('utf8');
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidCursor();
    const cursor = value as Record<string, unknown>;
    if (Object.keys(cursor).join(',') !== 'v,b,k' || JSON.stringify(cursor) !== text
      || cursor.v !== 1 || cursor.b !== binding || typeof cursor.k !== 'string'
      || cursor.k.length > 120 || !keyPattern.test(cursor.k)) throw invalidCursor();
    return cursor.k;
  } catch { throw invalidCursor(); }
}

/** Existing member catalog metadata only; no rich-directory/provider scan. */
export async function searchGuildDirectory(pool: Pool, inputActor: Actor, params: URLSearchParams): Promise<GuildSearchPage> {
  const actor = Object.freeze({ ...inputActor });
  const query = parseGuildSearchQuery(params);
  return readWithMemberSession(pool, actor, async q => {
    // The legacy directory is onboarding-allowed. This opt-in search is not.
    // The helper already holds the current user row; do not change its policy.
    const eligible = await q.query(`SELECT user_id FROM users WHERE user_id=$1
      AND (NOT onboarding_required OR onboarding_completed_at IS NOT NULL)`, [actor.user_id]);
    requireCondition(eligible.rowCount === 1, 403, 'onboarding_required', '請先完成加入。');
    const binding = continuationBinding(actor, query.q);
    const after = decodeCursor(query.cursor, binding);
    await q.query("SET LOCAL statement_timeout = '5s'");
    const pattern = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = (await q.query<{guild_key: string; name: string; purpose: string}>(`
      SELECT guild_key, name, left(purpose,500) AS purpose
      FROM positioning_guild_catalog
      WHERE (name ILIKE $1 OR purpose ILIKE $1)
        AND ($2::text IS NULL OR guild_key > $2)
      ORDER BY guild_key LIMIT $3`, [pattern, after, query.limit + 1])).rows;
    const items = rows.slice(0, query.limit).map(row => ({
      kind: 'guild' as const, guild_key: row.guild_key, name: row.name,
      purpose: row.purpose, path: `#guilds/${row.guild_key}`,
    }));
    const last = items.at(-1);
    // readWithMemberSession checks the database decision clock after this final
    // projection, including empty pages and waits on the catalog relation.
    return guildSearchPageSchema.parse({
      items,
      next_cursor: rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({v: 1, b: binding, k: last.guild_key})).toString('base64url') : null,
    });
  });
}
