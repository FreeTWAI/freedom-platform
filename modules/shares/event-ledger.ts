import {requireSharePublicationQuota} from './publication-quota.js';
import {randomBytes} from 'node:crypto';
import type {PoolClient} from 'pg';
import {endorseShare,creditEventRegistrations} from './credit.js';
import {requireCondition} from '../../packages/shared/problem.js';
/** Internal domain port: called in the event's publication transaction, never from client facts. */
export async function publishEventShare(q:PoolClient,event:any,newPublication=false){
 if(newPublication)await requireSharePublicationQuota(q,event.organizer_ref);
 const share=(await q.query(`INSERT INTO shares(community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id,guild_key,created_at)
 VALUES($1,'event',$2,$3,'community_events',$4,$5,$6,$7,$8) ON CONFLICT(community_id,kind,canonical_key) DO UPDATE SET title=EXCLUDED.title RETURNING *`,
 [event.community_id,`event:${event.event_id}`,`/events/${event.event_id}`,event.event_id,event.title,event.organizer_ref,event.guild_key,event.created_at])).rows[0];
 requireCondition(share.state!=='hidden',409,'share_unavailable','這份分享已停止公開。');
 if(share.state==='retracted'){await q.query("UPDATE shares SET state='published' WHERE share_id=$1",[share.share_id]);share.state='published';}
 await endorseShare(q,share,event.organizer_ref);
 await creditEventRegistrations(q,event.event_id);
 await q.query(`INSERT INTO community_event_share_codes(event_id,user_id,code) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[event.event_id,event.organizer_ref,randomBytes(18).toString('base64url')]);
 await q.query(`INSERT INTO promotion_links(community_id,user_id,kind,target_key,code) VALUES($1,$2,'event',$3,$4) ON CONFLICT DO NOTHING`,[event.community_id,event.organizer_ref,event.event_id,randomBytes(7).toString('base64url')]);
 return share;
}
