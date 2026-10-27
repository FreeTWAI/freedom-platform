import {CERTIFICATION_DESCRIPTION} from './community-certification.js';
import {z} from 'zod';

const text=(max:number)=>z.string().refine(value=>!/[\u0000-\u001f\u007f]/.test(value),'請使用單行文字。').trim().max(max);
export const ProfileVisibility=z.enum(['private','members','public']);
const httpsUrl=text(500).refine(value=>{
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.href.length<=500;}catch{return false;}
},'只接受不含帳密的 HTTPS 網址。');
const link=z.object({label:text(40).min(1),url:httpsUrl}).strict();
export const ProfileBlockId=z.enum(['about','featured','links','recognition']);
export const profileBlockLabels={about:'關於我',featured:'精選作品',links:'我的連結',recognition:'稱號與社群認證'} as const;
export const ProfileLayout=z.object({
 theme:z.enum(['paper','night','sage','rose']),accent:z.enum(['violet','blue','teal','berry','amber']),
 cover_style:z.enum(['horizon','grid','constellation','waves']),cover_alt:text(120),
 about:z.string().refine(value=>!/[\u0000-\u0009\u000b-\u001f\u007f]/.test(value),'介紹只能使用文字與換行。').trim().max(1600),
 featured:z.array(z.object({title:text(80).min(1),description:text(180),url:httpsUrl}).strict()).max(6),
 blocks:z.array(z.object({id:ProfileBlockId,visible:z.boolean()}).strict()).length(4),
}).strict().refine(value=>new Set(value.blocks.map(block=>block.id)).size===4,'每個區塊只能出現一次。');
export type ProfileLayoutData=z.infer<typeof ProfileLayout>;
export function moveProfileBlock(value:ProfileLayoutData,id:ProfileLayoutData['blocks'][number]['id'],direction:-1|1):ProfileLayoutData{
 const index=value.blocks.findIndex(block=>block.id===id),next=index+direction;
 if(index<0||next<0||next>=value.blocks.length)return value;
 const blocks=value.blocks.map(block=>({...block}));[blocks[index],blocks[next]]=[blocks[next],blocks[index]];return {...value,blocks};
}

export const defaultProfileLayout:ProfileLayoutData={theme:'paper',accent:'violet',cover_style:'horizon',cover_alt:'個人頁封面',about:'',featured:[],blocks:[{id:'about',visible:true},{id:'featured',visible:true},{id:'links',visible:true},{id:'recognition',visible:true}]};
const layout=ProfileLayout.default(()=>structuredClone(defaultProfileLayout));
const positiveVersion=z.string().refine(value=>/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n,'版本資料不正確。');
export const ProfileCoverSnapshot=z.object({version:positiveVersion,generation:positiveVersion}).strict();
export type ProfileCoverSnapshotData=z.infer<typeof ProfileCoverSnapshot>;
/** Separate, explicitly confirmed publication; never copy the account DTO. */
export const ProfilePublicationInput=z.object({
  visibility:ProfileVisibility,display_name:text(60).min(1),bio:text(280),links:z.array(link).max(5),layout,
  include_cover:z.boolean().default(false),cover_version:positiveVersion.nullable().default(null),
  confirm_public:z.boolean().default(false),
}).strict().refine(value=>!value.include_cover||value.cover_version!==null,{message:'請先選擇並確認這一張封面。',path:['cover_version']}).refine(value=>value.visibility!=='public'||value.confirm_public,{message:'公開後任何人都能閱讀，包括未登入者；請明確確認。',path:['confirm_public']});
export const VisitorProfile=z.object({display_name:text(60).min(1),bio:text(280),links:z.array(link).max(5),avatar_url:z.null(),layout,cover:ProfileCoverSnapshot.nullable().default(null)}).strict();
export type VisitorProfileData=z.infer<typeof VisitorProfile>;
export const ProfilePublicationSettingsSchema=z.object({visibility:ProfileVisibility,display_name:text(60),bio:text(280),links:z.array(link).max(5),avatar_url:z.null(),layout,cover:ProfileCoverSnapshot.nullable().default(null),include_cover:z.boolean().default(false),cover_version:positiveVersion.nullable().default(null),aggregate_version:positiveVersion.nullable()}).strict();
export type ProfilePublicationSettingsData=z.infer<typeof ProfilePublicationSettingsSchema>;

export type ProfileVisibilityValue=z.infer<typeof ProfileVisibility>;
/** Policy model used by tests; database reads enforce these predicates in SQL too. */
export function canReadVisitorProfile(input:{visibility:ProfileVisibilityValue;ownerReady:boolean;self:boolean;viewerReady:boolean;sameCommunity:boolean;blocked:boolean;anonymous:boolean}){
  if(!input.ownerReady)return false;
  if(input.anonymous)return input.visibility==='public';
  return input.viewerReady&&input.sameCommunity&&(input.self||(!input.blocked&&input.visibility!=='private'));
}
type PublicationRow={display_name:string;bio:string;links:unknown;layout?:unknown;cover?:unknown};
/** Owner-only editable snapshot. Hidden values must survive settings reads and saves. */
export function ownerPublicationProfile(row:PublicationRow):VisitorProfileData{
  return VisitorProfile.parse({display_name:row.display_name,bio:row.bio,links:row.links,avatar_url:null,layout:row.layout,cover:row.cover??null});
}
export function profileBlockVisible(profile:VisitorProfileData,id:z.infer<typeof ProfileBlockId>):boolean{
  return profile.layout.blocks.some(block=>block.id===id&&block.visible);
}
/** Visitor responses omit hidden content, not merely its rendered elements.
 * Keep the bounded DTO shape with empty values; never mutate the stored/owner snapshot. */
export function visitorProfile(row:PublicationRow):VisitorProfileData{
  const profile=ownerPublicationProfile(row);
  if(!profileBlockVisible(profile,'about'))profile.layout.about='';
  if(!profileBlockVisible(profile,'featured'))profile.layout.featured=[];
  if(!profileBlockVisible(profile,'links'))profile.links=[];
  return profile;
}
/** Authenticated-only envelope. Never used by the anonymous route. */
export const MemberVisitorProfile=z.object({profile:VisitorProfile,community_certification:z.object({kind:z.literal('community_certification'),label:z.literal('社群認證'),description:z.literal(CERTIFICATION_DESCRIPTION)}).strict().optional(),social_achievement:z.object({title_id:z.string().regex(/^(chat|participation)_(1|7|30|90|365)$/),label:z.string().min(1).max(30),policy_version:z.literal('social_days_v1'),description:z.string().max(200)}).strict().optional(),actions:z.object({
  is_self:z.boolean(),friendship:z.object({state:z.enum(['none','removed','pending','accepted']),requester_ref:z.uuid().nullable(),aggregate_version:z.string().nullable()}).strict(),
  can_request:z.boolean(),can_accept:z.boolean(),can_message:z.boolean(),
}).strict()}).strict();
export type MemberVisitorProfileData=z.infer<typeof MemberVisitorProfile>;
