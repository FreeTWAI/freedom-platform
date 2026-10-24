import { z } from 'zod';
import { journalMedia } from './media.js';
const text = (max:number) => z.string().max(max).refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v),'control_characters').refine(v=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v),'invalid_unicode');
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64);
const mediaUrl = z.string().refine(v=>/^\/media\/public\/[a-f0-9]{64}\.png$/.test(v)&&journalMedia.has(v.split('/').at(-1)!),'media_not_imported');
const position=z.string().regex(/^(100|[0-9]{1,2})(\.[0-9]+)?% (100|[0-9]{1,2})(\.[0-9]+)?%$/);
const media = z.object({url:mediaUrl,alt:text(200),width:z.number().int().positive().max(10000).nullable(),height:z.number().int().positive().max(10000).nullable(),display_fit:z.enum(['contain','cover']),object_position:position}).strict();
export const personSchema=z.object({slug,display_name:text(100).min(1),intro:text(4000).nullable(),kind:z.enum(['person','assistant']),color:z.string().regex(/^#[a-fA-F0-9]{6}$/),avatar:media,role:text(200),category:text(100),tags:z.array(text(100)).max(30)}).strict();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;});
// Attribution is supplied by the authorized producer and reviewed with the exact
// snapshot. A display name or avatar never establishes an identity.
export const sourceMessageSchema=z.object({
 time:z.iso.datetime({offset:true}),text:text(6000).min(1),sender_name:text(100).min(1).optional(),
 sender_avatar:z.object({url:mediaUrl,display_fit:z.enum(['contain','cover']),object_position:position}).strict().optional(),
 source_key:z.string().regex(/^[a-f0-9]{64}$/).optional(),person_slug:slug.optional(),
}).strict().superRefine((m,c)=>{
 if(m.person_slug&&!m.source_key)c.addIssue({code:'custom',message:'source_key_required'});
 if(m.sender_avatar&&!m.sender_name)c.addIssue({code:'custom',message:'source_sender_name_required'});
 if(!m.text.trim())c.addIssue({code:'custom',message:'source_text_required'});
});
export const journalSchema=z.object({date,title:text(300).min(1),excerpt:text(4000),version:z.number().int().positive().max(2147483647),coverage:z.object({is_partial:z.boolean()}).strict(),blocks:z.array(z.discriminatedUnion('type',[
 z.object({type:z.literal('heading'),text:text(1000),source_messages:z.array(sourceMessageSchema).max(100).optional()}).strict(),
 z.object({type:z.literal('paragraph'),text:text(20000)}).strict(),z.object({type:z.literal('quote'),text:text(20000)}).strict(),z.object({type:z.literal('list'),items:z.array(text(4000)).max(100)}).strict(),
])).max(1000),development_items:z.array(z.object({id:text(100),title:text(300),next_step:text(4000),status:z.enum(['proposed','in_progress','reported_done','verified_done'])}).strict()).max(100),decisions:z.array(z.object({text:text(4000),scope:text(2000)}).strict()).max(100),people:z.array(personSchema).max(100),hero:media.nullable(),
 reading_note:z.object({conclusion:text(300),priority_todo:text(300),discussion_question:text(300)}).strict().optional(),
}).strict();
export const snapshotSchema=z.object({schema_version:z.literal(1),source_revision:z.string().regex(/^[a-f0-9]{64}$/),people:z.array(personSchema).max(100),journals:z.array(journalSchema).max(366)}).strict().superRefine((v,c)=>{
 const people=new Map(v.people.map(p=>[p.slug,p]));
 if(people.size!==v.people.length)c.addIssue({code:'custom',message:'duplicate_person'});
 if(new Set(v.journals.map(j=>j.date)).size!==v.journals.length)c.addIssue({code:'custom',message:'duplicate_date'});
 const sources=new Map<string,string>();
 const taipei=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
 for(const j of v.journals){
  for(const p of j.people)if(JSON.stringify(p)!==JSON.stringify(people.get(p.slug)))c.addIssue({code:'custom',message:'person_mismatch'});
  for(const b of j.blocks){if(b.type!=='heading')continue;for(const m of b.source_messages||[]){
   if(m.person_slug&&!people.has(m.person_slug))c.addIssue({code:'custom',message:'source_person_unknown'});
   const instant=new Date(m.time);if(!Number.isFinite(instant.getTime())||taipei.format(instant)!==j.date)c.addIssue({code:'custom',message:'source_date_mismatch'});
   if(m.source_key){const identity=JSON.stringify([m.person_slug||null,m.text,m.time,m.sender_name||null,m.sender_avatar||null]);
    if(sources.has(m.source_key)&&sources.get(m.source_key)!==identity)c.addIssue({code:'custom',message:'source_key_conflict'});
    sources.set(m.source_key,identity);
   }
  }}
 }
});
export type JournalSnapshot=z.infer<typeof snapshotSchema>;
export type JournalPerson=z.infer<typeof personSchema>;
export type JournalEntry=z.infer<typeof journalSchema>;
export type JournalSourceMessage=z.infer<typeof sourceMessageSchema>;
