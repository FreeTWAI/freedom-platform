import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {createSkillInstallRoutes} from '../../apps/platform-api/src/routes/skill-install.js';
import {SKILL_INSTALL_LIMITS,createSkillInstallBundleLoader,gitBlobSha1,isSafeBundlePath,skillFolderName,skillInstallSource} from '../../modules/skill-install/index.js';
import {skillBookIdForFullName} from '../../modules/repo-maintainer/skill-books.js';
import {communityCatalog,type SkillBook} from '../../modules/community/catalog.js';
import {parseInstallBundle,installReceipt,buildInstallZip,copyText,installCommands,SkillInstallError} from '../../apps/portal-web/src/modules/skill-install-client.js';

const commit='a'.repeat(40);
const book=(id:string,extra:Partial<SkillBook>={}):SkillBook=>({id,title:id,repository_url:'https://github.com/FreeTWAI/freedom-skill-'+id,description:'',kind:'starter',fork_url:'',license_status:'MIT',upstream_url:'',source_commit:commit,introduction_url:null,...extra});
const encoder=new TextEncoder();
const archiveUrl=(owner:string,repo:string,sha=commit)=>`https://codeload.github.com/${owner}/${repo}/tar.gz/${sha}`;
function archive(files:Record<string,string>){
  const parts:Buffer[]=[];
  for(const [path,text] of [['', ''],...Object.entries(files)]){
    const body=Buffer.from(text),header=Buffer.alloc(512);
    header.write(`fixture/${path}`,0,100,'utf8');
    const octal=(value:number,offset:number,length:number)=>header.write(value.toString(8).padStart(length-1,'0')+'\0',offset,length,'ascii');
    octal(0o644,100,8);octal(0,108,8);octal(0,116,8);octal(body.length,124,12);octal(0,136,12);
    header.fill(32,148,156);header[156]=path?48:53;header.write('ustar\0',257,6,'ascii');
    octal(header.reduce((sum,byte)=>sum+byte,0),148,8);
    parts.push(header,body,Buffer.alloc((512-body.length%512)%512));
  }
  parts.push(Buffer.alloc(1024));return new Uint8Array(gzipSync(Buffer.concat(parts)));
}

const redirectTarget='https://redirect.example.invalid/skill';
async function fakeGitHub(files:Record<string,string>,{tamper,truncated,redirect}:{tamper?:string;truncated?:boolean;redirect?:'tree'|'SKILL.md'}={}){
  const tree=await Promise.all(Object.entries(files).map(async([path,text])=>({path,type:'blob',sha:await gitBlobSha1(encoder.encode(text)),size:encoder.encode(text).length})));
  const calls:string[]=[];
  const redirects:(RequestRedirect|undefined)[]=[];
  const fetcher=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=String(input);calls.push(url);redirects.push(init?.redirect);
    if(url.startsWith('https://api.github.com/repos/')){
      if(redirect==='tree')return new Response(null,{status:302,headers:{Location:redirectTarget}});
      return Response.json({sha:commit,truncated:truncated??false,tree:[...tree,{path:'templates',type:'tree',sha:'b'.repeat(40)}]});
    }
    if(url.startsWith('https://codeload.github.com/')){
      if(redirect==='SKILL.md')return new Response(null,{status:302,headers:{Location:redirectTarget}});
      const contents={...files};if(tamper&&tamper in contents)contents[tamper]+='x';
      return new Response(archive(contents));
    }
    const prefix=/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//.exec(url);
    const path=prefix&&decodeURIComponent(url.slice(prefix[0].length));
    if(path&&path===redirect)return new Response(null,{status:302,headers:{Location:redirectTarget}});
    if(path&&path in files)return new Response(path===tamper?files[path]+'x':files[path]);
    return new Response('missing',{status:404});
  }) as typeof fetch;
  return {fetcher,calls,redirects};
}
const skill='---\nname: freedom-demo\ndescription: demo\n---\n# Demo\n';

function hasInstallCode(code:string){return (error:unknown)=>error instanceof SkillInstallError&&error.code===code;}

