import {z} from 'zod';
export const certificationStates=['unrequested','pending','active','rejected','revoked','withdrawn'] as const;
export type CertificationState=typeof certificationStates[number];
export const CERTIFICATION_DESCRIPTION='管理員審核通過的社群標記；非實名查驗、信用評等或履約保證。';
export const CERTIFICATION_POLICY='community_certification_v1';
const text=z.string().trim().min(10).max(1000).refine(value=>!value.includes('\u0000'));
export const ApplicationInput=z.object({statement:text,acknowledged:z.literal(true)}).strict();
export const DisplayInput=z.object({show_community_certification:z.boolean()}).strict();
export const WithdrawInput=z.object({confirmed:z.literal(true)}).strict();
export const ReviewInput=z.object({decision:z.enum(['approve','reject','revoke']),reason:z.string().trim().min(3).max(1000).refine(value=>!value.includes('\u0000')),confirmed:z.literal(true)}).strict();
export const CertificationSettingsSchema=z.object({state:z.enum(certificationStates),aggregate_version:z.number().int().positive().safe(),show_community_certification:z.boolean(),statement:z.string().max(1000),policy_version:z.literal(CERTIFICATION_POLICY)}).strict();
export type CertificationSettings=z.infer<typeof CertificationSettingsSchema>;
export const CertificationReviewAckSchema=z.object({updated:z.literal(true)}).strict();
export const CertificationQueueSchema=z.object({items:z.array(CertificationSettingsSchema.extend({user_id:z.string().uuid(),display_name:z.string()}).strict()).max(50),next_offset:z.number().int().nonnegative().safe().nullable()}).strict();
export type CertificationBadge={kind:'community_certification';label:'社群認證';description:typeof CERTIFICATION_DESCRIPTION};
/** Presentation only. Call with facts admitted by the canonical SQL profile ACL. */
export function certificationBadge(state:unknown,optIn:unknown):CertificationBadge|undefined{
  return state==='active'&&optIn===true?{kind:'community_certification',label:'社群認證',description:CERTIFICATION_DESCRIPTION}:undefined;
}
export function nextCertificationState(current:CertificationState,action:'apply'|'withdraw'|'approve'|'reject'|'revoke'):CertificationState|undefined{
  if(action==='apply'&&['unrequested','rejected','revoked','withdrawn'].includes(current))return 'pending';
  if(action==='withdraw'&&['pending','active'].includes(current))return 'withdrawn';
  if(action==='approve'&&current==='pending')return 'active';
  if(action==='reject'&&current==='pending')return 'rejected';
  if(action==='revoke'&&current==='active')return 'revoked';
  return undefined;
}

export const certificationStateLabels={unrequested:'尚未申請',pending:'等待人工審核',active:'社群認證有效',rejected:'本次申請未通過',revoked:'社群認證已撤銷',withdrawn:'已撤回'};

/** Only a complete command rejection can release its pending operation tuple.
 * GET, auth failures, malformed replies and transport errors are not receipts. */
export function certificationCommandRejected(status:number,completeCommandResponse:boolean,everUnknown=false):boolean {
  return !everUnknown&&completeCommandResponse&&(status===412||status===422);
}
