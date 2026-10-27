import {z} from 'zod';

const text=(max:number)=>z.string().refine(value=>!/[\u0000-\u001f\u007f]/.test(value),'請使用單行文字。').trim().max(max);
export const ProfileVisibility=z.enum(['private','members','public']);
const link=z.object({label:text(40).min(1),url:text(500).refine(value=>{
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.href.length<=500;}catch{return false;}
},'只接受不含帳密的 HTTPS 網址。')}).strict();
/** Separate, explicitly confirmed publication; never copy the account DTO. */
export const ProfilePublicationInput=z.object({
  visibility:ProfileVisibility,display_name:text(60).min(1),bio:text(280),links:z.array(link).max(5),
  confirm_public:z.boolean().default(false),
}).strict().refine(value=>value.visibility!=='public'||value.confirm_public,{message:'公開後任何人都能閱讀，包括未登入者；請明確確認。',path:['confirm_public']});
export const VisitorProfile=z.object({display_name:text(60).min(1),bio:text(280),links:z.array(link).max(5),avatar_url:z.null()}).strict();
export type VisitorProfileData=z.infer<typeof VisitorProfile>;
export type ProfileVisibilityValue=z.infer<typeof ProfileVisibility>;
/** Policy model used by tests; database reads enforce these predicates in SQL too. */
export function canReadVisitorProfile(input:{visibility:ProfileVisibilityValue;ownerReady:boolean;self:boolean;viewerReady:boolean;sameCommunity:boolean;blocked:boolean;anonymous:boolean}){
  if(!input.ownerReady)return false;
  if(input.anonymous)return input.visibility==='public';
  return input.viewerReady&&input.sameCommunity&&(input.self||(!input.blocked&&input.visibility!=='private'));
}
export function visitorProfile(row:{display_name:string;bio:string;links:unknown}):VisitorProfileData{
  return VisitorProfile.parse({display_name:row.display_name,bio:row.bio,links:row.links,avatar_url:null});
}
/** Authenticated-only envelope. Never used by the anonymous route. */
export const MemberVisitorProfile=z.object({profile:VisitorProfile,actions:z.object({
  is_self:z.boolean(),friendship:z.object({state:z.enum(['none','removed','pending','accepted']),requester_ref:z.uuid().nullable(),aggregate_version:z.string().nullable()}).strict(),
  can_request:z.boolean(),can_accept:z.boolean(),can_message:z.boolean(),
}).strict()}).strict();
export type MemberVisitorProfileData=z.infer<typeof MemberVisitorProfile>;
