import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import sharp from 'sharp';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {communityCatalog,skillBooksForGuild} from '../../modules/community/catalog.js';
import {guildTitles} from '../../modules/positioning/assessment.js';
import {communityAuthorSources} from '../../modules/community/community-author-skills.js';
import {skillDiscovery} from '../../modules/community/discovery.js';
import {getSkillShareContent} from '../../modules/community/skill-share-content.js';
import {skillMarkdown,pageHtml,skillAgentMarkdown} from '../../modules/development/service.js';
import {catalogBookForRepository,catalogRepositoryKeys,repositoryKey} from '../../modules/skill-submissions/repository-match.js';
import {SkillBookSourceAccount} from '../../apps/portal-web/src/modules/SkillBookCover.js';

const expected=[
  ['project-hub','kieiken/project-hub','cfe3ab221f03f84d334ae7b97608dd31f3e643be','ken-kk','README.zh-TW.md'],
  ['taiwanese-english-checker','WilsonAImaster/taiwanese-english-checker','52532373959436a875fd94209bf32df48bfe8dc9','Wilson','README.md'],
] as const;
const languageGuild='guild_custom_e3ab38b68bcd43058b79686477bdabf5';
const book=(id:string)=>communityCatalog.skill_books.find(value=>value.id===id)!;

test('both books keep exact pins, MIT, self-declared author credit and no static guild designation',()=>{
  for(const [id,repo,sha,credit,reading] of expected){
    const source=communityAuthorSources[id],value=book(id);
    assert.ok(value,id);assert.equal(source.repo,repo);assert.equal(source.sha,sha);
    assert.equal(source.author,credit);assert.equal(source.relationship,'author');assert.equal(source.license,'MIT');
    assert.equal(source.reviewed,'2026-11-03');assert.deepEqual(source.guilds,[]);
    assert.equal(value.source_commit,sha);assert.equal(value.license_status,'MIT');assert.equal(value.guide!.author_name,credit);
    assert.equal(value.guide!.credit_role,undefined);assert.deepEqual(value.official_guild_keys,[]);
    for(const guild of Object.keys(guildTitles))assert.equal(skillBooksForGuild(guild).some(entry=>entry.id===id),false,`${guild} designates ${id}`);
    assert.equal(value.guide!.reading_url,`https://github.com/${repo}/blob/${sha}/${reading}`);
    assert.ok(value.guide!.source_evidence.some(evidence=>evidence.path==='LICENSE'),id);
    for(const evidence of value.guide!.source_evidence)assert.ok(evidence.url.startsWith(`https://github.com/${repo}/blob/${sha}/`),evidence.url);
    assert.equal(value.guide!.contribution_url,`https://github.com/${repo}/issues`);
    const md=skillMarkdown(id)!,html=pageHtml(value.title,md,`/development/skills/${id}.md`);
    for(const page of [md,html])assert.ok(page.includes('作者：'+credit),id);
    assert.ok(skillAgentMarkdown(id)?.includes('預設 PR 目標：'+repo+':main'),id);
    const account=repo.split('/')[0],link=`<a href="https://github.com/${account}" target="_blank" rel="noopener noreferrer">${account}</a>`;
    assert.ok(renderToStaticMarkup(createElement(SkillBookSourceAccount,{book:value})).includes('來源 GitHub 帳號：'+link),id);
  }
  // A custom guild has no static catalog mapping; only guild_skill_book_bindings designates its books.
  assert.equal(Object.hasOwn(guildTitles,languageGuild),false);
  assert.deepEqual(skillBooksForGuild(languageGuild),[]);
});

test('guides state the pinned limits members need before installing either book',()=>{
  const hub=book('project-hub').guide!,checker=book('taiwanese-english-checker').guide!;
  for(const pattern of [/v4\.117\.0/,/127\.0\.0\.1:4545/,/沒有使用者登入/,/_hub\/roles\.yaml/,/\.env/,/git add -A/,/--no-verify/,/未加密/,/Windows 為實驗性支援/,/尚未公證/,/不代表已開放販售/,/工坊未安裝或執行/])
    assert.match(hub.status,pattern);
  assert.match(hub.first_steps.join('\n'),/HUB_LANG=zh-TW bash hub\/setup\.sh/);
  for(const pattern of [/沒有程式或檢查引擎/,/誤判或漏抓/,/不要貼客戶個資/,/不代為送出/,/不是考試評分或語言能力認證/,/工坊未安裝或代為執行/])
    assert.match(checker.status,pattern);
  assert.match(checker.features.join('\n'),/30 條通用規則分四類/);
  assert.match(checker.features.join('\n'),/7 個情境包/);
  assert.match(checker.first_steps.join('\n'),/git clone https:\/\/github\.com\/WilsonAImaster\/taiwanese-english-checker ~\/\.claude\/skills\/taiwanese-english-checker/);
  assert.match(checker.beginner.workshop_use,/語言學習與AI協作公會/);
  assert.equal(hub.website_url,undefined);assert.equal(book('project-hub').introduction_url,null);
  assert.equal(checker.website_url,'https://wilsonaimaster.github.io/taiwanese-english-checker/');
  assert.equal(book('taiwanese-english-checker').introduction_url,checker.website_url);
});

