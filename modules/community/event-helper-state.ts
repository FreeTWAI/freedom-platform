import {requireCondition} from '../../packages/shared/problem.js';
export type EventHelperState='applied'|'accepted'|'declined'|'withdrawn';
export type EventHelperAction='offer'|'withdraw'|'accept'|'decline';
/** Pure transition policy. Helping never implies an attendance reservation. */
export function nextEventHelperState(state:EventHelperState|null,action:EventHelperAction):EventHelperState {
  if(action==='offer'&&(state===null||state==='withdrawn'))return 'applied';
  if(action==='withdraw'&&(state==='applied'||state==='accepted'))return 'withdrawn';
  if(action==='accept'&&state==='applied')return 'accepted';
  if(action==='decline'&&state==='applied')return 'declined';
  requireCondition(false,409,'helper_state_conflict','幫手申請狀態已改變，請重新讀取。');
  throw new Error('unreachable');
}
