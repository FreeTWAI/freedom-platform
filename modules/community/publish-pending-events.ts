import {exposeEvent} from './event-exposure.js';
import type {Pool} from 'pg';
import {transaction} from '../../packages/db/index.js';
import {publishEventShare} from '../shares/event-ledger.js';
/** Explicit release step, never run by migration or startup. Hidden/retracted shares are excluded. */
export async function publishPendingEvents(pool:Pool,apply=false){
 return transaction(pool,async q=>{
  const rows=(await q.query(`SELECT e.* FROM community_events e WHERE state='pending' AND starts_at>clock_timestamp()
    AND NOT EXISTS(SELECT 1 FROM shares s WHERE s.kind='event' AND s.ref_id=e.event_id AND s.state<>'published') ORDER BY event_id FOR UPDATE OF e`)).rows;
  let applied=0;
  if(apply)for(const row of rows){
   const updated=(await q.query(`UPDATE community_events SET state='published',aggregate_version=aggregate_version+1,updated_at=now()
     WHERE event_id=$1 AND state='pending' AND starts_at>clock_timestamp() RETURNING *`,[row.event_id])).rows[0];
   if(updated){await publishEventShare(q,updated);await exposeEvent(q,updated);applied++;}
  }
  return {eligible:rows.length,applied};
 });
}
