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
import {skillMarkdown,pageHtml,skillAgentMarkdown} from '../../modules/development/service.js';
import {catalogBookForRepository,catalogRepositoryKeys,repositoryKey} from '../../modules/skill-submissions/repository-match.js';
import {listPublishedSkillSubmissions} from '../../modules/skill-submissions/public.js';
import {trackedGitHubRepositories} from '../../modules/community/github-sync.js';
import {catalogMetricTargets} from '../../modules/github-social/service.js';
import {memberAuthorClaim,PUBLIC_AUTHOR_CLAIM_SQL} from '../../modules/community/repo-author-claims.js';
import {SkillBookSourceAccount} from '../../apps/portal-web/src/modules/SkillBookCover.js';

const expected=[
  ["hrflow", "tesdano-crypto/HRSystem-OpenSource", "a60cd7b14d25b5a8ab90574247e48a4b4038b11c", "Shiang", "author", "Apache-2.0"],
  ["hdsljp-api", "kieiken/hdsljp-api", "a3fc3b4ff2a3acf0df541da1b83a3688e0be8a19", "ken-kk", "author", "AGPL-3.0"],
  ["usage", "kieiken/usage", "e6298d1af0e2127b587b2ff609942896635bdd66", "ken-kk", "maintainer", "AGPL-3.0"],
  ["photo-border-remover", "kieiken/photo-border-remover", "92df7927148ce6bab202114393365c8bc9e652d1", "ken-kk", "author", "MIT"],
  ["ga4-lp-analytics", "kieiken/ga4-lp-analytics", "2c2b18d564a6bd6de24cd1057bed197af1b97c32", "ken-kk", "author", "MIT"],
  ["sns-feedback-collect", "kieiken/sns-feedback-collect", "6d9578f2773a645ac4fea9ed322e0144254202a3", "ken-kk", "author", "MIT"],
  ["ultracode-token-optimization", "kieiken/ultracode-token-optimization", "aa7b2bd43da2364602554e954deeecc02e903b7e", "ken-kk", "author", "MIT"],
  ["keynote-pptx-doctor", "kieiken/keynote-pptx-doctor", "b7d2a1299f2776e481681d8fa326095cae5053f6", "ken-kk", "author", "MIT"],
  ["webchat-mcp", "JS-PACKAGE/WebChatMCP.js", "a9b5f77874cdb4de669c89a3b7d7fd76d2cd8a44", "星語", "author", "Apache-2.0"],
  ["gemini-voice-lab", "Rumi-3653/gemini-voice-lab", "c8f6933127ca1d6ba65d0ce47075cfab4b5a0285", "Nico", "author", "MIT"],
  ["story-bible", "Rumi-3653/story-bible", "d0fa28c9a2bf7f26eaf8f01a8b03c2f4508a9ef5", "Nico", "author", "MIT"],
  ["human-mode", "madeofroc-arch/AI-Detox-Center", "b2f5bc19f2f22b18285dfe360a5d77acbda63ca1", "啪哩啪啦", "curator", "MIT"]
] as const;

test('all twelve source accounts link to the repository owner without implying verified member identity',()=>{
  for(const [id,repo] of expected){
    const book=communityCatalog.skill_books.find(book=>book.id===id)!,account=repo.split('/')[0];
    const link=`<a href="https://github.com/${account}" target="_blank" rel="noopener noreferrer">${account}</a>`;
    for(const markup of [renderToStaticMarkup(createElement(SkillBookSourceAccount,{book})),pageHtml(book.title,skillMarkdown(id)!,`/development/skills/${id}.md`)]){
      assert.ok(markup.includes('來源 GitHub 帳號：'+link),id);
      assert.ok(markup.includes('Repo 擁有者帳號，不代表會員身分已核實。'),id);
    }
    assert.equal(book.guide!.contribution_url,`https://github.com/${repo}/issues`);
  }
  assert.equal(renderToStaticMarkup(createElement(SkillBookSourceAccount,{book:{repository_url:'https://github.com.evil.invalid/owner/repo'}})),'<p>來源資訊請見原作連結。</p>');
});

