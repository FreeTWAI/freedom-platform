import {z} from 'zod';
import {EVENT_PRIZE_ICON_IDS} from './event-prize-icons.js';

// Technical input bounds, not a limit on eligibility or a fulfilment promise.
export const EVENT_PRIZE_LIMIT=5;
export const EVENT_PRIZE_QUANTITY_LIMIT=500;
const prizeText=(max:number,required=true)=>z.string().trim().min(required?1:0).max(max)
  .refine(value=>!/[\uD800-\uDFFF]/u.test(value)&&!value.includes('\0'),'請使用有效的文字。');
export const eventPrizeDetailSchema=z.object({
  prize_id:z.uuidv4().toLowerCase(),
  name:prizeText(120),
  description:prizeText(500,false),
  quantity:z.number().int().min(1).max(EVENT_PRIZE_QUANTITY_LIMIT),
  icon_id:z.enum(EVENT_PRIZE_ICON_IDS),
  completion_rule:prizeText(500),
  claim_note:prizeText(500),
}).strict();
export const eventPrizeDetailsSchema=z.array(eventPrizeDetailSchema).max(EVENT_PRIZE_LIMIT).superRefine((items,ctx)=>{
  const ids=new Set<string>();
  items.forEach((item,index)=>{
    if(ids.has(item.prize_id))ctx.addIssue({code:'custom',message:'每項獎品必須有不同的識別碼。',path:[index,'prize_id']});
    ids.add(item.prize_id);
  });
});
export type EventPrizeDetail=z.infer<typeof eventPrizeDetailSchema>;

/** No receipt fallback: a server that ignored these fields has not confirmed them. */
export function confirmEventPrizeDetails(value:unknown,expected:readonly EventPrizeDetail[]):void {
  const actual=eventPrizeDetailsSchema.parse(value);
  if(!actual.every((item,index)=>Object.entries(item).every(([key,field])=>(value as Record<string,unknown>[])[index][key]===field)))throw new Error('event_prize_receipt_not_canonical');
  if(JSON.stringify(actual)!==JSON.stringify(eventPrizeDetailsSchema.parse(expected)))throw new Error('event_prize_receipt_mismatch');
}

/** Bind descriptive prize confirmation to this organizer's original event write. */
export function confirmEventPrizeReceipt(value:unknown,expected:{event_id:string|null;organizer_ref:string;aggregate_version:number;prize_details:readonly EventPrizeDetail[]}):void {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('event_prize_receipt_invalid');
  const row=value as Record<string,unknown>;
  if(!z.uuid().safeParse(row.event_id).success||expected.event_id!==null&&row.event_id!==expected.event_id
    ||row.organizer_ref!==expected.organizer_ref||row.state!=='pending'||row.aggregate_version!==expected.aggregate_version
    ||!Number.isSafeInteger(row.aggregate_version))throw new Error('event_prize_receipt_invalid');
  confirmEventPrizeDetails(row.prize_details,expected.prize_details);
}