test('discovery shows the language guild designation only when its approved binding exists',async()=>{
  const discovery=async(bindings:{guild_key:string;book_id:string}[])=>skillDiscovery({query:async(sql:string)=>{
    if(sql.includes('FROM positioning_guild_catalog'))return {rows:[{guild_key:languageGuild,name:'語言學習與AI協作公會'}]};
    if(sql.includes('FROM guild_skill_book_bindings'))return {rows:bindings};
    return {rows:[]};
  }} as unknown as Pool,new Date('2026-11-03T12:00:00Z'));
  const checker=async(bindings:{guild_key:string;book_id:string}[])=>(await discovery(bindings)).books.find(entry=>entry.book_id==='taiwanese-english-checker')!;
  assert.deepEqual((await checker([])).official_guild_keys,[]);
  const bound=await checker([{guild_key:languageGuild,book_id:'taiwanese-english-checker'}]);
  assert.deepEqual(bound.official_guild_keys,[languageGuild]);
  assert.deepEqual(bound.official_guilds,[{guild_key:languageGuild,name:'語言學習與AI協作公會'}]);
  assert.deepEqual((await discovery([{guild_key:languageGuild,book_id:'taiwanese-english-checker'}])).books.find(entry=>entry.book_id==='project-hub')!.official_guild_keys,[]);
});

test('catalog matching hides both member submissions from the published list by repository',()=>{
  for(const [id,repo] of expected){
    assert.deepEqual(catalogBookForRepository(repositoryKey(`https://github.com/${repo}.git/`)),{book_id:id,title:book(id).title,public_path:`/development/skills/${id}`});
    assert.ok(catalogRepositoryKeys.includes(repo.toLowerCase()),repo);
  }
});

test('both books have exact-size WebP art recorded in the manifests with prompts and SHA-256',async()=>{
  const hashes=new Set<string>();
  for(const [manifestPath,width,height] of [
    ['docs/design/skill-book-art-manifest.json',768,512],
    ['docs/design/skill-illustration-manifest.json',1200,630],
  ] as const){
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
    assert.equal(manifest.assets.length,55);
    for(const [id] of expected){
      const entries=manifest.assets.filter((entry:{id:string})=>entry.id===id);assert.equal(entries.length,1,id);
      const entry=entries[0],bytes=await readFile(entry.path),metadata=await sharp(bytes).metadata();
      assert.equal(metadata.format,'webp');assert.equal(metadata.width,width);assert.equal(metadata.height,height);
      assert.equal(entry.width,width);assert.equal(entry.height,height);assert.equal(entry.bytes,bytes.length);
      assert.equal(entry.sha256,createHash('sha256').update(bytes).digest('hex'));assert.ok(!hashes.has(entry.sha256));hashes.add(entry.sha256);
      assert.equal(entry.mode,'builtin-imagegen');assert.equal(entry.generated_at,'2026-11-03');assert.ok(entry.prompt.length>100);
    }
  }
  assert.equal(hashes.size,4);
});

test('each share JSON holds 100 distinct URL-free Chinese introductions and the illustration has alt text',async()=>{
  for(const [id] of expected){
    const lines=JSON.parse(await readFile(`modules/community/share-introductions/${id}.json`,'utf8'));
    assert.equal(lines.length,100);assert.equal(new Set(lines).size,100);
    for(const line of lines){
      assert.equal(line,line.trim());assert.ok([...line].length>=8&&[...line].length<=200);
      assert.match(line,/[一-鿿]/);assert.doesNotMatch(line,/https?:\/\/|www\./i);
    }
    const content=getSkillShareContent(id)!;
    assert.deepEqual(content.introductions,lines);
    assert.equal(content.illustration_url,`/brand/skill-illustrations/${id}.webp`);assert.ok([...content.illustration_alt].length>20);
  }
});

test('migration 198 only publishes, binds the approved custom guild and grants its active members',async()=>{
  const sql=await readFile('migrations/198_member_shared_skill_books_language_guild.sql','utf8');
  const statements=sql.replace(/--[^\n]*/g,'').split(';').map(value=>value.trim()).filter(Boolean);
  assert.deepEqual(statements.map(statement=>statement.match(/^INSERT INTO (\w+)/)?.[1]),['skill_publications','guild_skill_book_bindings','member_skill_book_grants']);
  for(const statement of statements)assert.match(statement,/ON CONFLICT DO NOTHING$/);
  assert.doesNotMatch(sql,/\b(UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  assert.match(statements[0],/\('project-hub'\),\s*\('taiwanese-english-checker'\)/);
  assert.match(statements[1],/a\.application_id='e3ab38b6-8bcd-4305-8b79-686477bdabf5' AND a\.state='approved'/);
  assert.match(statements[1],new RegExp(`a\\.approved_guild_key='${languageGuild}'`));
  assert.match(statements[1],/JOIN positioning_guild_catalog g ON g\.guild_key=a\.approved_guild_key/);
  assert.match(statements[2],/m\.state='active'/);assert.match(statements[2],/u\.active/);
  assert.match(statements[2],new RegExp(`b\\.guild_key='${languageGuild}' AND b\\.book_id='taiwanese-english-checker'`));
});
