import {z} from 'zod';
import {details,eventSource,eventRsvpInput} from '../../../modules/community/events.js';
import {actionInput} from '../../../modules/community/event-waitlist.js';
import {projectInput} from '../../../modules/opensource-marketing/service.js';
import {shareInput} from '../../../modules/shares/service.js';
import {text} from '../../../packages/shared/validation.js';
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
 'events.update':details.safeExtend({source_cover_url:eventSource.shape.source_cover_url.optional()}),
 'events.announce':z.object({message:text(300)}).strict(),'events.cancel':empty,
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
export const agentPendingSchema=z.looseObject({
 status:z.literal('pending_member'),
 code:z.literal('pending_member'),
 detail:z.string(),
});
export const agentErrorSchema=z.looseObject({
 type:z.string(),
 title:z.string(),
 status:z.number().int(),
 code:z.string(),
 detail:z.string(),
});
const eventSummaryShape={
 event_id:z.string(),
 community_id:z.string(),
 organizer_ref:z.string(),
 guild_key:z.string().nullable(),
 title:z.string(),
 description:z.string().nullable(),
 starts_at:z.string(),
 ends_at:z.string().nullable(),
 mode:z.string(),
 location:z.string().nullable(),
 capacity:z.number().int().nullable(),
 state:z.string(),
 reviewer_user_ref:z.string().nullable(),
 reviewer_admin_ref:z.string().nullable(),
 review_reason:z.string().nullable(),
 reviewed_at:z.string().nullable(),
 aggregate_version:z.number().int(),
 created_at:z.string(),
 updated_at:z.string(),
 event_kind:z.string(),
 topic:z.string().nullable(),
 online_url:z.string().nullable(),
 review_guild_key:z.string().nullable(),
 visibility:z.string(),
 waitlist_enabled:z.boolean(),
 response_window_minutes:z.union([z.string(),z.number()]).nullable(),
 waitlist_reconciled_at:z.string().nullable(),
 help_need:z.string().nullable(),
 registration_policy:z.string(),
 prize_details:z.array(z.unknown()),
 via_agent:z.boolean(),
 source_url:z.string().nullable(),
 source_host:z.string().nullable(),
 imported:z.boolean(),
 registration_mode:z.string(),
 external_registration_url:z.string().nullable(),
 source_organizer:z.string().nullable(),
 source_cover_url:z.string().nullable(),
 organizer_name:z.string().nullable(),
 banner_url:z.string().nullable(),
 banner_orientation:z.string().nullable(),
 video_url:z.string().nullable(),
 video_mime:z.string().nullable(),
 attending_count:z.number().int(),
 my_rsvp:z.string().nullable(),
 can_review:z.boolean(),
};
const achievementTrack=z.looseObject({days:z.number().int(),next_days:z.number().int().nullable(),remaining:z.number().int().nullable()});
const achievementTitle=z.looseObject({title_id:z.string(),track:z.string(),days:z.number().int(),label:z.string(),unlocked:z.boolean()});
const eventDetailShape={...eventSummaryShape,prize_photos:z.array(z.unknown())};
const eventDetailSchema=z.looseObject(eventDetailShape);
export const agentResponseSchemas:Record<string,z.ZodType>={
 'events.list':z.looseObject({items:z.array(z.looseObject(eventSummaryShape))}),
 'events.read':eventDetailSchema,
 'credit.records':z.looseObject({policy:z.string(),accepted_count:z.number().int(),entries:z.array(z.looseObject({})),next_offset:z.number().int().nullable()}),
 'credit.outcomes':z.looseObject({policy:z.string(),member_ref:z.string(),accepted_count:z.number().int(),entries:z.array(z.looseObject({})),next_offset:z.number().int().nullable()}),
 'credit.achievements':z.looseObject({
  policy_version:z.string(),
  counting_enabled:z.boolean(),
  show_title:z.boolean(),
  selected_title:z.string().nullable(),
  status:z.string(),
  moderation_reason:z.string().nullable(),
  appeal_state:z.string(),
  aggregate_version:z.number().int().nullable(),
  chat:achievementTrack,
  participation:achievementTrack,
  titles:z.array(achievementTitle),
  can_moderate:z.boolean(),
  selected:achievementTitle.nullable(),
 }),
 'notifications.list':z.looseObject({
  items:z.array(z.looseObject({
   notification_id:z.string(),
   kind:z.string(),
   title:z.string(),
   body:z.string().nullable(),
   created_at:z.string(),
   read_at:z.string().nullable(),
   action:z.union([z.string(),z.looseObject({})]).nullable(),
  })),
  unread_count:z.number().int(),
  next_offset:z.number().int().nullable(),
 }),
 'agent.events':z.looseObject({
  items:z.array(z.looseObject({
   event_id:z.string(),
   kind:z.string(),
   resource_id:z.string().nullable(),
   created_at:z.string(),
   cursor:z.string(),
  })),
  next_cursor:z.string().nullable(),
  has_more:z.boolean(),
 }),
 'shares.list':z.looseObject({
  items:z.array(z.looseObject({
   share_id:z.string(),
   kind:z.string(),
   title:z.string().nullable(),
   url:z.string(),
  })),
  next_offset:z.number().int().nullable(),
 }),
 'shares.read':z.looseObject({
  share_id:z.string(),
  community_id:z.string(),
  kind:z.string(),
  canonical_key:z.string(),
  canonical_url:z.string().nullable(),
  repo_id:z.string().nullable(),
  ref_table:z.string().nullable(),
  ref_id:z.string().nullable(),
  title:z.string().nullable(),
  first_sharer_user_id:z.string(),
  state:z.string(),
  reports_confirmed_at:z.string().nullable(),
  guild_key:z.string().nullable(),
  legacy_ref:z.array(z.unknown()),
  created_at:z.string(),
  sharers:z.array(z.looseObject({display_name:z.string(),role:z.string()})),
  repository:z.looseObject({}).nullable(),
 }),
 'credit.read':z.looseObject({
  items:z.array(z.looseObject({
   share_id:z.string(),
   title:z.string().nullable(),
   kind:z.string(),
   state:z.string(),
   role:z.string(),
   basis:z.string(),
   count:z.number().int(),
  })),
  next_offset:z.number().int().nullable(),
 }),
 'credit.results':z.looseObject({
  items:z.array(z.looseObject({
   key:z.string(),
   kind:z.string(),
   title:z.string().nullable(),
   available:z.boolean(),
   link:z.looseObject({kind:z.string(),target:z.string(),path:z.string()}).nullable(),
   open_path:z.string().nullable(),
   clicks:z.number().int(),
   stars:z.number().int(),
   registrations:z.number().int(),
   last_at:z.string().nullable(),
  })),
  next_offset:z.number().int().nullable(),
 }),
 'tools.identity':z.looseObject({
  access_token:z.string(),
  token_type:z.string(),
  expires_in:z.number().int(),
  audience:z.string(),
  issuer:z.string(),
 }),
 'events.share':z.looseObject({...eventDetailShape,share_id:z.string()}),
 'events.links':z.looseObject({
  path:z.string(),
  share_id:z.string(),
  clicks:z.number().int(),
  registrations:z.number().int(),
 }),
 'events.update':eventDetailSchema,
 'events.announce':z.looseObject({
  announcement_id:z.string(),
  event_id:z.string(),
  event_version:z.number().int(),
  recorded:z.boolean(),
 }),
 'events.cancel':eventDetailSchema,
 'events.interest':z.looseObject({interested:z.boolean(),registered:z.boolean()}),
 'events.rsvp':eventDetailSchema,
 'events.waitlist':z.looseObject({
  event_id:z.string(),
  event_version:z.number().int(),
  event_state:z.string(),
  starts_at:z.string(),
  waitlist_enabled:z.boolean(),
  response_window_minutes:z.number().int().nullable(),
  rsvp_state:z.string().nullable(),
  waitlist:z.looseObject({
   status:z.string(),
   aggregate_version:z.number().int(),
   joined_at:z.string(),
   invited_at:z.string().nullable(),
   expires_at:z.string().nullable(),
   delivery_status:z.string(),
  }).nullable(),
  available_seats:z.number().int().nullable(),
 }),
 'repositories.share':z.looseObject({
  project_id:z.string(),
  community_id:z.string(),
  owner_ref:z.string(),
  title:z.string(),
  description:z.string(),
  use_notes:z.string(),
  demo_url:z.string().nullable(),
  repository_id:z.string(),
  repository_full_name:z.string(),
  repository_url:z.string(),
  relationship:z.string(),
  relationship_verification:z.string(),
  status:z.string(),
  official:z.boolean(),
  commercial_ready:z.boolean(),
  current_version_id:z.string(),
  aggregate_version:z.number().int(),
  created_at:z.string(),
  updated_at:z.string(),
  public_metadata_revised:z.boolean(),
  sharing_withdrawn_at:z.string().nullable(),
  share_id:z.string().nullable(),
  via_agent:z.boolean(),
  owner_name:z.string(),
  current_version:z.looseObject({
   version_id:z.string(),
   project_id:z.string(),
   repository_id:z.string(),
   commit_sha:z.string(),
   default_branch:z.string(),
   repository_full_name:z.string(),
   repository_url:z.string(),
   readme_url:z.string(),
   license_spdx:z.string(),
   license_evidence_url:z.string().nullable(),
   is_fork:z.boolean(),
   archived:z.boolean(),
   source_snapshot:z.looseObject({}),
   source_sha256:z.string(),
   facts_sha256:z.string(),
   inspected_at:z.string(),
  }),
 }),
 'shares.preview':z.looseObject({
  kind:z.string(),
  title:z.string(),
  url:z.string(),
  description:z.string(),
  original_author:z.string().nullable(),
  event:z.looseObject({source_url:z.string()}).optional(),
 }),
 'shares.create':z.looseObject({
  share_id:z.string(),
  created:z.boolean(),
  url:z.string(),
  via_agent:z.boolean(),
 }),
 'shares.retract':z.looseObject({
  share_id:z.string(),
  state:z.string(),
 }),
 'shares.links':z.looseObject({
  path:z.string(),
  code:z.string(),
 }),
};