test('install bundle is pinned, verified, excludes development files and is cached per commit',async()=>{
  const {fetcher,calls,redirects}=await fakeGitHub({'SKILL.md':skill,'templates/notes.md':'筆記 ✓','.github/workflows/ci.yml':'x','tests/test_a.py':'x'});
  const app=createSkillInstallRoutes(fetcher,()=>null,[book('demo')]);
  const response=await app.request('/api/v1/skills/demo/install-bundle');
  assert.equal(response.status,200);
  assert.match(response.headers.get('Cache-Control')??'',/max-age=/);
  const data=await response.json();
  assert.equal(data.format,'freedom.skill-install-bundle/v1');
  assert.equal(data.name,'freedom-demo');
  assert.equal(data.commit,commit);
  assert.deepEqual(data.files.map((file:{path:string})=>file.path),['SKILL.md','templates/notes.md']);
  assert.ok(calls.every(url=>url.includes(commit)),'every request names the exact commit');
  assert.deepEqual(redirects,['manual','manual'],'tree and archive fetches never follow redirects');
  const parsed=await parseInstallBundle(data);
  assert.equal(new TextDecoder().decode(parsed.files[1].bytes),'筆記 ✓');
  const before=calls.length;
  assert.equal((await app.request('/api/v1/skills/demo/install-bundle')).status,200);
  assert.equal(calls.length,before,'second read is served from the commit cache');
});

for(const redirect of ['tree','SKILL.md'] as const)test('install bundle rejects a non-rename redirect from '+redirect+' without following it',async()=>{
  const {fetcher,calls,redirects}=await fakeGitHub({'SKILL.md':skill},{redirect});
  const load=createSkillInstallBundleLoader(fetcher,undefined,[book('demo')]);
  const expected=redirect==='tree'?{status:503,code:'original_unavailable'}:{status:503,code:'skill_source_unreachable'};
  await assert.rejects(load('demo'),expected);
  assert.deepEqual(calls,[
    'https://api.github.com/repos/FreeTWAI/freedom-skill-demo/git/trees/'+commit+'?recursive=1',
    ...(redirect==='SKILL.md'?[archiveUrl('FreeTWAI','freedom-skill-demo')]:[]),
  ]);
  assert.equal(calls.some(url=>url===redirectTarget),false,'redirect target is never fetched');
  assert.ok(redirects.every(value=>value==='manual'));
});

test('install bundle refuses unknown, unpinned, non-skill, tampered and unsafe sources',async()=>{
  const ok=await fakeGitHub({'SKILL.md':skill});
  const books=[book('demo'),book('floating',{source_commit:null}),book('elsewhere',{repository_url:'https://gitlab.com/x/y'})];
  const app=createSkillInstallRoutes(ok.fetcher,undefined,books);
  for(const id of ['missing','floating','elsewhere']){
    const response=await app.request('/api/v1/skills/'+id+'/install-bundle');
    assert.equal(response.status,404,id);assert.equal((await response.json()).error,'skill_install_unavailable');
  }
  assert.equal(ok.calls.length,0,'unknown books never reach GitHub');
  const noSkill=await fakeGitHub({'README.md':'x'});
  assert.equal((await (await createSkillInstallRoutes(noSkill.fetcher,undefined,books).request('/api/v1/skills/demo/install-bundle')).json()).error,'not_a_skill_package');
  const tampered=await fakeGitHub({'SKILL.md':skill,'a.md':'a'},{tamper:'a.md'});
  const mismatch=await createSkillInstallRoutes(tampered.fetcher,undefined,books).request('/api/v1/skills/demo/install-bundle');
  assert.equal(mismatch.status,502);assert.equal(mismatch.headers.get('Cache-Control'),'no-store');
  const truncated=await fakeGitHub({'SKILL.md':skill},{truncated:true});
  assert.equal((await createSkillInstallRoutes(truncated.fetcher,undefined,books).request('/api/v1/skills/demo/install-bundle')).status,422);
  for(const path of ['../x','/etc/passwd','a//b','a\\b','./a'])assert.equal(isSafeBundlePath(path),false,path);
  assert.equal(skillFolderName('---\nname: ../evil\n---',' My Repo'),'-my-repo');
});

test('only pinned GitHub catalog books are offered',()=>{
  const pinned=communityCatalog.skill_books.filter(item=>skillInstallSource(item.id));
  assert.ok(pinned.length>0);
  for(const item of pinned)assert.match(item.source_commit!,/^[0-9a-f]{40}$/);
});

