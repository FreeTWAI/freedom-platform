import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { transaction, journal } from '../../packages/db/index.js';
import { assertCurrentSessionClock } from '../../packages/db/member-session.js';
import { Problem, requireCondition } from '../../packages/shared/problem.js';
import { tokenHash, verifyMemberPassword, type Actor } from './service.js';
import type { EventEmailSender } from '../community/events.js';

export const EmailChangeInput=z.object({email:z.email().max(200),password:z.string().min(1).max(128)}).strict();

export async function requestEmailChange(pool:Pool,actor:Actor,raw:unknown,origin:string,send:EventEmailSender){
  const body=EmailChangeInput.parse(raw),email=body.email.trim().toLowerCase();
  const token=randomBytes(32).toString('base64url'),hash=tokenHash(token);
  await transaction(pool,async q=>{
    const user=(await q.query('SELECT * FROM users WHERE user_id=$1 AND community_id=$2 AND active FOR UPDATE',[actor.user_id,actor.community_id])).rows[0];
    requireCondition(user,401,'session_expired','請重新登入。');
    const session=await q.query('SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[actor.session_hash,actor.user_id]);
    requireCondition(session.rowCount===1,401,'session_expired','請重新登入。');
    requireCondition(await verifyMemberPassword(q,actor.user_id,body.password),401,'invalid_credentials','目前密碼不正確。');
    requireCondition(email!==user.email,422,'email_unchanged','請輸入不同的新 Email。');
    requireCondition(!(await q.query('SELECT 1 FROM users WHERE email=$1',[email])).rowCount,409,'email_in_use','此 Email 已被使用。');
    await q.query('DELETE FROM login_email_change_tokens WHERE user_id=$1',[actor.user_id]);
    await q.query(`INSERT INTO login_email_change_tokens(token_hash,user_id,old_email,new_email,requesting_session_hash,credential_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 minutes')`,[hash,actor.user_id,user.email,email,actor.session_hash,tokenHash(user.password_hash)]);
    await assertCurrentSessionClock(q,actor);
  });
  try{await send(email,'自由工坊：確認變更登入 Email',`請在 30 分鐘內開啟連結並確認變更登入 Email：\n${origin}/#change-email/${token}\n若非本人申請，請忽略此信。`);}
  catch{await pool.query('DELETE FROM login_email_change_tokens WHERE token_hash=$1',[hash]);throw new Problem(503,'email_change_send_failed','驗證信未寄送，請稍後重新申請。');}
  return {requested:true};
}

export async function confirmEmailChange(pool:Pool,rawToken:string,send:EventEmailSender){
  requireCondition(/^[A-Za-z0-9_-]{43}$/.test(rawToken),422,'email_change_link_invalid','變更連結無效或已過期，請重新申請。');
  const hash=tokenHash(rawToken);
  const precheck=(await pool.query(
    `SELECT t.old_email,t.new_email,t.credential_hash,u.email AS current_email,u.password_hash
     FROM login_email_change_tokens t
     JOIN users u ON u.user_id=t.user_id
     WHERE t.token_hash=$1 AND t.consumed_at IS NULL AND t.expires_at>clock_timestamp() AND u.active`,
    [hash],
  )).rows[0];
  requireCondition(precheck&&precheck.current_email===precheck.old_email&&tokenHash(precheck.password_hash)===precheck.credential_hash,422,'email_change_link_invalid','變更連結無效或已過期，請重新申請。');
  requireCondition(!(await pool.query('SELECT 1 FROM users WHERE email=$1',[precheck.new_email])).rowCount,409,'email_in_use','此 Email 已被使用。');
  // Notice goes out before the switch transaction so mail latency never locks the user row.
  try{await send(precheck.old_email,'自由工坊：登入 Email 變更提醒',`有人正嘗試將您的登入 Email 變更為 ${precheck.new_email}。此信提醒變更嘗試；實際帳號狀態請回工坊確認。若非本人操作，請立即聯絡平台管理員。`);}
  catch{throw new Problem(503,'email_change_notification_failed','通知信未寄送，Email 尚未變更，請稍後重試。');}
  try{return await transaction(pool,async q=>{
    const candidate=(await q.query('SELECT user_id FROM login_email_change_tokens WHERE token_hash=$1',[hash])).rows[0];
    requireCondition(candidate,422,'email_change_link_invalid','變更連結無效或已過期，請重新申請。');
    // Lock the user before tokens, matching authenticated member commands and requests.
    const user=(await q.query('SELECT * FROM users WHERE user_id=$1 AND active FOR UPDATE',[candidate.user_id])).rows[0];
    const proof=(await q.query(`SELECT * FROM login_email_change_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,[hash])).rows[0];
    requireCondition(user&&proof&&user.email===proof.old_email&&tokenHash(user.password_hash)===proof.credential_hash,422,'email_change_link_invalid','變更連結無效或已過期，請重新申請。');
    requireCondition(!(await q.query('SELECT 1 FROM users WHERE email=$1',[proof.new_email])).rowCount,409,'email_in_use','此 Email 已被使用。');
    await q.query('UPDATE users SET email=$2,email_verified_at=now() WHERE user_id=$1',[user.user_id,proof.new_email]);
    await q.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND token_hash<>$2 AND revoked_at IS NULL',[user.user_id,proof.requesting_session_hash]);
    await q.query('UPDATE login_email_change_tokens SET consumed_at=now() WHERE token_hash=$1',[hash]);
    await q.query('DELETE FROM password_reset_tokens WHERE user_id=$1',[user.user_id]);
    const account=(await q.query('UPDATE member_accounts SET aggregate_version=aggregate_version+1 WHERE user_id=$1 RETURNING aggregate_version',[user.user_id])).rows[0];
    await journal(q,{...user,session_hash:proof.requesting_session_hash,csrf_token:''},'member_account',user.user_id,account?.aggregate_version??1,'change_login_email',{});
    return {changed:true};
  });}catch(error){
    if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')throw new Problem(409,'email_in_use','此 Email 已被使用。');
    throw error;
  }
}
