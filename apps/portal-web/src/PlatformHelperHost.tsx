import {useLayoutEffect,useRef,useState} from 'react';
import {PORTAL_FEATURE_METADATA} from './features/metadata';
import {pageHelp} from './page-help';
import {PlatformHelper} from './modules/platform-helper/PlatformHelper';
import {buildHelperKnowledge} from './modules/platform-helper/knowledge';
import type {HelperPageId} from './modules/platform-helper/model';

type ShellState={sessionGeneration:number;mobileOpen:boolean;messagesOpen:boolean;pending:boolean;accessExpired:boolean};
export type PlatformHelperHostProps=ShellState&{
  pageId:string;
  /** Actual accepted location, used only as a React key; never shown or logged. */
  routeIdentity:string;
  guildLaunchpadEnabled:boolean|null|undefined;
  availablePageIds:readonly string[];
  onNavigate:(id:HelperPageId)=>void;
};
export function memberHelperKnowledge(availablePageIds:readonly string[],guildLaunchpadEnabled:boolean|null|undefined){
  return buildHelperKnowledge({metadata:PORTAL_FEATURE_METADATA,pageHelp,availablePageIds,guildLaunchpadEnabled});
}
export function memberHelperBlocked(state:ShellState){
  return !Number.isSafeInteger(state.sessionGeneration)||state.sessionGeneration<0||state.mobileOpen||state.messagesOpen||state.pending||state.accessExpired;
}
// Shell surfaces only, never arbitrary expanded business accordions or input contents.
const BLOCKING_SURFACES='dialog[open],[aria-modal="true"],[role="dialog"],.modal-overlay,.modal-backdrop,.world-chat-drawer,.world-chat-overlay,.game-console-expanded,.floating-message-panel,.page-tools-menu[open],.nav-more[open],.settings-menu-list,.notification-bell-popover';
export function hasForeignHelperBlocker(root:HTMLElement):boolean{
  return Array.from(root.ownerDocument.querySelectorAll<HTMLElement>(BLOCKING_SURFACES)).some(node=>{
    if(root.contains(node)||node.closest('[hidden],[aria-hidden="true"]')||!node.getClientRects().length)return false;
    const style=node.ownerDocument.defaultView?.getComputedStyle(node);
    return Boolean(style&&style.display!=='none'&&style.visibility!=='hidden');
  });
}
/** Member-only shell adapter. It neither owns navigation nor changes character gates. */
export function PlatformHelperHost(props:PlatformHelperHostProps){
  const root=useRef<HTMLDivElement>(null);
  const [surfaceBlocked,setSurfaceBlocked]=useState(false);
  useLayoutEffect(()=>{
    const element=root.current;if(!element)return;
    const doc=element.ownerDocument,view=doc.defaultView;if(!view)return;
    const inspect=()=>setSurfaceBlocked(hasForeignHelperBlocker(element));
    inspect();
    const observer=new view.MutationObserver(inspect);
    observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','hidden','aria-hidden','aria-modal','role','class','style']});
    doc.addEventListener('toggle',inspect,true);doc.addEventListener('focusin',inspect,true);view.addEventListener('resize',inspect);
    return()=>{observer.disconnect();doc.removeEventListener('toggle',inspect,true);doc.removeEventListener('focusin',inspect,true);view.removeEventListener('resize',inspect);};
  },[]);
  const snapshot=memberHelperKnowledge(props.availablePageIds,props.guildLaunchpadEnabled);
  const blocked=memberHelperBlocked(props)||surfaceBlocked;
  return <div ref={root} className="platform-helper-host">
    <PlatformHelper key={JSON.stringify([props.sessionGeneration,props.routeIdentity])} pageId={props.pageId}
      accountScope={String(props.sessionGeneration)} {...snapshot} blocked={blocked}
      onNavigate={id=>{
        if(blocked||!snapshot.availablePageIds.includes(id)||(root.current&&hasForeignHelperBlocker(root.current)))return;
        props.onNavigate(id);
      }}/>
  </div>;
}
