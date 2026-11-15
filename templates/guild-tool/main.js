import {createGuildTool} from './bridge.js';
export const PLATFORM_ORIGINS=Object.freeze([
 'https://freetwai.com',
 'https://staging.freetwai.com',
]);
export const tool=createGuildTool({platformOrigins:PLATFORM_ORIGINS}),status=document.querySelector('#status'),out=document.querySelector('output'),note=document.querySelector('#note');
async function run(operation,payload){try{const result=await tool.request(operation,payload);console.debug('工具回應',operation,result);const messages={'device-state.put':'已存檔','device-state.get':'已讀取','share.compose':result?.status==='published'?'已分享':'尚未分享','ui.open':'已開啟','resize':'已調整','navigate':'已開啟'};out.textContent=messages[operation]??'';return result;}catch(e){console.error('工具操作失敗',operation,e);out.textContent='暫時無法完成';}}
try{await tool.ready();const context=await run('context.get',{});status.textContent=!context?'未連線':context.preview?'工具預覽':`${context.guild_name||'公會'} · ${context.signed_in?'已登入':'未登入'}`;if(context&&!context.preview)document.querySelector('#controls').hidden=false;}catch(e){status.textContent='未連線';}
document.querySelector('#put').onclick=()=>run('device-state.put',{key:'note',value:note.value});
document.querySelector('#get').onclick=async()=>{const result=await run('device-state.get',{key:'note'});if(result?.value!=null)note.value=result.value;};
document.querySelector('#share').onclick=()=>run('share.compose',{text:note.value});
document.querySelector('#upload').onclick=()=>run('ui.open',{panel:'game-upload'});
document.querySelector('#resize').onclick=()=>run('resize',{height:700});
document.querySelector('#navigate').onclick=()=>run('navigate',{action:'tools'});
