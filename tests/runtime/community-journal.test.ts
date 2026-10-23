import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {createPool} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {journalMedia} from '../../modules/community-journal/media.js';
import {snapshotSchema} from '../../modules/community-journal/payload.js';
const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl)throw new Error('TEST_DATABASE_URL required: use an isolated test database.');
const schema=`fp_journal_${process.pid}_${Date.now()}`,admin=createPool(databaseUrl),pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`,max:12});
const origin='http://127.0.0.1:4310',app=createApp(pool,origin);
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);});
type Session={cookie:string;csrf:string;user:{user_id:string;community_id:string}};
async function api(path:string,session?:Session,body?:unknown,version?:string,key=randomUUID()){
 const response=await app.request(origin+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key,...(version?{'If-Match':`"${version}"`}:{})})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json() as any,response};
}
async function login(index=0):Promise<Session>{const r=await api('/auth/login',undefined,{email:DEMO_USERS[index].email,password:DEMO_PASSWORD});assert.equal(r.status,200);return {cookie:r.response.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrf_token,user:{...r.data.user,community_id:(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[r.data.user.user_id])).rows[0].community_id}};}
async function editor(){const s=await login();await pool.query('INSERT INTO community_journal_publisher(community_id,owner_ref) VALUES($1,$2)',[s.user.community_id,s.user.user_id]);return s;}
async function key(s:Session){const r=await api('/me/community-journal/keys',s,{label:'test'});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;}
function payload(){const person={slug:'demo',display_name:'合成測試人物',intro:'合成資料',kind:'person',color:'#abcdef',avatar:{url:'/media/public/'+[...journalMedia][0],alt:'合成資料',width:null,height:null,display_fit:'contain',object_position:'50% 50%'},role:'測試',category:'測試',tags:[]};return {schema_version:1,source_revision:'a'.repeat(64),people:[person],journals:[{date:'2026-10-22',title:'合成測試日誌',excerpt:'合成內容，不是真實群組記錄',version:1,coverage:{is_partial:true},blocks:[{type:'paragraph',text:'<script>not executable</script>'}],development_items:[],decisions:[],people:[person],hero:null}]};}
async function agent(token:string,body:unknown=payload(),idem=randomUUID(),extra:Record<string,string>={}){const raw=typeof body==='string'?body:JSON.stringify(body);const r=await app.request(origin+'/agent-api/v1/journal-submissions',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':idem,...extra},body:raw});return {status:r.status,data:await r.json() as any,raw};}
async function receipt(token:string,idem:string){const r=await app.request(origin+'/agent-api/v1/journal-submissions/receipts/'+idem,{headers:{Authorization:'Bearer '+token}});return {status:r.status,data:await r.json() as any};}

test('only the explicitly assigned member may mint a journal key; sessions and CSRF remain required',async()=>{const s=await login();assert.equal((await api('/me/community-journal/keys',s,{label:'test'})).status,403);assert.equal((await api('/me/community-journal')).status,401);await pool.query('INSERT INTO community_journal_publisher(community_id,owner_ref) VALUES($1,$2)',[s.user.community_id,s.user.user_id]);assert.equal((await api('/me/community-journal/keys',{...s,csrf:'wrong'},{label:'test'})).status,403);});
test('key is shown once and neither stored nor replayed in command receipts',async()=>{const s=await editor(),idem=randomUUID();const one=await api('/me/community-journal/keys',s,{label:'test'},undefined,idem),again=await api('/me/community-journal/keys',s,{label:'test'},undefined,idem);assert.match(one.data.token,/^fjp_/);assert.equal(again.data.token,null);for(const table of ['community_journal_keys','command_receipts','transition_journal']){const rows=await pool.query(`SELECT row_to_json(t) AS row FROM ${table} t`);assert.equal(JSON.stringify(rows.rows).includes(one.data.token),false);}});
test('agent submission stays private, uses exact HTTP byte digest and safely retries',async()=>{const s=await editor(),k=await key(s),idem=randomUUID(),raw=' '+JSON.stringify(payload())+'\n';const one=await agent(k.token,raw,idem),again=await agent(k.token,raw,idem);assert.equal(one.status,201,JSON.stringify(one.data));assert.equal(one.data.payload_sha256,createHash('sha256').update(raw).digest('hex'));assert.equal(again.data.submission_id,one.data.submission_id);assert.deepEqual((await api('/public/journal')).data.data,{people:[],journals:[]});const got=await receipt(k.token,idem);assert.equal(got.status,200);assert.equal(got.data.submission_id,one.data.submission_id);assert.equal('payload' in got.data,false);assert.equal((await agent(k.token,JSON.stringify(payload()),idem)).status,409);});
test('same key concurrent requests create one immutable draft',async()=>{const s=await editor(),k=await key(s),idem=randomUUID();const replies=await Promise.all([agent(k.token,payload(),idem),agent(k.token,payload(),idem)]);assert.equal(replies[0].status,201);assert.equal(replies[1].status,201);assert.equal(replies[0].data.submission_id,replies[1].data.submission_id);});
test('different keys cannot read each others receipts',async()=>{const s=await editor(),a=await key(s),b=await key(s),idem=randomUUID();await agent(a.token,payload(),idem);assert.equal((await receipt(b.token,idem)).status,404);});
test('revoked and expired keys cannot submit or replay receipts',async()=>{const s=await editor(),a=await key(s),idem=randomUUID();await agent(a.token,payload(),idem);await api('/me/community-journal/keys/'+a.key.key_id+'/revoke',s,{});assert.equal((await agent(a.token,payload(),idem)).status,401);assert.equal((await receipt(a.token,idem)).status,401);const b=await key(s);await pool.query('UPDATE community_journal_keys SET expires_at=now()-interval \'1 second\' WHERE key_id=$1',[b.key.key_id]);assert.equal((await agent(b.token)).status,401);});
test('publisher reassignment and disabled member invalidate existing agent authority',async()=>{const s=await editor(),k=await key(s),other=await login(1);await pool.query('UPDATE community_journal_publisher SET owner_ref=$1',[other.user.user_id]);assert.equal((await agent(k.token)).status,403);await pool.query('UPDATE community_journal_publisher SET owner_ref=$1',[s.user.user_id]);await pool.query('UPDATE users SET active=false WHERE user_id=$1',[s.user.user_id]);assert.equal((await agent(k.token)).status,401);});
test('publication requires current owner, exact digest, version and explicit consent; withdraw removes public data',async()=>{const s=await editor(),k=await key(s),other=await login(1),draft=await agent(k.token);assert.equal(draft.status,201);const path='/me/community-journal/submissions/'+draft.data.submission_id+'/publish',body={consent_to_publish:true,payload_sha256:draft.data.payload_sha256};assert.equal((await api(path,other,body,'1')).status,403);assert.equal((await api(path,s,body)).status,428);assert.equal((await api(path,s,{...body,payload_sha256:'b'.repeat(64)},'1')).status,412);assert.equal((await api(path,s,{...body,consent_to_publish:false},'1')).status,422);const published=await api(path,s,body,'1');assert.equal(published.status,200,JSON.stringify(published.data));assert.equal((await api('/public/journal')).data.data.journals[0].title,payload().journals[0].title);const withdrawn=await api('/me/community-journal/withdraw',s,{},published.data.aggregate_version);assert.equal(withdrawn.status,200);assert.equal((await api('/public/journal')).data.data.journals.length,0);});
test('agent cookies or skill keys cannot authorize publication or journal submission',async()=>{const s=await editor();assert.equal((await agent('fpk_'+'a'.repeat(43))).status,401);assert.equal((await agent('bad',payload(),randomUUID(),{Cookie:s.cookie})).status,401);const k=await key(s);assert.equal((await agent(k.token,payload(),randomUUID(),{Origin:'https://foreign.invalid'})).status,403);});
test('strict schema rejects private fields, unknown images, duplicate dates and inconsistent people',()=>{const original=payload();assert.equal(snapshotSchema.safeParse(original).success,true);assert.equal(snapshotSchema.safeParse({...original,authorization:'private'}).success,false);const bad=payload();bad.people[0].avatar.url='/media/private/'+'a'.repeat(64)+'.png';assert.equal(snapshotSchema.safeParse(bad).success,false);const duplicate=payload();duplicate.journals.push(duplicate.journals[0]);assert.equal(snapshotSchema.safeParse(duplicate).success,false);});
test('body bounds and malformed JSON are rejected before storage',async()=>{const s=await editor(),k=await key(s);assert.equal((await agent(k.token,'{broken')).status,400);assert.equal((await agent(k.token,' '.repeat(2*1024*1024+1))).status,413);assert.equal((await agent(k.token,payload(),randomUUID(),{'Content-Type':'text/plain'})).status,415);assert.equal((await pool.query('SELECT count(*) FROM community_journal_submissions')).rows[0].count,'0');});
test('journal deep links use a native same-origin page without an iframe or external host',async()=>{for(const path of ['/journal','/journal/entries/2026-10-22','/journal/people/demo','/journal/manage']){const r=await app.request(origin+path);assert.equal(r.status,200);const html=await r.text();assert.match(html,/\/assets\/journal.js/);assert.equal(html.includes('<iframe'),false);assert.equal(html.includes('freetwai.evitina.tw'),false);}});
test('null public introductions remain null and invalid Unicode is rejected',()=>{const p=payload() as any;p.people[0].intro=null;p.journals[0].people[0].intro=null;assert.equal(snapshotSchema.parse(p).people[0].intro,null);p.journals[0].excerpt='\ud800';assert.equal(snapshotSchema.safeParse(p).success,false);});
test('a new snapshot cannot change public content before approval and obsolete drafts can be discarded',async()=>{const s=await editor(),k=await key(s),first=await agent(k.token);await api('/me/community-journal/submissions/'+first.data.submission_id+'/publish',s,{consent_to_publish:true,payload_sha256:first.data.payload_sha256},'1');const next=payload();next.journals[0].title='尚未核准的新版';const draft=await agent(k.token,next);assert.equal((await api('/public/journal')).data.data.journals[0].title,payload().journals[0].title);assert.equal((await api('/me/community-journal/submissions/'+draft.data.submission_id+'/discard',s,{})).status,200);assert.equal((await api('/me/community-journal/submissions/'+draft.data.submission_id+'/publish',s,{consent_to_publish:true,payload_sha256:draft.data.payload_sha256},'2')).status,409);});

// The source relationship is publisher-supplied data, never inferred from a name.
import {journalActivity} from '../../modules/community-journal/activity.js';
import {journalView,sourceMessagesView} from '../../apps/portal-web/src/journal/journal-api.js';
import {githubParts,relatedRepositories} from '../../apps/portal-web/src/journal/github-repos.js';
import {linkParts} from '../../apps/portal-web/src/journal/link-parts.js';
import {activityView,paginateMessages} from '../../apps/portal-web/src/journal/activity-data.js';
function withSources(day='2026-10-24'){
 const p=payload() as any;p.journals[0].date=day;
 const source={time:day+'T12:00:00+08:00',text:'合成討論 https://github.com/example/demo.git?tracking=fixture#readme',sender_name:'合成測試人物',sender_avatar:{url:p.people[0].avatar.url,display_fit:'contain',object_position:'50% 50%'},source_key:'b'.repeat(64),person_slug:'demo'};
 p.journals[0].blocks=[{type:'heading',text:'合成話題',source_messages:[source]},{type:'paragraph',text:'查閱 https://example.org/reference ，再共同確認。'}];
 p.journals[0].reading_note={conclusion:'合成結論',priority_todo:'核對來源',discussion_question:''};
 return p;
}
test('new source and note fields round trip, old snapshots remain valid and private source fields fail closed',()=>{
 const p=withSources();assert.deepEqual(snapshotSchema.parse(p),p);assert.equal(snapshotSchema.safeParse(payload()).success,true);
 for(const field of ['source_refs','actor_subject','line_uid']){const bad=withSources();bad.journals[0].blocks[0].source_messages[0][field]='private';assert.equal(snapshotSchema.safeParse(bad).success,false);}
 const bad=withSources();bad.journals[0].blocks[1].source_messages=[];assert.equal(snapshotSchema.safeParse(bad).success,false);
});
test('source references require known identity and opaque stable keys, reject conflicts and invalid dates/media',()=>{
 for(const change of [(m:any)=>delete m.source_key,(m:any)=>m.source_key='line-123456',(m:any)=>m.person_slug='unknown',(m:any)=>m.time='2026-02-30T12:00:00+08:00',(m:any)=>m.time='2026-10-23T12:00:00+08:00',(m:any)=>m.sender_avatar.url='https://foreign.invalid/track.png',(m:any)=>delete m.sender_name]){
  const bad=withSources();change(bad.journals[0].blocks[0].source_messages[0]);assert.equal(snapshotSchema.safeParse(bad).success,false);
 }
 const p=withSources(),b=p.journals[0].blocks[0];p.journals[0].blocks.push({...b,text:'另一章',source_messages:[{...b.source_messages[0],text:'同key不同內容'}]});assert.equal(snapshotSchema.safeParse(p).success,false);
});
test('published activity deduplicates stable sources, excludes AI and never matches display names',()=>{
 const p=withSources(),ai={...p.people[0],slug:'assistant',kind:'assistant'};p.people.push(ai);const b=p.journals[0].blocks[0],m=b.source_messages[0];
 b.source_messages.push({...m,source_key:'c'.repeat(64),person_slug:'assistant'},{time:m.time,text:'相同名字仍不猜身分',sender_name:m.sender_name});p.journals[0].blocks.push({...b,text:'同一原話重複引用'});
 const result=journalActivity(snapshotSchema.parse(p),'week',new Date('2026-10-24T04:00:00Z'));assert.equal(result.messages.length,1);assert.deepEqual(result.people,[{slug:'demo',count:1}]);assert.equal(result.messages[0].chapter_id,'section-0');assert.equal(result.unattributed_count,2);
 assert.equal(activityView(result).messages[0].person,'demo');const broken={...result,people:[{slug:'demo',count:9}]};assert.throws(()=>activityView(broken),/invalid_data/);
});
test('activity uses Taipei calendar days and only the requested week or month, including zero-count humans',()=>{
 const p=withSources(),base=p.journals[0];p.journals=[];
 for(const [i,day] of ['2026-09-24','2026-09-25','2026-10-17','2026-10-18','2026-10-24','2026-10-25'].entries()){
  const j=structuredClone(base);j.date=day;j.blocks[0].source_messages[0].time=day+'T01:00:00+08:00';j.blocks[0].source_messages[0].source_key=String(i).repeat(64);p.journals.push(j);
 }
 const parsed=snapshotSchema.parse(p),now=new Date('2026-10-23T16:30:00Z');
 const week=journalActivity(parsed,'week',now),month=journalActivity(parsed,'month',now);
 assert.deepEqual(week.range,{start:'2026-10-18',end:'2026-10-24',time_zone:'Asia/Taipei'});assert.equal(week.messages.length,2);assert.equal(month.messages.length,4);
 assert.equal(journalActivity(parsed,'week',new Date('2027-01-01T00:00:00Z')).people[0].count,0);
});
test('source rendering keeps safe same-origin avatars and optional notes, rejects invalid dates and does not invent sources',()=>{
 const p=snapshotSchema.parse(withSources()),view=journalView(p.journals[0]);assert.equal(view.chapters[0].sourceMessages.length,1);assert.match(view.chapters[0].sourceMessages[0].senderAvatar!.url,/^\/journal-assets\//);assert.equal(view.readingNote.conclusion,'合成結論');assert.equal(view.readingNote.discussionQuestion,'');
 assert.equal(journalView(snapshotSchema.parse(payload()).journals[0]).chapters[0].sourceMessages.length,0);
 assert.deepEqual(sourceMessagesView([{time:'2026-02-30T12:00:00+08:00',text:'bad'},{time:'2026-10-24T12:00:00',text:'missing zone'}]),[]);
});
test('repository links are canonical, deduplicated, clickable only for real repository-shaped URLs',()=>{
 const text='參考 https://github.com/example/demo.git?tracking=1#readme)、 https://github.com/EXAMPLE/demo';
 assert.deepEqual(relatedRepositories([{text}]),['https://github.com/example/demo']);assert.equal(githubParts(text).filter(p=>p.href).length,2);
 for(const url of ['https://github.com.evil.invalid/example/demo','https://user:secret@github.com/example/demo','https://github.com:443/example/demo','https://github.com/example','https://github.com/example/demo/issues','https://github.com/settings/profile','javascript:alert(1)'])assert.equal(githubParts(url).some(p=>p.href),false,url);
 assert.equal(linkParts('https://user:secret@example.org/path javascript:alert(1)').some(p=>p.href),false);
 assert.equal(linkParts('來源 https://example.org/reference。')[1]?.href,'https://example.org/reference');
 assert.deepEqual(paginateMessages([1,2,3,4,5,6],2),{pages:2,currentPage:2,pageMessages:[6]});
});
test('source and note fields persist through real submit/review/publish; drafts and withdrawal do not appear in activity',async()=>{
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date()),p=withSources(day),s=await editor(),k=await key(s),draft=await agent(k.token,p);
 assert.equal(draft.status,201,JSON.stringify(draft.data));assert.equal((await api('/public/journal/activity?period=week')).data.data.messages.length,0);
 const read=await api('/me/community-journal/submissions/'+draft.data.submission_id,s);assert.deepEqual(read.data.payload,p);
 const pub=await api('/me/community-journal/submissions/'+draft.data.submission_id+'/publish',s,{consent_to_publish:true,payload_sha256:draft.data.payload_sha256},'1');assert.equal(pub.status,200);
 assert.deepEqual((await api('/public/journal')).data.data,p);const active=await api('/public/journal/activity?period=week');assert.equal(active.status,200);assert.equal(active.response.headers.get('cache-control'),'no-store');assert.equal(active.data.data.messages.length,1);
 assert.equal((await api('/public/journal/activity?period=year')).status,422);assert.equal((await api('/public/journal/activity?period=week&period=month')).status,422);assert.equal((await api('/public/journal/activity?private=1')).status,422);
 await api('/me/community-journal/withdraw',s,{},pub.data.aggregate_version);assert.equal((await api('/public/journal/activity?period=month')).data.data.messages.length,0);
});

test('activity orders timestamps by instant across different UTC offsets',()=>{
 const p=withSources(),m=p.journals[0].blocks[0].source_messages[0];
 p.journals[0].blocks[0].source_messages=[{...m,time:'2026-10-24T12:00:00+08:00'},{...m,time:'2026-10-24T05:00:00Z',source_key:'c'.repeat(64)}];
 const result=journalActivity(snapshotSchema.parse(p),'week',new Date('2026-10-24T12:00:00Z'));
 assert.deepEqual(result.messages.map(m=>m.time),['2026-10-24T05:00:00Z','2026-10-24T12:00:00+08:00']);
});
