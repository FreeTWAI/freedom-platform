import {z} from 'zod';

// Shared error projection; importing it must not initialize payment/checkout schemas.
export const OfflineSettingsFieldErrorCodeSchema=z.enum(['required','format','too_short','too_long','out_of_range']);
export const OfflineSettingsFieldErrorSchema=z.object({path:z.string().max(80).regex(/^[a-z_]+(\.([0-9]{1,2}|[a-z_]+))*$(?![\s\S])/),code:OfflineSettingsFieldErrorCodeSchema}).strict();