test('member-shared books enter GitHub sync and metrics from the catalog with an empty fake pool',async()=>{
  let queries=0;
  const pool={query:async(sql:string)=>{
    queries++;assert.equal(sql,'SELECT repository_full_name FROM oss_projects WHERE sharing_withdrawn_at IS NULL');
    return {rows:[]};
  }} as unknown as Pool;
  const tracked=await trackedGitHubRepositories(pool),metrics=catalogMetricTargets();
  assert.equal(queries,1);
  for(const [id,repo] of expected){
    assert.deepEqual(tracked.filter(target=>target.key===repo.toLowerCase()),[{key:repo.toLowerCase(),name:repo}]);
    assert.ok(metrics.some(target=>target.key===repo.toLowerCase()&&target.repository===repo),id);
  }
});

test('all twelve book ids are available to connected repository owners in the existing claim flow',async()=>{
  for(const [id,repo] of expected){
    const owner=repo.split('/')[0];
    const pool={query:async(sql:string,params:unknown[])=>{
      if(sql.startsWith('SELECT github_user_id, github_login FROM github_social_connections'))return {rows:[{github_user_id:'123',github_login:owner}]};
      if(sql.includes("c.source_snapshot->>'book_id'=$3")){assert.equal(params[2],id);return {rows:[]};}
      assert.equal(sql,PUBLIC_AUTHOR_CLAIM_SQL);assert.deepEqual(params,[id]);return {rows:[]};
    }} as unknown as Pool;
    const actor={user_id:'synthetic-owner',community_id:'synthetic-community',email:'synthetic@example.test',display_name:'Synthetic owner',profession_membership_ref:'synthetic-profession',session_hash:'synthetic-session',csrf_token:'synthetic-csrf'};
    const view=await memberAuthorClaim(pool,actor,id);
    assert.equal(view.book_id,id);assert.equal(view.github_connected,true);assert.equal(view.github_login,owner);
    assert.equal(view.public.status,'unclaimed');assert.deepEqual(view.claims,[]);
  }
});

test('only declared work websites are added to the twelve member-shared guides',()=>{
  const websites:Record<string,string>={
    'photo-border-remover':'https://kieiken.github.io/photo-border-remover/',
    'keynote-pptx-doctor':'https://kieiken.github.io/keynote-pptx-doctor/',
    'webchat-mcp':'https://webchatmcp.js-package.xyz',
  };
  for(const [id] of expected){
    const book=communityCatalog.skill_books.find(book=>book.id===id)!;
    assert.equal(book.guide!.website_url,websites[id]);assert.equal(book.introduction_url,websites[id]??null);
  }
});

test('all twelve member-shared repositories retain exact pins, community credit, self-declared roles and no guild assignments',()=>{
  for(const [id,repo,sha,credit,relationship,license] of expected){
    const source=communityAuthorSources[id],book=communityCatalog.skill_books.find(book=>book.id===id)!;
    assert.ok(book,id);assert.equal(source.repo,repo);assert.equal(source.sha,sha);
    assert.equal(source.author,credit);assert.equal(source.relationship,relationship);
    assert.equal(source.license,license);assert.equal(source.reviewed,'2026-10-20');assert.deepEqual(source.guilds,[]);
    assert.equal(book.source_commit,sha);assert.equal(book.license_status,license);assert.equal(book.guide!.author_name,credit);
    assert.deepEqual(book.official_guild_keys,[]);
    for(const guild of Object.keys(guildTitles))assert.equal(skillBooksForGuild(guild).some(book=>book.id===id),false);
    const role=relationship==='maintainer'?'維護':relationship==='curator'?'策展':'作者';
    assert.equal(book.guide!.credit_role,role==='作者'?undefined:role);
    const md=skillMarkdown(id)!,html=pageHtml(book.title,md,`/development/skills/${id}.md`);
    for(const value of [md,html]){
      assert.ok(value.includes(role+'：'+credit),id);
      if(role!=='作者')assert.equal(value.includes('作者：'+credit),false,id);
    }
    assert.ok(skillAgentMarkdown(id)?.includes('預設 PR 目標：'+repo+':main'));
    assert.equal(book.guide!.reading_url,`https://github.com/${repo}/blob/${sha}/README.md`);
    assert.ok(book.guide!.source_evidence.some(e=>e.path==='LICENSE'));
  }
  assert.match(communityAuthorSources.usage.license,/AGPL/);
  assert.match(communityCatalog.skill_books.find(b=>b.id==='usage')!.guide!.status,/lollapalooza.*aqua5230\/usage/);
  assert.match(communityCatalog.skill_books.find(b=>b.id==='hdsljp-api')!.guide!.status,/星曆資料/);
  assert.match(communityCatalog.skill_books.find(b=>b.id==='sns-feedback-collect')!.guide!.status,/不在本 repo/);
});