test('client rejects a tampered bundle and builds a verified zip with a path-free receipt',async()=>{
  const {fetcher}=await fakeGitHub({'SKILL.md':skill,'templates/notes.md':'notes'});
  const data=await (await createSkillInstallRoutes(fetcher,undefined,[book('demo')]).request('/api/v1/skills/demo/install-bundle')).json();
  await assert.rejects(parseInstallBundle({...data,files:data.files.map((file:{path:string;content_base64:string})=>file.path==='SKILL.md'?{...file,content_base64:btoa('changed')}:file)}),/驗證失敗/);
  await assert.rejects(parseInstallBundle({...data,files:[...data.files,{path:'../escape',sha:'0'.repeat(40),content_base64:''}]}),/格式不正確/);
  await assert.rejects(parseInstallBundle({...data,repository:'FreeTWAI/x";touch /tmp/p;"'}),hasInstallCode('bundle_invalid'));
  await assert.rejects(parseInstallBundle({...data,repository:'FreeTWAI'}),hasInstallCode('bundle_invalid'));
  const bundle=await parseInstallBundle(data);

  const receipt=installReceipt(bundle,'claude-code','zip');
  assert.equal(receipt.package.commit,commit);assert.equal(receipt.manifest_digest,bundle.manifest_digest);
  assert.doesNotMatch(JSON.stringify(receipt),/\.claude|skills\/|\/home|\/Users/i,'receipt holds no local paths');

  const zip=new Uint8Array(await buildInstallZip(bundle,'codex').arrayBuffer());
  assert.deepEqual([...zip.slice(0,4)],[0x50,0x4b,0x03,0x04]);
  assert.ok(new TextDecoder().decode(zip).includes('freedom-demo/templates/notes.md'));
  const commands=installCommands(bundle,'openclaw');
  assert.ok(commands.shell.includes('/tar.gz/'+commit)&&commands.shell.includes('dest="$HOME/.openclaw/skills/freedom-demo"'));
  assert.ok(commands.powershell.includes('/zip/'+commit));
});

test('client and UI do not offer direct folder writes',async()=>{
  for(const path of ['apps/portal-web/src/modules/skill-install-client.ts','apps/portal-web/src/modules/SkillInstall.tsx']){
    const source=await readFile(path,'utf8');
    assert.doesNotMatch(source,/showDirectoryPicker|getFileHandle|createWritable/,'direct folder writes need an exclusive-create primitive; see #1110 review');
  }
});

test('copyText reports success only after a clipboard write resolves',async()=>{
  const writes:string[]=[];
  assert.equal(await copyText({writeText:async text=>{writes.push(text);}},'install command'),true);
  assert.deepEqual(writes,['install command']);
  assert.equal(await copyText({writeText:async()=>{throw new Error('clipboard denied');}},'install command'),false);
  assert.equal(await copyText(undefined,'install command'),false);
});

test('PowerShell commands stop on errors, stage pinned archives and remove only their temp directory',()=>{
  for(const target of ['claude-code','codex','openclaw'] as const){
    const {powershell}=installCommands({name:'freedom-demo',repository:'FreeTWAI/freedom-skill-demo',commit},target);
    assert.ok(powershell.startsWith("$ErrorActionPreference='Stop';"));
    assert.ok(powershell.includes('/zip/'+commit));
    assert.ok(powershell.includes('Join-Path $env:TEMP ([guid]::NewGuid().ToString())'));
    assert.ok(powershell.includes('Expand-Archive -LiteralPath $z -DestinationPath $t'));
    assert.ok(powershell.includes('Test-Path -LiteralPath "$s\\SKILL.md" -PathType Leaf'));
    assert.ok(powershell.includes('New-Item -ItemType Directory -Force -Path $d | Out-Null'));
    const check=powershell.indexOf('if (Test-Path -LiteralPath $dest)'),move=powershell.indexOf('[System.IO.Directory]::Move($s,$dest)');
    assert.ok(check>0&&move>check);
    assert.doesNotMatch(powershell,/Copy-Item|Move-Item|New-Item[^;]*\$dest/);
    assert.match(powershell.slice(check,move),/throw "「freedom-demo」資料夾已經存在/);
    assert.deepEqual(powershell.match(/Remove-Item[^}]+/g),['Remove-Item -LiteralPath $t -Recurse -Force ']);
    assert.ok(powershell.includes('finally { Remove-Item -LiteralPath $t -Recurse -Force }'));
  }
});

