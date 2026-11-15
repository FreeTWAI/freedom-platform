import type { PoolClient } from 'pg';
import { endorseShare } from './credit.js';
import { shareAdapter } from './adapters/registry.js';
import type { ShareRow } from './types.js';
import { requireCondition } from '../../packages/shared/problem.js';

export type OriginalShareKind = 'post' | 'service' | 'work';

export type PublishOriginalShareInput = {
  kind: OriginalShareKind;
  refTable: string;
  refId: string;
  title: string;
  communityId: string;
  authorId: string;
  guildKey?: string | null;
};

/** Internal domain port: called in the original's publication transaction, never from client facts. */
export async function publishOriginalShare(q: PoolClient, input: PublishOriginalShareInput): Promise<string> {
  const prepared = await shareAdapter({ kind: input.kind }).prepare({ ref_id: input.refId }, {});
  requireCondition(prepared.ref_table === input.refTable, 500, 'invalid_share_target', '分享類型設定錯誤。');

  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `share/${input.communityId}/${prepared.kind}/${prepared.canonical_key}`
  ]);

  const share = (
    await q.query<ShareRow>(
      `INSERT INTO shares(community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id,guild_key)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(community_id,kind,canonical_key) DO UPDATE SET title=EXCLUDED.title
       RETURNING *`,
      [
        input.communityId,
        prepared.kind,
        prepared.canonical_key,
        prepared.canonical_url,
        input.refTable,
        prepared.ref_id,
        input.title,
        input.authorId,
        input.guildKey ?? null
      ]
    )
  ).rows[0];

  requireCondition(share.state !== 'hidden', 409, 'share_unavailable', '這份分享已停止公開。');
  if (share.state === 'retracted') {
    await q.query("UPDATE shares SET state='published' WHERE share_id=$1", [share.share_id]);
    share.state = 'published';
  }
  await endorseShare(q, share, input.authorId);
  return share.share_id;
}

export async function syncOriginalShareTitle(
  q: PoolClient,
  input: { kind: OriginalShareKind; refId: string; communityId: string; title: string }
): Promise<void> {
  await q.query(
    'UPDATE shares SET title=$4 WHERE community_id=$1 AND kind=$2 AND ref_id=$3 AND title IS DISTINCT FROM $4',
    [input.communityId, input.kind, input.refId, input.title]
  );
}
