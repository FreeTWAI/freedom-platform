import {useLayoutEffect,useRef,useState} from 'react';
import {PORTAL_FEATURE_METADATA} from './features/metadata';
import {pageHelp} from './page-help';
import {PlatformHelper,type HelperDialogController,type HelperDialogChange} from './modules/platform-helper/PlatformHelper';
import type {GuideHelperAction,GuideHelperCloseReason} from './modules/newcomer-guides/GuideHost';
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
  onHelperReady?:(action:GuideHelperAction|null)=>void;
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
/** One committed host lease, shared by toolbar and character shortcuts. */
export function createMemberHelperBridge({controller,isCurrent,isBlocked,publish}:{controller:HelperDialogController;isCurrent:()=>boolean;isBlocked:()=>boolean;publish:(action:GuideHelperAction|null)=>void}){
  let active=true;
  let external:{origin:HTMLElement;onClose:(reason:GuideHelperCloseReason)=>void}|null=null;
  const notify=(reason:GuideHelperCloseReason)=>{const previous=external;external=null;try{previous?.onClose(reason);}catch{/* Presentation callbacks cannot interrupt cleanup. */}};
  const requestOpen:GuideHelperAction['requestOpen']=(origin,onClose)=>{
    if(!active||!isCurrent()||isBlocked()||controller.open)return false;
    external={origin,onClose};
    try{if(controller.requestOpen(origin))return true;}catch{/* Refuse without surfacing exception details. */}
    external=null;return false;
  };
  const update=()=>{if(active&&isCurrent())publish({dialogId:controller.dialogId,open:controller.open,requestOpen});};
  update();
  return {
    change(change:HelperDialogChange){
      if(!active||!isCurrent()||change.dialogId!==controller.dialogId)return;
      if(!change.open&&external?.origin===change.origin)notify(change.reason);
      update();
    },
    dispose(){if(!active)return;active=false;notify('teardown');publish(null);}
  };
}
/** Member-only shell adapter. It neither owns navigation nor changes character gates. */
export function PlatformHelperHost(props:PlatformHelperHostProps){
  const root=useRef<HTMLDivElement>(null);
  const [surfaceBlocked,setSurfaceBlocked]=useState(false);
  const [controller,setController]=useState<HelperDialogController|null>(null);
  const bridge=useRef<ReturnType<typeof createMemberHelperBridge>|null>(null);
  const latest=useRef(props);latest.current=props;
  const scope=JSON.stringify([props.sessionGeneration,props.routeIdentity]);
  const blocked=memberHelperBlocked(props)||surfaceBlocked;
  useLayoutEffect(()=>{
    const publish=props.onHelperReady;
    if(!controller||blocked||!publish){publish?.(null);return;}
    const current=createMemberHelperBridge({controller,publish,
      isCurrent:()=>JSON.stringify([latest.current.sessionGeneration,latest.current.routeIdentity])===scope,
      isBlocked:()=>memberHelperBlocked(latest.current)||!root.current||hasForeignHelperBlocker(root.current)});
    bridge.current=current;
    return()=>{if(bridge.current===current)bridge.current=null;current.dispose();};
  },[controller,blocked,scope,props.onHelperReady]);
  useLayoutEffect(()=>{
    const element=root.current;if(!element)return;
    const doc=element.ownerDocument,view=doc.defaultView;if(!view)return;
    let active=true,frame:number|null=null;
    const inspect=()=>{
      if(!active)return;
      if(frame!==null){view.cancelAnimationFrame(frame);frame=null;}
      setSurfaceBlocked(hasForeignHelperBlocker(element));
    };
    // Keep every mutation trigger: ancestor and sibling CSS can change a
    // blocker's visibility. Only combine deliveries within the same frame.
    const schedule=()=>{if(active&&frame===null)frame=view.requestAnimationFrame(()=>{frame=null;inspect();});};
    inspect();
    const observer=new view.MutationObserver(schedule);
    observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','hidden','aria-hidden','aria-modal','role','class','style']});
    doc.addEventListener('toggle',inspect,true);doc.addEventListener('focusin',inspect,true);view.addEventListener('resize',inspect);
    return()=>{active=false;if(frame!==null)view.cancelAnimationFrame(frame);frame=null;observer.disconnect();doc.removeEventListener('toggle',inspect,true);doc.removeEventListener('focusin',inspect,true);view.removeEventListener('resize',inspect);};
  },[scope]);
  const snapshot=memberHelperKnowledge(props.availablePageIds,props.guildLaunchpadEnabled);
  return <div ref={root} className="platform-helper-host" onClickCapture={event=>{
    // The toolbar bypasses the character bridge. Recheck its admission now,
    // including nonmodal shell surfaces that appeared before the next frame.
    // Do not intercept the open dialog's controls or any other host's clicks.
    const launcher=event.currentTarget.querySelector<HTMLButtonElement>(':scope > .platform-helper > button[aria-haspopup="dialog"][aria-expanded="false"]');
    if(!launcher||!event.currentTarget.contains(launcher)||!launcher.contains(event.target as Node))return;
    const foreignBlocked=hasForeignHelperBlocker(event.currentTarget);
    if(memberHelperBlocked(latest.current)||foreignBlocked){
      event.preventDefault();event.stopPropagation();setSurfaceBlocked(foreignBlocked);
    }
  }}>
    <PlatformHelper key={JSON.stringify([props.sessionGeneration,props.routeIdentity])} pageId={props.pageId}
      accountScope={String(props.sessionGeneration)} {...snapshot} blocked={blocked}
      controllerRef={setController} onDialogChange={change=>bridge.current?.change(change)}
      onNavigate={id=>{
        if(blocked||!snapshot.availablePageIds.includes(id)||(root.current&&hasForeignHelperBlocker(root.current)))return;
        props.onNavigate(id);
      }}/>
  </div>;
}
