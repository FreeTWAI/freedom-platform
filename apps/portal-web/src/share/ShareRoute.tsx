import type {PortalClient} from '../api';
import {SharePage} from './SharePage';
export function isShareRoute(hash:string){return /^#shares\/[0-9a-f-]{36}(?:\?|$)/.test(hash);}
export function ShareRoute({client,hash}:{client:PortalClient;hash:string}){
 const match=/^#shares\/([0-9a-f-]{36})(?:\?(.*))?$/.exec(hash);return match?<SharePage key={match[1]} client={client} id={match[1]} via={new URLSearchParams(match[2]).get('via')??undefined}/>:null;
}
