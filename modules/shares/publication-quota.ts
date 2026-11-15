import type {PoolClient} from 'pg';
import {requireCondition} from '../../packages/shared/problem.js';
/** Shared by every new publication; retained-record backfill is not a new member action. */
export async function requireSharePublicationQuota(q:PoolClient,userId:string){
 await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`share/member/${userId}`]);
 const n=(await q.query(`SELECT count(*)::int n FROM shares WHERE first_sharer_user_id=$1 AND created_at>=(date_trunc('day',now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei')`,[userId])).rows[0].n;
 requireCondition(n<20,429,'share_daily_limit','今天的分享已達上限。');
}