for(const scenario of ['success','curl failure','destination exists','destination race','copy failure','missing SKILL.md','invalid archive'])test('shell command: '+scenario+' preserves existing files and removes staging',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'skill-install-command-'));
  try{
    const home=join(workspace,'home with spaces'),bin=join(workspace,'bin'),temp=join(workspace,'temp with spaces');
    const skills=join(home,'.openclaw','skills'),destination=join(skills,'freedom-demo'),extracted='freedom-skill-demo-'+commit;
    const source=join(workspace,'source'),archive=join(workspace,'fixture.tar.gz');
    await Promise.all([mkdir(join(source,extracted),{recursive:true}),mkdir(bin),mkdir(temp),mkdir(join(skills,'sibling'),{recursive:true})]);
    await writeFile(join(skills,'sibling','mine.md'),'sibling content');
    await writeFile(join(source,extracted,scenario==='missing SKILL.md'?'README.md':'SKILL.md'),skill);
    const tar=spawnSync('tar',['-czf',archive,'-C',source,extracted],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8'});
    assert.equal(tar.status,0,tar.stderr);
    if(scenario==='invalid archive')await writeFile(archive,'not an archive');
    if(scenario==='destination exists'){await mkdir(destination);await writeFile(join(destination,'mine.md'),'destination content');}
    await writeFile(join(bin,'curl'),'#!/bin/sh\nif [ "$SKILL_INSTALL_CURL_FAIL" = 1 ]; then exit 22; fi\n[ "$#" -eq 4 ] && [ "$1" = -fsSL ] && [ "$3" = -o ] || exit 2\ncp "$SKILL_INSTALL_FIXTURE" "$4"\n',{mode:0o700});
    if(scenario==='destination race')await writeFile(join(bin,'mkdir'),'#!/bin/sh\nif [ "$#" -eq 1 ] && [ "$1" = "$SKILL_INSTALL_DEST" ]; then /bin/mkdir "$1" || exit $?; printf \'%s\' \'their content\' > "$1/theirs.md"; fi\nexec /bin/mkdir "$@"\n',{mode:0o700});
    if(scenario==='copy failure')await writeFile(join(bin,'cp'),'#!/bin/sh\nif [ "$1" = -R ]; then printf \'%s\' \'partial content\' > "$SKILL_INSTALL_DEST/partial.md"; exit 9; fi\nexec /bin/cp "$@"\n',{mode:0o700});
    const {shell}=installCommands({name:'freedom-demo',repository:'FreeTWAI/freedom-skill-demo',commit},'openclaw');
    assert.ok(shell.includes('/tar.gz/'+commit));assert.doesNotMatch(shell,/\n/);
    assert.ok(shell.includes('mkdir "$dest" || exit 1; cp -R "$staged/." "$dest/"'));assert.doesNotMatch(shell,/\bmv\b/);
    const result=spawnSync('bash',['-c',shell],{cwd:workspace,env:{HOME:home,PATH:bin+':/usr/bin:/bin',TMPDIR:temp,SKILL_INSTALL_FIXTURE:archive,SKILL_INSTALL_DEST:destination,SKILL_INSTALL_CURL_FAIL:scenario==='curl failure'?'1':'0'},encoding:'utf8'});
    assert.equal(result.error,undefined);assert.equal(result.signal,null);
    if(scenario==='success'){
      assert.equal(result.status,0,result.stderr);assert.equal(await readFile(join(destination,'SKILL.md'),'utf8'),skill);
      assert.deepEqual(await readdir(destination),['SKILL.md'],'copy contents directly without an extra archive directory');
    }else{
      assert.notEqual(result.status,0,'failure must return a non-zero exit status');
      if(scenario==='destination exists'){
        assert.match(result.stderr,/「freedom-demo」資料夾已經存在/);
        assert.deepEqual(await readdir(destination),['mine.md']);assert.equal(await readFile(join(destination,'mine.md'),'utf8'),'destination content');
      }else if(scenario==='destination race'){
        assert.match(result.stderr,/mkdir/);
        assert.deepEqual(await readdir(destination),['theirs.md']);assert.equal(await readFile(join(destination,'theirs.md'),'utf8'),'their content');
      }else if(scenario==='copy failure'){
        assert.match(result.stderr,/可能留下部分檔案；沒有刪除任何檔案/);
        assert.deepEqual(await readdir(destination),['partial.md']);assert.equal(await readFile(join(destination,'partial.md'),'utf8'),'partial content');
      }else assert.deepEqual(await readdir(skills),['sibling']);
    }
    assert.equal(await readFile(join(skills,'sibling','mine.md'),'utf8'),'sibling content');
    assert.deepEqual(await readdir(temp),[],'staging must be removed after success and every failure');
  }finally{await rm(workspace,{recursive:true,force:true});}
});

