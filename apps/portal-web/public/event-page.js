(async()=>{
 'use strict';
 if(/^#participation=[A-Za-z0-9_-]{43}$/.test(location.hash)){const url=new URL(location.href);url.searchParams.set('app','1');location.replace(url.href);return;}
 const data=JSON.parse(document.getElementById('event-data').textContent),status=document.getElementById('event-status');
 const refs=new URLSearchParams(location.search).getAll('ref'),ref=refs.length===1&&/^[A-Za-z0-9_-]{16,32}$/.test(refs[0])?refs[0]:null;
 for(const img of document.querySelectorAll('.cover')){img.addEventListener('error',()=>{img.hidden=true;});if(img.complete&&!img.naturalWidth)img.hidden=true;}
 let session=null,pending=null,guestAttempt=null;
 async function request(path,body,extra={}){const response=await fetch('/api/v1'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(session?{'X-CSRF-Token':session.csrf_token}:{}),...extra},body:JSON.stringify(body)});const result=await response.json();if(!response.ok){const error=Error(result.detail||result.message||'操作未完成，請重試');error.status=response.status;throw error;}return result;}
 if(data.member){try{const r=await fetch('/api/v1/session',{cache:'no-store'});if(r.ok)session=await r.json();}catch{} }
 async function act(button,run){if(button.disabled)return;button.disabled=true;status.textContent='處理中…';try{await run();}catch(e){status.textContent=e.message;}finally{button.disabled=false;}}
 document.getElementById('event-register')?.addEventListener('click',e=>void act(e.currentTarget,async()=>{
  if(!session)throw Error('請重新登入');pending??=crypto.randomUUID();
  await request('/events/'+data.id+'/'+(data.waitlist?'waitlist':'rsvp'),data.waitlist?{action:'join',referral_code:ref}:{going:true,referral_code:ref},{'Idempotency-Key':pending,...(data.waitlist?{'If-Match':JSON.stringify(String(data.version))}:{})});location.reload();
 }));
 document.getElementById('event-guest')?.addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');void act(button,async()=>{
  const input=new FormData(form);guestAttempt??={body:{name:input.get('name'),email:input.get('email'),referral_code:ref},unknown:false};
  for(const field of form.querySelectorAll('input'))field.readOnly=true;
  try{
   const result=await request('/public/events/'+data.id+'/'+(data.waitlist?'participation-request':'register'),guestAttempt.body);
   if(result?.provider_status!=='provider_accepted'||(data.waitlist?result.requested!==true:result.registered!==true))throw Error('invalid_registration_receipt');
   guestAttempt=null;status.textContent=data.waitlist?'管理信已交給郵件服務，請至信箱開啟後加入候補。尚未加入候補。':'報名已確認；Email 服務已接受參與資訊，不代表郵件已送達。請檢查收件匣。';form.hidden=true;
  }catch(error){
   guestAttempt.unknown ||= !error.status||error.status>=500||error.status===401;
   if(guestAttempt.unknown){button.textContent='重試原報名';throw Error('尚未確認這次結果，原資料仍保留。請先檢查原信箱；重試可能再次寄出相同郵件。');}
   guestAttempt=null;for(const field of form.querySelectorAll('input'))field.readOnly=false;throw error;
  }
 });});
 document.getElementById('event-interest')?.addEventListener('click',e=>{e.preventDefault();void act(e.currentTarget,async()=>{await request((data.member?'/events/':'/public/events/')+data.id+'/interest',data.member?{}:{interest_id:crypto.randomUUID()},{'Idempotency-Key':crypto.randomUUID()});location.assign(data.external_url);});});
 document.getElementById('event-claim')?.addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;void act(form.querySelector('button'),async()=>{if(!session)throw Error('請重新登入');const fields=new FormData(form);await request('/events/'+data.id+'/claim',{statement:fields.get('statement'),evidence_url:fields.get('evidence_url'),declared:fields.get('declared')==='on'},{'Idempotency-Key':crypto.randomUUID()});status.textContent='認領已送出，等待來源核實';form.hidden=true;});});
 document.getElementById('event-share')?.addEventListener('click',e=>void act(e.currentTarget,async()=>{
  if(!session)throw Error('請重新登入');const result=await request('/events/'+data.id+'/share',{}, {'Idempotency-Key':crypto.randomUUID()});const box=document.getElementById('event-share-result');box.replaceChildren();const input=document.createElement('input');input.readOnly=true;input.setAttribute('aria-label','我的分享連結');input.value=new URL(result.path,location.origin).href;box.append(input);const counts=document.createElement('p');counts.textContent=result.clicks+' 個有效點閱日 · '+result.registrations+' 人報名';box.append(counts);input.select();status.textContent='分享連結已建立';
 }));
})();
