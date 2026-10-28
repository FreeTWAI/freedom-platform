const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ProfileRoute={kind:'workspace'}|{kind:'settings'}|{kind:'visitor';id:string}|{kind:'invalid'};
export function parseProfileRoute(hash:string):ProfileRoute|null{
  if(hash==='#profile')return {kind:'workspace'};
  if(!hash.startsWith('#profile?'))return null;
  const params=new URLSearchParams(hash.slice('#profile?'.length));
  if([...params.keys()].length!==1)return {kind:'invalid'};
  if(params.get('view')==='settings')return {kind:'settings'};
  const id=params.get('member');return id&&uuid.test(id)?{kind:'visitor',id:id.toLowerCase()}:{kind:'invalid'};
}
export function visitorProfileHash(id:string){if(!uuid.test(id))throw new Error('Invalid member id');return `#profile?member=${id.toLowerCase()}`;}
/** Directory rows remain readable when a legacy/malformed identifier cannot form a visitor route. */
export function directoryVisitorProfileHref(id:unknown):string|null{return typeof id==='string'&&uuid.test(id)?visitorProfileHash(id):null;}
/** Raw OAuth callbacks must retain the authentication flow before public routing. */
export function canOpenGuestProfile(hash:string,search:string){
  const params=new URLSearchParams(search);
  return parseProfileRoute(hash)?.kind==='visitor'&&!['code','state','error'].some(key=>params.has(key));
}
