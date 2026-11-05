import {z} from 'zod';
import {SOCIAL_POLICY} from '../../../../modules/social-achievements/policy';
// Canonical HTTP versions are safe positive integers; retain legacy string responses
// and normalize only this client field, leaving If-Match and retry tuples unchanged.
const AggregateVersion=z.union([z.string().regex(/^[1-9][0-9]*$/),z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String)]).nullable();
const Progress=z.object({days:z.number().int().nonnegative(),next_days:z.number().int().positive().nullable(),remaining:z.number().int().nonnegative()});
export const AchievementState=z.object({policy_version:z.literal(SOCIAL_POLICY),counting_enabled:z.boolean(),show_title:z.boolean(),selected_title:z.string().regex(/^(chat|participation)_(1|7|30|90|365)$/).nullable(),aggregate_version:AggregateVersion,status:z.enum(['active','paused','revoked']),moderation_reason:z.string().nullable(),appeal_state:z.enum(['none','pending','resolved']),can_moderate:z.boolean(),chat:Progress,participation:Progress,titles:z.array(z.object({title_id:z.string().regex(/^(chat|participation)_(1|7|30|90|365)$/),label:z.string(),days:z.number().int().positive(),track:z.enum(['chat','participation']),unlocked:z.boolean()})).min(1)});
export type AchievementStateValue=z.infer<typeof AchievementState>;