test('install bundle reads original repo at pinned commit and returns 503 original_unavailable when original 404s',async()=>{
  const encoder=new TextEncoder();
  const body=skill;
  const sha=await gitBlobSha1(encoder.encode(body));
  const upstreamBook=book('orig',{upstream_url:'https://github.com/OriginalAuthor/cool-skill'});
  const source=skillInstallSource('orig',[upstreamBook]);
  assert.deepEqual(source,{book_id:'orig',owner:'OriginalAuthor',repo:'cool-skill',commit});

  // 1) Original serves the pinned commit directly: copy is never requested.
  const origCalls:string[]=[];
  const origFetcher=(async(input:string|URL|Request)=>{
    const url=String(input);origCalls.push(url);
    if(url==='https://api.github.com/repos/OriginalAuthor/cool-skill/git/trees/'+commit+'?recursive=1'){
      return Response.json({sha:commit,truncated:false,tree:[{path:'SKILL.md',type:'blob',sha,size:encoder.encode(body).length}]});
    }
    if(url===archiveUrl('OriginalAuthor','cool-skill')){
      return new Response(archive({'SKILL.md':body}));
    }
    return new Response('missing',{status:404});
  }) as typeof fetch;
  const origRes=await createSkillInstallRoutes(origFetcher,undefined,[upstreamBook]).request('/api/v1/skills/orig/install-bundle');
  assert.equal(origRes.status,200);
  const origBundle=await origRes.json();
  assert.equal(origBundle.format,'freedom.skill-install-bundle/v1');
  assert.equal(origBundle.repository,'OriginalAuthor/cool-skill');
  assert.equal(origBundle.commit,commit);
  assert.equal(origCalls.some(url=>url.includes('FreeTWAI/freedom-skill-orig')),false);
  const receipt=installReceipt(await parseInstallBundle(origBundle),'claude-code','zip');
  assert.equal(receipt.package.repository,'OriginalAuthor/cool-skill');
  assert.equal(receipt.package.commit,commit);

  // 2) Original returns 404 for pinned commit -> answers 503 original_unavailable without requesting copy.
  const missingCalls:string[]=[];
  const missingFetcher=(async(input:string|URL|Request)=>{
    const url=String(input);missingCalls.push(url);
    if(url==='https://api.github.com/repos/OriginalAuthor/cool-skill/git/trees/'+commit+'?recursive=1'){
      return new Response('not found',{status:404});
    }
    throw new Error('Unexpected fetch '+url);
  }) as typeof fetch;
  const missingRes=await createSkillInstallRoutes(missingFetcher,undefined,[upstreamBook]).request('/api/v1/skills/orig/install-bundle');
  assert.equal(missingRes.status,503);
  assert.deepEqual(await missingRes.json(),{error:'original_unavailable',message:'原作暫時無法取得，請稍後再試。'});
  assert.deepEqual(missingCalls,[
    'https://api.github.com/repos/OriginalAuthor/cool-skill/git/trees/'+commit+'?recursive=1',
  ]);
});

