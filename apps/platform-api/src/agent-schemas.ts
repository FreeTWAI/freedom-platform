import {z} from 'zod';
import {details,eventSource,eventRsvpInput} from '../../../modules/community/events.js';
import {actionInput} from '../../../modules/community/event-waitlist.js';
import {projectInput} from '../../../modules/opensource-marketing/service.js';
import {shareInput} from '../../../modules/shares/service.js';
import type {AgentOperation} from './agent-allowlist.js';

// JSON input projections; cross-field business rules remain with the domain parser.
// parseNewEvent supplies these four defaults before validating the details schema.
const newEventInput=z.object({...details.shape,...eventSource.shape,
 description:details.shape.description.optional(),ends_at:details.shape.ends_at.optional(),
 mode:details.shape.mode.optional(),capacity:details.shape.capacity.optional(),
 visibility:details.shape.visibility.unwrap().optional(),event_kind:details.shape.event_kind.unwrap().optional(),
}).strict();
// Routes with no payload validator (reads and events.links), and inline strict
// empty-object validators, share this explicit no-input contract.
const empty=z.object({}).strict();
export const agentBodySchemas:Record<string,z.ZodType>={
 'tools.identity':empty,'events.list':empty,'events.read':empty,'events.share':newEventInput,
 'events.links':empty,'events.interest':empty,'events.rsvp':eventRsvpInput,'events.waitlist':actionInput,
 'repositories.share':projectInput,'credit.records':empty,'credit.outcomes':empty,'credit.achievements':empty,
 'notifications.list':empty,'agent.events':empty,'shares.preview':shareInput,'shares.create':shareInput,
 'shares.list':empty,'shares.read':empty,'shares.retract':empty,'shares.links':empty,'credit.read':empty,'credit.results':empty,
};
export const agentPathSchemas:Record<string,z.ZodType>={
 id:z.uuid(),share_id:z.uuid(),guild:z.string().regex(/^guild_[a-zA-Z0-9_]+$/).max(100),
 tool:z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
};
const offset=z.number().int().min(0).max(10000).optional();
export const agentQuerySchemas:Record<string,z.ZodObject>={
 'agent.events':z.object({after:z.string().max(64).optional()}).strict(),
 'shares.list':z.object({limit:z.number().int().min(1).max(50).optional(),offset}).strict(),
 'credit.read':z.object({offset}).strict(),
 'credit.results':z.object({offset}).strict(),
};
export function agentInputSchema(op:AgentOperation){
 const shape:Record<string,z.ZodType>={};
 for(const [,name] of op.route.matchAll(/:([a-z_]+)/g)){
  if(!agentPathSchemas[name])throw new Error(`Missing agent path schema: ${name}`);
  shape[name]=agentPathSchemas[name];
 }
 if(!agentBodySchemas[op.id])throw new Error(`Missing agent body schema: ${op.id}`);
 if(op.method!=='GET'){
  shape.body=agentBodySchemas[op.id];
  shape.idempotency_key=z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
 }
 if(op.ifMatch)shape.version=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
 if(agentQuerySchemas[op.id])shape.query=agentQuerySchemas[op.id].optional();
 return z.object(shape).strict();
}
export function agentJsonSchema(schema:z.ZodType){
 return z.toJSONSchema(schema,{io:'input',unrepresentable:'any'});
}
