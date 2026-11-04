/** Public projection only. Asset, object and retained target identities stay server-side. */
export interface EventPrizePhoto {prize_id:string;photo_version:number;url:string}
export interface EventPrizePhotoAvailability {event_id:string;prize_id:string;organizer_ref:string;upload_available:boolean}
export interface EventPrizePhotoAck {
  acknowledged:true;event_id:string;prize_id:string;organizer_ref:string;command_key:string;
  operation:'replace'|'remove';completed_version:number;photo:EventPrizePhoto|null;
}
export function eventPrizePhotoUrl(eventId:string,prizeId:string,version:number,publicRead=false){
  return `/api/v1/${publicRead?'public/':''}events/${eventId}/prizes/${prizeId}/photo?v=${version}`;
}
