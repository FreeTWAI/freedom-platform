/** Isolated synthetic host only. This is not App integration or member data. */
import {StrictMode,createElement as h,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HELPER_PAGE_IDS,type HelperKnowledge,type HelperPageId} from '../../apps/portal-web/src/modules/platform-helper/model';
import '../../apps/portal-web/src/styles.css';
import '../../apps/portal-web/src/rpg-theme.css';
import '../../apps/portal-web/src/LayoutDesign.css';
import '../../apps/portal-web/src/GameConsole.css';
import '../../apps/portal-web/src/light-theme.css';
import '../../apps/portal-web/src/versefolk-theme.css';
import '../../apps/portal-web/src/module-light-theme.css';
import '../../apps/portal-web/src/GameConsoleThemes.css';
import '../../apps/portal-web/src/CalmExperience.css';
import '../../apps/portal-web/src/dragon-theme.css';
import '../../apps/portal-web/src/WorkspaceCompanionLayout.css';
import '../../apps/portal-web/src/modules/SocialPostOptimizer.css';
import '../../apps/portal-web/src/SocialLayout.css';
import {PlatformHelper} from '../../apps/portal-web/src/modules/platform-helper/PlatformHelper';

const knowledge:HelperKnowledge={
  skills:{id:'skills',title:'技能書架',summary:'合成測試：閱讀公開技能介紹。',steps:['合成測試：預覽技能書。'],note:'合成測試：預覽不代表已解鎖。'},
  guilds:{id:'guilds',title:'職業公會',summary:'合成測試：查看公會介紹。',steps:['合成測試：選擇感興趣的公會。']},
  stores:{id:'stores',title:'我的商店',summary:'合成測試：查看商店設定。',steps:['合成測試：保留原頁草稿。']},
  squads:{id:'squads',title:'小隊集合',summary:'合成測試：查看合作入口。',steps:['合成測試：閱讀小隊介紹。']},
};
export type HelperHostUpdate={accountScope?:string;pageId?:string;blocked?:boolean;allow?:boolean;available?:HelperPageId[]};
function Fixture(){
  const [host,setHost]=useState({accountScope:'synthetic-a',pageId:'todos',blocked:false,allow:false,available:[...HELPER_PAGE_IDS]});
  const [calls,setCalls]=useState(0),[escapedSubmits,setEscapedSubmits]=useState(0),[draft,setDraft]=useState('尚未儲存的合成草稿');
  useEffect(()=>{
    const update=(event:Event)=>setHost(previous=>({...previous,...(event as CustomEvent<HelperHostUpdate>).detail}));
    window.addEventListener('platform-helper-test-host',update);
    return ()=>window.removeEventListener('platform-helper-test-host',update);
  },[]);
  return h('main',{style:{padding:'12px'},onSubmit:()=>setEscapedSubmits(value=>value+1)},
    h('h1',null,'隔離元件合成測試（不是正式平台）'),
    h('p',{'data-testid':'host-page'},host.pageId),
    h('p',{'data-testid':'host-calls'},String(calls)),
    h('p',{'data-testid':'escaped-submits'},String(escapedSubmits)),
    h('label',null,'測試允許導航',h('input',{type:'checkbox',checked:host.allow,onChange:(event:React.ChangeEvent<HTMLInputElement>)=>setHost({...host,allow:event.target.checked})})),
    h('button',{type:'button',onClick:()=>setHost({...host,accountScope:host.accountScope==='synthetic-a'?'synthetic-b':'synthetic-a'})},'切換合成帳號'),
    h('form',{onSubmit:event=>{event.preventDefault();setEscapedSubmits(value=>value+1);}},h('label',null,'合成業務草稿',h('textarea',{value:draft,onChange:(event:React.ChangeEvent<HTMLTextAreaElement>)=>setDraft(event.target.value)}))),
    // Deliberately outside the business form; no nested forms in the integration contract.
    h(PlatformHelper,{...host,availablePageIds:host.available,knowledge,onNavigate:id=>{setCalls(value=>value+1);if(host.allow)setHost(previous=>({...previous,pageId:id}));}}),
  );
}
createRoot(document.getElementById('root')!).render(h(StrictMode,null,h(Fixture)));
