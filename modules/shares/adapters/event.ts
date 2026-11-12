import { existingAdapter } from './existing.js';
// The event builder can replace this adapter without changing the registry or share service.
export const eventAdapter=existingAdapter('event','community_events','/events/');