test('catalog matching supplies all twelve repositories to the published-list SQL exclusion, including both WebChatMCP submissions',async()=>{
  for(const [id,repo] of expected){
    assert.deepEqual(catalogBookForRepository(repositoryKey(`https://github.com/${repo}.git/`)),{
      book_id:id,title:communityCatalog.skill_books.find(book=>book.id===id)!.title,public_path:`/development/skills/${id}`,
    });
    assert.ok(catalogRepositoryKeys.includes(repo.toLowerCase()));
  }
  // Unit boundary: inspect SQL and its parameters. Real PostgreSQL behavior is covered in skill-submission-upgrades.
  let calls=0;
  const pool={query:async(sql:string,params:unknown[])=>{
    calls++;assert.match(sql,/lower\(v\.repository_full_name\) <> ALL\(\$2::text\[\]\)/);
    assert.equal(params[0],1);assert.deepEqual(params[1],catalogRepositoryKeys);assert.equal(params[2],null);
    const excluded=new Set(params[1] as string[]);
    for(const [id,repo] of expected){
      const submissions=id==='webchat-mcp'?['first','second']:['first'];
      for(const submission of submissions)assert.ok(excluded.has(repo.toLowerCase()),`${id}/${submission}`);
    }
    return {rows:[]};
  }} as unknown as Pool;
  assert.deepEqual(await listPublishedSkillSubmissions(pool,1),[]);assert.equal(calls,1);
});

test('new book art is exact-size WebP and matches the recorded prompts and SHA-256 manifests',async()=>{
  const hashes=new Set<string>();
  for(const [manifestPath,width,height] of [
    ['docs/design/skill-book-art-manifest.json',768,512],
    ['docs/design/skill-illustration-manifest.json',1200,630],
  ] as const){
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
    assert.equal(manifest.assets.length,53);
    for(const [id] of expected){
      const entries=manifest.assets.filter((entry:{id:string})=>entry.id===id);assert.equal(entries.length,1,id);
      const entry=entries[0],bytes=await readFile(entry.path),metadata=await sharp(bytes).metadata();
      assert.equal(metadata.format,'webp');assert.equal(metadata.width,width);assert.equal(metadata.height,height);
      assert.equal(entry.width,width);assert.equal(entry.height,height);assert.equal(entry.bytes,bytes.length);
      assert.equal(entry.sha256,createHash('sha256').update(bytes).digest('hex'));assert.ok(!hashes.has(entry.sha256));hashes.add(entry.sha256);
      assert.equal(entry.mode,'builtin-imagegen');assert.equal(entry.generated_at,'2026-10-20');assert.ok(entry.prompt.length>100);
    }
  }
  assert.equal(hashes.size,24);
});

test('each new share JSON contains exactly 100 distinct URL-free Chinese introductions',async()=>{
  for(const [id] of expected){
    const lines=JSON.parse(await readFile(`modules/community/share-introductions/${id}.json`,'utf8'));
    assert.equal(lines.length,100);assert.equal(new Set(lines).size,100);
    for(const line of lines){
      assert.equal(line,line.trim());assert.ok([...line].length>=8&&[...line].length<=200);
      assert.match(line,/[一-鿿]/);assert.doesNotMatch(line,/https?:\/\/|www\./i);
    }
  }
});