test('install bundle follows a single repository-id rename and classifies missing vs transient statuses',async()=>{
  const {createApp}=await import('../../apps/platform-api/src/app.js');
  const body=skill;
  const sha=await gitBlobSha1(encoder.encode(body));
  const upstreamBook=book('orig',{upstream_url:'https://github.com/OriginalAuthor/cool-skill'});

  // (a) Original tree 301 -> /repositories/123/... -> new name; DB not consulted.
  const aCalls:string[]=[];
  const aFetcher=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=String(input);aCalls.push(url);assert.equal(init?.redirect,'manual');
    if(url===`https://api.github.com/repos/OriginalAuthor/cool-skill/git/trees/${commit}?recursive=1`){
      return new Response(null,{status:301,headers:{Location:`https://api.github.com/repositories/123/git/trees/${commit}?recursive=1`}});
    }
    if(url==='https://api.github.com/repositories/123'){
      return Response.json({id:123,full_name:'RenamedAuthor/new-cool-skill',private:false,visibility:'public'});
    }
    if(url===`https://api.github.com/repos/RenamedAuthor/new-cool-skill/git/trees/${commit}?recursive=1`)return Response.json({sha:commit,truncated:false,tree:[{path:'SKILL.md',type:'blob',sha,size:encoder.encode(body).length}]});
    if(url===archiveUrl('RenamedAuthor','new-cool-skill'))return new Response(archive({'SKILL.md':body}));
    return new Response('unexpected',{status:404});
  }) as typeof fetch;
  const aRes=await createSkillInstallRoutes(aFetcher,undefined,[upstreamBook]).request('/api/v1/skills/orig/install-bundle');
  assert.equal(aRes.status,200);
  const aBundle=await aRes.json();
  assert.equal(aBundle.repository,'RenamedAuthor/new-cool-skill');
  assert.equal(aBundle.commit,commit);
  assert.equal(aCalls.some(url=>url.includes('FreeTWAI/freedom-skill-orig')),false);

  // Verify createApp routes install directly from catalog coordinate (never resolves DB identity hook).
  const security=communityCatalog.skill_books.find(b=>b.id==='security-scanner')!;
  const pinned=security.source_commit??security.guide!.source_commit;
  const oldName=new URL(security.upstream_url).pathname.slice(1);
  const appFetcher=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=String(input);assert.equal(init?.redirect,'manual');
    if(url===`https://api.github.com/repos/${oldName}/git/trees/${pinned}?recursive=1`){
      return new Response(null,{status:301,headers:{Location:`https://api.github.com/repositories/123/git/trees/${pinned}?recursive=1`}});
    }
    if(url==='https://api.github.com/repositories/123'){
      return Response.json({id:123,full_name:'Original/renamed',private:false,visibility:'public'});
    }
    if(url===`https://api.github.com/repos/Original/renamed/git/trees/${pinned}?recursive=1`){
      return Response.json({sha:pinned,tree:[{path:'SKILL.md',type:'blob',sha,size:encoder.encode(body).length}]});
    }
    if(url===archiveUrl('Original','renamed',pinned))return new Response(archive({'SKILL.md':body}));
    throw new Error('Unexpected GitHub request '+url);
  }) as typeof fetch;
  const noDbPool={query:async()=>{throw new Error('install must not query DB');}} as unknown as import('pg').Pool;
  const appRes=await createApp(noDbPool,'http://127.0.0.1:46465','local',{githubSocial:{fetcher:appFetcher}}).request(`/api/v1/skills/${security.id}/install-bundle`);
  assert.equal(appRes.status,200);
  assert.equal((await appRes.json()).repository,'Original/renamed');

  // (b) 301 to non-repository-id location -> 503 original_unavailable, copy never read.
  const bCalls:string[]=[];
  const bFetcher=(async(input:string|URL|Request)=>{
    const url=String(input);bCalls.push(url);
    if(url===`https://api.github.com/repos/OriginalAuthor/cool-skill/git/trees/${commit}?recursive=1`){
      return new Response(null,{status:301,headers:{Location:'https://evil.example.invalid/repositories/123/git/trees/'+commit}});
    }
    throw new Error('Unexpected fetch '+url);
  }) as typeof fetch;
  const bRes=await createSkillInstallRoutes(bFetcher,undefined,[upstreamBook]).request('/api/v1/skills/orig/install-bundle');
  assert.equal(bRes.status,503);
  assert.equal((await bRes.json()).error,'original_unavailable');
  assert.equal(bCalls.length,1);
  assert.equal(bCalls.some(url=>url.includes('evil.example.invalid')||url.includes('/repositories/123')||url.includes('FreeTWAI/freedom-skill-orig')),false);

  // (c) /repositories/123 returns wrong id, private:true, or second redirect -> 503 original_unavailable, copy never read.
  for(const scenario of ['wrong_id','private','second_redirect'] as const){
    const cCalls:string[]=[];
    const cFetcher=(async(input:string|URL|Request)=>{
      const url=String(input);cCalls.push(url);
      if(url===`https://api.github.com/repos/OriginalAuthor/cool-skill/git/trees/${commit}?recursive=1`){
        return new Response(null,{status:302,headers:{Location:`https://api.github.com/repositories/123/git/trees/${commit}?recursive=1`}});
      }
      if(url==='https://api.github.com/repositories/123'){
        return Response.json({id:scenario==='wrong_id'?999:123,full_name:'RenamedAuthor/new-cool-skill',private:scenario==='private',visibility:'public'});
      }
      if(url===`https://api.github.com/repos/RenamedAuthor/new-cool-skill/git/trees/${commit}?recursive=1`&&scenario==='second_redirect'){
        return new Response(null,{status:301,headers:{Location:`https://api.github.com/repositories/456/git/trees/${commit}?recursive=1`}});
      }
      throw new Error('Unexpected fetch '+url);
    }) as typeof fetch;
    const cRes=await createSkillInstallRoutes(cFetcher,undefined,[upstreamBook]).request('/api/v1/skills/orig/install-bundle');
    assert.equal(cRes.status,503,scenario);
    assert.equal((await cRes.json()).error,'original_unavailable',scenario);
    assert.equal(cCalls.some(url=>url.includes('FreeTWAI/freedom-skill-orig')),false,scenario);
  }

  // (d) 404 with no distinct copy -> 503 original_unavailable.
  const noCopyBook=book('nocopy');
  const dFetcher=(async()=>new Response('not found',{status:404})) as typeof fetch;
  const dRes=await createSkillInstallRoutes(dFetcher,undefined,[noCopyBook]).request('/api/v1/skills/nocopy/install-bundle');
  assert.equal(dRes.status,503);
  assert.equal((await dRes.json()).error,'original_unavailable');

  // (e) 422 from original -> 503 original_unavailable, copy never read.
  const eCalls:string[]=[];
  const eFetcher=(async(input:string|URL|Request)=>{
    const url=String(input);eCalls.push(url);
    if(url===`https://api.github.com/repos/OriginalAuthor/cool-skill/git/trees/${commit}?recursive=1`)return new Response('unprocessable',{status:422});
    throw new Error('Unexpected fetch '+url);
  }) as typeof fetch;
  const eRes=await createSkillInstallRoutes(eFetcher,undefined,[upstreamBook]).request('/api/v1/skills/orig/install-bundle');
  assert.equal(eRes.status,503);
  assert.equal((await eRes.json()).error,'original_unavailable');
  assert.equal(eCalls.length,1);

  // (f) 503 or 403 from original -> 503 skill_source_unreachable, copy never read.
  for(const status of [503,403]){
    const fCalls:string[]=[];
    const fFetcher=(async(input:string|URL|Request)=>{
      const url=String(input);fCalls.push(url);
      if(url===`https://api.github.com/repos/OriginalAuthor/cool-skill/git/trees/${commit}?recursive=1`)return new Response('err',{status});
      throw new Error('Unexpected fetch '+url);
    }) as typeof fetch;
    const fRes=await createSkillInstallRoutes(fFetcher,undefined,[upstreamBook]).request('/api/v1/skills/orig/install-bundle');
    assert.equal(fRes.status,503,String(status));
    assert.equal((await fRes.json()).error,'skill_source_unreachable',String(status));
    assert.equal(fCalls.some(url=>url.includes('FreeTWAI/freedom-skill-orig')),false,String(status));
  }
});

