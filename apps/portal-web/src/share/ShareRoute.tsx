import type {PortalClient} from '../api';
import {SharePage} from './SharePage';
import {MyCredit} from './MyCredit';
export function isShareRoute(hash:string){return /^#shares\/[0-9a-f-]{36}(?:\?|$)/.test(hash)||hash==='#me/credit';}
export function ShareRoute({client,hash}:{client:PortalClient;hash:string}){
 if(hash==='#me/credit')return <MyCredit client={client}/>;
 const match=/^#shares\/([0-9a-f-]{36})(?:\?(.*))?$/.exec(hash);return match?<SharePage key={match[1]} client={client} id={match[1]} via={new URLSearchParams(match[2]).get('via')??undefined}/>:null;
}
