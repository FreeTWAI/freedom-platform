import {createGuildTool} from './bridge.js';
export const tool=createGuildTool(),status=document.querySelector('#status'),out=document.querySelector('output'),note=document.querySelector('#note');
async function run(operation,payload){try{const result=await tool.request(operation,payload);out.textContent=JSON.stringify(result);return result;}catch(e){out.textContent=e.message;}}
try{await tool.ready();const context=await run('context.get',{});status.textContent=context?.preview?'工具預覽':`公會：${context.guild}`;}catch(e){status.textContent=e.message;}
document.querySelector('#put').onclick=()=>run('device-state.put',{key:'note',value:note.value});
document.querySelector('#get').onclick=async()=>{const result=await run('device-state.get',{key:'note'});if(result?.value!==null)note.value=result.value;};
document.querySelector('#share').onclick=()=>run('share.compose',{text:note.value});
document.querySelector('#upload').onclick=()=>run('ui.open',{panel:'game-upload'});
document.querySelector('#resize').onclick=()=>run('resize',{height:700});
document.querySelector('#navigate').onclick=()=>run('navigate',{action:'tools'});