test('skillBookIdForFullName resolves both original upstream_url and integration repository_url',()=>{
  const security=communityCatalog.skill_books.find(item=>item.id==='security-scanner');
  assert.ok(security?.upstream_url);
  const origFull=security.upstream_url.replace('https://github.com/','');
  const copyFull=security.repository_url.replace('https://github.com/','');
  assert.equal(skillBookIdForFullName(origFull),'security-scanner');
  assert.equal(skillBookIdForFullName(copyFull),'security-scanner');
});

test('a cold multi-file bundle stays within a small GitHub request budget',async()=>{
  const files:Record<string,string>={'SKILL.md':skill};
  for(let i=0;i<20;i++)files[`templates/${i}.txt`]=`sample ${i}`;
  const {fetcher,calls}=await fakeGitHub(files);
  const load=createSkillInstallBundleLoader(fetcher,undefined,[book('budget')]);
  const result=await load('budget');
  assert.equal(result.files.length,21);
  assert.ok(calls.length<=2,`expected at most two upstream requests, got ${calls.length}`);
});

test('install bundles reject file count, file size, and total size excess before downloading an archive',async()=>{
  const many:Record<string,string>={'SKILL.md':skill};
  for(let i=0;i<SKILL_INSTALL_LIMITS.files;i++)many[`file-${i}`]='x';
  const cases=[many,{'SKILL.md':skill,'large.txt':'x'.repeat(SKILL_INSTALL_LIMITS.fileBytes+1)},
    {'SKILL.md':skill,...Object.fromEntries(Array.from({length:5},(_,i)=>[`large-${i}.txt`,'x'.repeat(SKILL_INSTALL_LIMITS.fileBytes)]))}];
  for(const [i,files] of cases.entries()){
    const {fetcher,calls}=await fakeGitHub(files);
    const app=createSkillInstallRoutes(fetcher,undefined,[book(`limit-${i}`)]);
    const response=await app.request(`/api/v1/skills/limit-${i}/install-bundle`);
    assert.equal(response.status,422);
    const result=await response.json();assert.equal(result.error,'skill_package_too_large');
    assert.match(JSON.stringify(result),new RegExp(`https://github.com/FreeTWAI/freedom-skill-limit-${i}`));
    assert.equal(calls.length,1,'only the tree was downloaded');
  }
});

