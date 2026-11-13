import {test} from 'node:test';
import assert from 'node:assert/strict';
import {communityCatalog} from '../../modules/community/catalog.js';
import {checkSkillBookUpstreams,formatSkillBookUpstreamReport,hasUpstreamFailures,validateSkillBookPin} from '../../scripts/check-skill-book-upstreams.js';

test('all official books have internally consistent commit-pinned reading and evidence links',()=>{
  assert.equal(communityCatalog.skill_books.length,55);
  for(const book of communityCatalog.skill_books)validateSkillBookPin(book);
});

test('drift check follows original upstream rather than a newer FreeTWAI fork and does not fail when newer',async()=>{
  const book=communityCatalog.skill_books.find(book=>book.id==='social-post')!;
  const latest='a'.repeat(40);
  const requested:string[]=[];
  const checks=await checkSkillBookUpstreams([book],async input=>{
    requested.push(String(input));
    if(String(input).endsWith('/commits?per_page=1'))return Response.json([{sha:latest}]);
    return Response.json({sha:book.source_commit});
  });
  assert.deepEqual(requested,[
    'https://api.github.com/repos/Hao0321/claude-skill-social-post/commits?per_page=1',
    'https://api.github.com/repos/Hao0321/claude-skill-social-post/commits/'+book.source_commit,
  ]);
  assert.equal(checks[0].latest,latest);
  assert.equal(checks[0].pinned_in_original,true);
  assert.equal(hasUpstreamFailures(checks),false);
  const report=formatSkillBookUpstreamReport(checks);
  assert.match(report,/1 checked; 1 changed; 0 errors/);
  assert.match(report,new RegExp(`/compare/${book.source_commit}\\.\\.\\.${latest}`));
});

test('an unchanged pin is reported as in sync and does not list a compare link',async()=>{
  const book=communityCatalog.skill_books.find(book=>book.id==='career-guide')!;
  const checks=await checkSkillBookUpstreams([book],async()=>Response.json([{sha:book.source_commit}]));
  assert.equal(checks[0].latest,book.source_commit);
  assert.equal(checks[0].error,undefined);
  const report=formatSkillBookUpstreamReport(checks);
  assert.match(report,/1 checked; 0 changed; 0 errors/);
  assert.match(report,/All catalog pins match their upstream default branches/);
  assert.doesNotMatch(report,/review diff/);
});

test('upstream http failures and rate limits stay in the error section',async()=>{
  const book=communityCatalog.skill_books.find(book=>book.id==='career-guide')!;
  for(const status of [500,403,429]){
    const checks=await checkSkillBookUpstreams([book],async()=>new Response('limited',{status}));
    assert.equal(checks[0].latest,undefined);
    assert.match(checks[0].error??'',new RegExp(`HTTP ${status}`));
    assert.match(formatSkillBookUpstreamReport(checks),new RegExp(`1 checked; 0 changed; 1 errors[\\s\\S]*HTTP ${status}`));
  }
});

test('a mismatched guide pin is reported before any upstream request',async()=>{
  const book=communityCatalog.skill_books.find(book=>book.id==='career-guide')!;
  const invalid={...book,guide:{...book.guide!,source_commit:'b'.repeat(40)}};
  let called=false;
  const checks=await checkSkillBookUpstreams([invalid],async()=>{called=true;return Response.json([]);});
  assert.equal(called,false);
  assert.match(checks[0].error??'',/guide source commit differs/);
  assert.match(formatSkillBookUpstreamReport(checks),/1 errors/);
  assert.equal(hasUpstreamFailures(checks),true);
});

test('missing original repo or missing pinned commit fails and lists fallback org copy installs',async()=>{
  const copyBook=communityCatalog.skill_books.find(item=>item.upstream_url!==item.repository_url)!;
  const copySlug=copyBook.repository_url.replace('https://github.com/','');
  const origSlug=copyBook.upstream_url.replace('https://github.com/','');
  const latest='b'.repeat(40);

  // Original reachable, newer head exists, but pinned commit returns 404 in original while copy has it -> fails AND lists org copy install
  const checks=await checkSkillBookUpstreams([copyBook],async input=>{
    const url=String(input);
    if(url===`https://api.github.com/repos/${origSlug}/commits?per_page=1`)return Response.json([{sha:latest}]);
    if(url===`https://api.github.com/repos/${origSlug}/commits/${copyBook.source_commit}`)return new Response('missing',{status:404});
    if(url===`https://api.github.com/repos/${copySlug}/commits/${copyBook.source_commit}`)return Response.json({sha:copyBook.source_commit});
    return new Response('missing',{status:404});
  });
  assert.equal(hasUpstreamFailures(checks),true);
  assert.equal(checks[0].pinned_in_original,false);
  assert.equal(checks[0].installing_from_copy,true);
  assert.match(checks[0].error??'',/not found in original repository/);
  const report=formatSkillBookUpstreamReport(checks);
  assert.match(report,/1 checked; 1 changed; 1 errors; 1 installing from org copy/);
  assert.match(report,new RegExp(`${copyBook.id}: ${copyBook.repository_url}`));

  // Original gone (404) or unresolvable URL -> fails
  const goneChecks=await checkSkillBookUpstreams([copyBook],async()=>new Response('gone',{status:404}),[
    {book_id:copyBook.id,original_repository:origSlug,fallback_repository:copySlug,commit:copyBook.source_commit!,reason:'original_commit_missing',recorded_at:'2026-11-13T00:00:00Z'},
  ]);
  assert.equal(hasUpstreamFailures(goneChecks),true);
  assert.equal(goneChecks[0].installing_from_copy,true);
  assert.match(goneChecks[0].error??'',/HTTP 404/);

  const badUrlBook={...copyBook,upstream_url:'https://gitlab.com/other/repo'};
  const badChecks=await checkSkillBookUpstreams([badUrlBook],async()=>new Response('should not run'));
  assert.equal(hasUpstreamFailures(badChecks),true);
  assert.match(badChecks[0].error??'',/Invalid GitHub repository URL/);
});