test('install bundles bound the tree, compressed archive and decompressed archive streams',async()=>{
  const tree=await fakeGitHub({'SKILL.md':skill});
  const cases=[
    {target:'tree',body:new Uint8Array(SKILL_INSTALL_LIMITS.treeBytes+1)},
    {target:'archive',body:new Uint8Array(SKILL_INSTALL_LIMITS.compressedBytes+1)},
    {target:'archive',body:archive({'SKILL.md':skill,'tests/excluded.txt':'x'.repeat(SKILL_INSTALL_LIMITS.archiveBytes+1)})},
  ];
  for(const [i,item] of cases.entries()){
    const fetcher=(async(input:string|URL|Request,init?:RequestInit)=>{
      const url=String(input);
      if((item.target==='tree'&&url.includes('/git/trees/'))||(item.target==='archive'&&url.startsWith('https://codeload.github.com/')))return new Response(item.body);
      return tree.fetcher(input,init);
    }) as typeof fetch;
    const response=await createSkillInstallRoutes(fetcher,undefined,[book(`stream-${i}`)]).request(`/api/v1/skills/stream-${i}/install-bundle`);
    assert.equal(response.status,422);assert.equal((await response.json()).error,'skill_package_too_large');
  }
});

test('an oversized renamed original still links to the original repository',async()=>{
  const source=book('fallback-limit',{upstream_url:'https://github.com/OriginalAuthor/original-skill'});
  const fetcher=(async(input:string|URL|Request)=>{
    const url=String(input);
    if(url===`https://api.github.com/repos/OriginalAuthor/original-skill/git/trees/${commit}?recursive=1`){
      return new Response(null,{status:301,headers:{Location:`https://api.github.com/repositories/123/git/trees/${commit}?recursive=1`}});
    }
    if(url==='https://api.github.com/repositories/123')return Response.json({id:123,full_name:'RenamedAuthor/renamed-skill',private:false,visibility:'public'});
    if(url===`https://api.github.com/repos/RenamedAuthor/renamed-skill/git/trees/${commit}?recursive=1`)return Response.json({truncated:true,tree:[]});
    throw new Error('Unexpected fetch '+url);
  }) as typeof fetch;
  const response=await createSkillInstallRoutes(fetcher,undefined,[source]).request('/api/v1/skills/fallback-limit/install-bundle');
  assert.equal(response.status,422);
  const body=await response.json();assert.equal(body.error,'skill_package_too_large');
  assert.match(JSON.stringify(body),/https:\/\/github\.com\/OriginalAuthor\/original-skill/);
});

test('the isolate cache evicts by stored bytes and bounds independent in-flight requests',async()=>{
  const files={'SKILL.md':skill,...Object.fromEntries(Array.from({length:3},(_,i)=>[`large-${i}.txt`,'x'.repeat(450_000)]))};
  const {fetcher,calls}=await fakeGitHub(files);
  const books=[book('cache-a'),book('cache-b'),book('cache-c')];
  const load=createSkillInstallBundleLoader(fetcher,undefined,books);
  await load('cache-a');await load('cache-b');
  const afterTwo=calls.length;
  await load('cache-a');assert.equal(calls.length,afterTwo,'a retained entry is a cache hit');
  await load('cache-c');
  const afterThree=calls.length;
  await load('cache-b');assert.equal(calls.length,afterThree+2,'the least-recently-used entry is evicted by byte weight');

  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const gated=(async(input:string|URL|Request,init?:RequestInit)=>{await gate;return fetcher(input,init);}) as typeof fetch;
  const gatedLoad=createSkillInstallBundleLoader(gated,undefined,[book('flight-a'),book('flight-b'),book('flight-c')]);
  const first=gatedLoad('flight-a'),same=gatedLoad('flight-a');
  const third=gatedLoad('flight-b').then(()=>null,error=>error);
  await new Promise<void>(resolve=>setImmediate(resolve));
  release();
  const [one,two,rejection]=await Promise.all([first,same,third]);
  assert.equal(rejection?.status,503);assert.equal(rejection?.code,'skill_install_busy');
  assert.notEqual(one,two,'separate incoming requests never share pending I/O');
  assert.deepEqual(one,two);
});

test('original 404 returns 503 original_unavailable without requesting any copy repository',async()=>{
  const upstreamBook=book('orig',{upstream_url:'https://github.com/OriginalAuthor/cool-skill'});
  const calls:string[]=[];
  const fetcher=(async(input:string|URL|Request)=>{
    const url=String(input);calls.push(url);
    return new Response('missing',{status:404});
  }) as typeof fetch;
  const response=await createSkillInstallRoutes(fetcher,undefined,[upstreamBook]).request('/api/v1/skills/orig/install-bundle');
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'original_unavailable',message:'原作暫時無法取得，請稍後再試。'});
  assert.equal(calls.length,1);
  assert.equal(calls.filter(url=>!url.startsWith('https://api.github.com/repos/OriginalAuthor/cool-skill/')).length,0);
});
