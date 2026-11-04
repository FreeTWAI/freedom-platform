import {openSettingsPanel} from './settings-menu-helpers.js';
import { randomUUID } from 'node:crypto';
import { navigate } from './navigation.js';
import {test,expect,type Page,type Locator} from './fixtures.js';
import type {SkillBook} from '../../modules/community/catalog';
import { e2eOrigin } from '../../packages/testing/e2e-origin.js';

test.beforeEach(async({page})=>{
  // Preview every catalog book without pretending the fixture member has guild grants.
  await page.route('**/api/v1/me/skill-books',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/me/github',route=>route.fulfill({json:{configured:false,connected:false,github_user:null}}));
  await page.route('**/api/v1/github/books/*/metrics',route=>route.fulfill({json:{book_id:route.request().url().split('/').at(-2),repository_url:null,stargazers_count:null,forks_count:null,open_issues_count:null,subscribers_count:null,pushed_at:null,language:null,archived:null,checked_at:null,stale:false,error:'fixture_unavailable'}}));
  // Works other specs publish must not change the shelf counts asserted here.
  await page.route('**/api/v1/skill-submissions/published',route=>route.fulfill({json:{items:[]}}));
});
// Catalog books no guild designates: they sit on the 社群技能書 shelf and are not granted by joining a guild.
const communityBookIds=['anti-gambling-trader-tw','web-card-game-skill','ai-avatar-bot','ai-manga-translator','line-persona','hao-studio','ai-sister','multi-ai-desktop','multi-ai-chat','video-to-podcast-toolkit','autovtuber','coding-audit-harness','hrflow','hdsljp-api','usage','photo-border-remover','ga4-lp-analytics','sns-feedback-collect','ultracode-token-optimization','keynote-pptx-doctor','webchat-mcp','gemini-voice-lab','story-bible','human-mode'];

async function openLibrary(page:Page){
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await navigate(page, '技能書架');
  const library=page.locator('.community-library');
  await expect(page.getByRole('heading',{name:'技能書架',level:1,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'未解鎖',exact:true}).click();
  await expect(library.locator('.skill-library-book')).toHaveCount(29);
  return library;
}


test('guild skill book introduces a real first deliverable before external reading and stays usable on a phone',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
  await navigate(page, '職業公會');
  const guild=page.getByRole('article',{name:'商品品質與供應公會',exact:true});
  const trigger=guild.getByRole('button',{name:'供應端工作台',exact:true});await trigger.click();
  const modal=page.getByRole('dialog',{name:'供應端工作台',exact:true});await expect(modal).toBeVisible();
  await expect(modal).toContainText('一份能讀回自己商品與申請的私人供應端檢視。');
  await expect(modal).toContainText('沒有寫入或付款權限');
  const start=modal.locator('details').filter({has:page.getByText('練習與設定',{exact:true})});
  await expect(start).toHaveAttribute('open','');
  await expect(start).toContainText('Node.js 24');await expect(start.locator('pre')).toContainText('npm run read -- products');
  await expect(modal.getByRole('link',{name:'完整指南 ↗',exact:true})).toHaveAttribute('href','/development/skills/supplier-client');
  await expect(modal.getByRole('link',{name:'閱讀技能書 ↗',exact:true})).toHaveAttribute('href',/github\.com\/FreeTWAI\/freedom-supplier-client\/blob\/[a-f0-9]{40}\/README\.md$/);
  await modal.getByText('作者、授權與收錄來源',{exact:true}).click();await expect(modal).toContainText('來源 GitHub 帳號：FreeTWAI');await expect(modal.getByRole('link',{name:'FreeTWAI',exact:true})).toHaveAttribute('href','https://github.com/FreeTWAI');await expect(modal).toContainText('Repo 擁有者帳號，不代表會員身分已核實。');await expect(modal).toContainText('未明確宣告授權條款');
  await page.setViewportSize({width:390,height:844});expect(await modal.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:'test-results/skill-book-intro-phone.png'});
  await page.keyboard.press('Escape');await expect(modal).not.toBeVisible();await expect(trigger).toBeFocused();
  // Locate by the known book label so guild naming remains independent from the guide content.
  const music=page.getByRole('button',{name:'音樂與 MV 製作入門手冊',exact:true}).first();await music.click();
  const musicModal=page.getByRole('dialog',{name:'音樂與 MV 製作入門手冊',exact:true});await expect(musicModal).toContainText('歌曲／MV 小企劃');
  await musicModal.getByText('練習與設定',{exact:true}).click();await expect(musicModal.locator('pre')).toHaveCount(0);await expect(musicModal).not.toContainText('npm run read');
  await musicModal.getByRole('button',{name:'關閉技能書介紹',exact:true}).click();expect(errors).toEqual([]);
});


test('the guild shelf and 社群技能書 hold all 53 books once each; guild search intersects workshop categories without granting books',async({page})=>{
  const library=await openLibrary(page),cards=library.locator('article.skill-library-book');
  const community=page.locator('.community-skill-library'),communityCards=community.locator('article.skill-library-book');
  const grantedBefore=await (await page.request.get('/api/v1/me/skill-books')).json();
  await expect(library.getByRole('status')).toHaveText('顯示 29 / 29 本技能書');
  await expect(community.getByRole('status')).toHaveText('顯示 24 / 24 本社群技能書');
  const catalog=await (await page.request.get('/api/v1/community')).json() as {skill_books:SkillBook[]};
  const shelved=async(cards:Locator)=>(await cards.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-book-id')!))).sort();
  expect(await shelved(communityCards)).toEqual([...communityBookIds].sort());
  expect(catalog.skill_books.filter(book=>!book.official_guild_keys?.length).map(book=>book.id).sort()).toEqual([...communityBookIds].sort());
  expect([...await shelved(cards),...await shelved(communityCards)].sort()).toEqual(catalog.skill_books.map(book=>book.id).sort());
  // One badge slot: guild designations above, 社群技能書 below; never both on one book.
  await expect(cards.getByText('社群技能書',{exact:true})).toHaveCount(0);
  await expect(communityCards.locator('.skill-badge-community')).toHaveCount(24);
  await expect(communityCards.locator('.skill-badge-official')).toHaveCount(0);
  const illustrations=page.locator('.skill-shelves article.skill-library-book .skill-book-illustration');
  await expect(illustrations).toHaveCount(53);
  const urls=await illustrations.evaluateAll(images=>images.map(image=>image.getAttribute('src')));
  expect(new Set(urls).size).toBe(53);
  for(const url of urls){
    expect(url).toMatch(/^\/art\/skills\/[a-z0-9-]+\.webp$/);
    const response=await page.request.get(url!);
    expect(response.status(),url!).toBe(200);
    expect(response.headers()['content-type'],url!).toMatch(/^image\/webp/);
  }
  const search=library.getByLabel('搜尋技能書',{exact:true}),category=library.getByRole('combobox',{name:'依工坊用途篩選',exact:true});
  await category.selectOption({label:'資訊安全'});
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByRole('heading')).toHaveText('AI Security Scanner');
  // Search must narrow the selected category, not replace it or search only featured books.
  await search.fill('社群貼文');
  await expect(cards).toHaveCount(0);
  await expect(library.getByRole('status')).toHaveText('顯示 0 / 29 本技能書');
  await expect(library.getByText('沒有符合的技能書。試試另一個關鍵字或用途。',{exact:true})).toBeVisible();
  await category.selectOption({label:'內容與行銷'});
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByRole('heading')).toHaveText('Hao 社群貼文技能書');
  await expect(library.getByRole('status')).toHaveText('顯示 1 / 29 本技能書');
  await search.fill('');await category.selectOption({label:'全部用途'});
  await expect(cards).toHaveCount(29);
  const grantedAfter=await (await page.request.get('/api/v1/me/skill-books')).json();
  expect(grantedAfter).toEqual(grantedBefore);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('new member books are discoverable by author, retain original links and work on a narrow phone',async({page})=>{
  const library=await openLibrary(page);
  for(const [id,author,repo] of [['local-workspace-mcp','Mini','arumwu/local-workspace-mcp'],['editkin','Hao','Hao0321/Editkin'],['positioning-companion','Jason','jason201385-commits/positioning-companion'],['freedom-party-guild-lounge','David','davidni0729/freedom-party-guild-lounge'],["bidding-radar-concept", "綠豆", "greenQQQ/bidding-radar-concept"],["aiwff-runtime", "隊長", "zaxardery8011-design/aiwff-runtime"],["n8n-marketing-flows", "Yuri", "YuriCrystal/n8n-marketing-flows"],["anti-gambling-trader-tw", "阿軒哥哥（阿軒割割）", "mars-tw/anti-gambling-trader-tw"],["web-card-game-skill", "阿軒哥哥（阿軒割割）", "mars-tw/web-card-game-skill"],["ai-avatar-bot", "Yuri", "YuriCrystal/ai-avatar-bot"],["ai-manga-translator", "綠豆", "greenQQQ/ai-manga-translator"],["line-persona", "隊長", "zaxardery8011-design/line-persona"],["open-seo-advisor", "阿軒哥哥（阿軒割割）", "mars-tw/open-seo-advisor-skill"]]){
    // Demoted author books moved to 社群技能書: readable by everyone, so there is nothing to preview or unlock.
    const shelf=communityBookIds.includes(id)?page.locator('.community-skill-library'):library;
    await shelf.getByLabel(communityBookIds.includes(id)?'搜尋社群技能書':'搜尋技能書',{exact:true}).fill(author);
    const card=shelf.locator(`article[data-book-id="${id}"]`);await expect(card).toContainText('作者：'+author);
    await card.getByRole('button',{name:communityBookIds.includes(id)?'閱讀技能書':'預覽技能書',exact:true}).click();
    const modal=page.locator(`dialog.skill-intro-dialog[data-book-id="${id}"]`);
    await expect(modal).toContainText('作者：'+author);
    await modal.getByText('作者與共同開發（進階）',{exact:true}).click();
    await expect(modal.getByRole('link',{name:'Fork 原作 ↗',exact:true})).toHaveAttribute('href','https://github.com/'+repo+'/fork');
    await expect(modal.getByRole('link',{name:'開啟原作 ↗',exact:true})).toHaveAttribute('href','https://github.com/'+repo);
    await expect(modal.getByRole('link',{name:'查看工坊整合版本 ↗',exact:true})).toHaveCount(0);
    await page.setViewportSize({width:320,height:844});expect(await modal.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    if(author==='David'){await modal.getByText('作者、授權與收錄來源',{exact:true}).click();await expect(modal).toContainText('來源未明確宣告授權條款');}
    await page.keyboard.press('Escape');await expect(modal).not.toBeVisible();
  }
  await page.screenshot({path:'test-results/member-skill-books-mobile.png'});
});

test('book cards credit the original GitHub author and offer direct reading actions with details available on demand',async({page})=>{
  const library=await openLibrary(page);
  const catalog=await (await page.request.get('/api/v1/community')).json() as {skill_books:SkillBook[]};
  const book=catalog.skill_books.find(value=>value.id==='social-post')!,beginner=book.guide!.beginner;
  await library.getByLabel('搜尋技能書',{exact:true}).fill('社群貼文');
  const card=library.locator('article[data-book-id="social-post"]');
  await expect(card.getByRole('heading',{name:book.title,exact:true})).toBeVisible();
  await expect(card.locator('.skill-library-purpose')).toHaveText(beginner.purpose);
  await expect(card.locator('.skill-library-purpose')).toBeVisible();
  await expect(card).not.toContainText('你能做出什麼');
  await expect(card.locator('.skill-book-illustration')).toHaveAttribute('src',book.cover_url!);
  await card.locator('.github-metrics-details > summary').click();
  const star=card.getByRole('link',{name:'原作者 GitHub ↗',exact:true});
  await expect(star).toHaveAttribute('href','https://github.com/Hao0321/claude-skill-social-post');
  await expect(star).toHaveAttribute('target','_blank');
  await expect(star).toHaveAttribute('rel',/\bnoopener\b/);
  await expect(star).toHaveAttribute('rel',/\bnoreferrer\b/);
  await card.locator('.github-metrics-details > summary').click();
  expect(book.repository_url).toBe('https://github.com/FreeTWAI/claude-skill-social-post');
  const trigger=card.getByRole('button',{name:/^(閱讀|預覽)技能書$/});
  await trigger.click();
  const modal=page.getByRole('dialog',{name:book.title,exact:true});
  await expect(modal).toBeVisible();
  await expect(modal.getByText(beginner.purpose,{exact:true})).toBeVisible();
  await expect(modal.getByRole('heading',{name:/能做什麼|下一步|誰適合/})).toHaveCount(0);
  await expect(modal.getByText(book.guide!.first_result,{exact:true})).toBeVisible();
  await expect(modal.locator('.skill-intro-art')).toHaveAttribute('src',book.cover_url!);
  await expect(modal.locator('.skill-intro-art')).toHaveJSProperty('complete',true);
  await expect.poll(()=>modal.locator('.skill-intro-art').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(modal.getByRole('link',{name:'原作者 GitHub ↗',exact:true})).toHaveAttribute('href',book.upstream_url);
  await expect(modal.getByRole('button',{name:'GitHub 連結尚未啟用',exact:true})).toBeDisabled();
  await expect(modal.getByRole('link',{name:'開啟原作 ↗',exact:true})).toHaveAttribute('href',book.upstream_url);
  await expect(modal.locator('.skill-intro-primary-actions > .btn-primary')).toHaveCount(1);
  await expect(modal.getByRole('link',{name:'閱讀技能書 ↗',exact:true})).toHaveAttribute('href',book.guide!.reading_url);
  await modal.getByText('作者與共同開發（進階）',{exact:true}).click();
  await expect(modal.getByRole('link',{name:'Fork 原作 ↗',exact:true})).toHaveAttribute('href',`${book.upstream_url}/fork`);
  await expect(modal.getByRole('link',{name:'查看工坊整合版本 ↗',exact:true})).toHaveAttribute('href',book.repository_url);
  const practice=modal.locator('details').filter({has:page.getByText('練習與設定',{exact:true})});
  await expect(practice).toHaveAttribute('open','');
  for(const step of book.guide!.first_steps)await expect(practice.getByText(step,{exact:true})).toBeVisible();
  await expect(modal.getByRole('link',{name:'完整指南 ↗',exact:true})).toHaveAttribute('href','/development/skills/social-post');
  const scope=modal.locator('details').filter({has:page.getByText('功能與使用範圍',{exact:true})});
  await expect(scope).not.toHaveAttribute('open');await scope.locator('summary').click();
  await expect(scope.getByText(book.guide!.status,{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await modal.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/#skills$/);
});

test('all public book pages and Markdown preserve beginner summaries, covers, original stars and source facts',async({page,request})=>{
  const response=await request.get('/api/v1/development-map');expect(response.status()).toBe(200);
  const map=await response.json() as {skill_books:(SkillBook&{guide_url:string;markdown_url:string})[]};
  expect(map.skill_books).toHaveLength(53);
  for(const book of map.skill_books){
    const htmlResponse=await request.get(book.guide_url),markdownResponse=await request.get(book.markdown_url);
    expect(htmlResponse.status(),book.id).toBe(200);expect(markdownResponse.status(),book.id).toBe(200);
    expect(htmlResponse.headers()['content-type']).toMatch(/text\/html/);
    const html=await htmlResponse.text(),markdown=await markdownResponse.text();
    for(const value of Object.values(book.guide!.beginner)){
      expect(html,book.id).toContain(value);expect(markdown,book.id).toContain(value);
    }
    for(const value of [book.guide!.first_result,book.guide!.status,book.guide!.source_commit,book.repository_url,book.fork_url,book.upstream_url,book.cover_url!,book.license_status]){
      expect(html,book.id).toContain(value);expect(markdown,book.id).toContain(value);
    }
    expect(html,book.id).toContain(`src="${book.cover_url}"`);
    expect(html,book.id).toContain('href="/#skills">登入工坊 Star');
    expect(html.match(/<script[^>]*>/gi),book.id).toEqual(['<script src="/development-share.js" defer>','<script src="/assets/skill-social.js" type="module">','<script src="/skill-acquisition.js" defer>']);
    expect(html,book.id).not.toMatch(/<script(?![^>]*src=)[^>]*>/);
  }
  const example=map.skill_books.find(book=>book.id==='social-post')!;
  await page.goto(example.guide_url);
  await expect(page.getByRole('heading',{name:example.title,exact:true})).toBeVisible();
  await expect(page.locator('.public-skill-purpose')).toHaveText(example.guide!.beginner.purpose);
  const details=page.locator('.public-skill-details');
  await expect(details).not.toHaveAttribute('open');
  await expect(page.getByRole('link',{name:'閱讀收錄版本說明 ↗',exact:true})).toHaveAttribute('href',example.guide!.reading_url);
  await expect(page.getByRole('link',{name:'到 GitHub 看原始碼 ↗',exact:true})).toHaveAttribute('href',example.upstream_url);
  await expect(page.getByRole('link',{name:'從原作開始共創 ↗',exact:true})).toHaveAttribute('href',`${example.upstream_url}/fork`);
  await page.locator('.public-collaboration details > summary').click();
  await expect(page.getByRole('link',{name:'查看工坊整合版本',exact:true})).toHaveAttribute('href',example.repository_url);
  await expect(page.locator('.public-skill-entry .public-skill-actions a').first()).toHaveAttribute('href','#skill-use-title');
  await expect(page.locator('.public-skill-cover img')).toHaveAttribute('src',example.cover_url!);
  await expect.poll(()=>page.locator('.public-skill-cover img').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const star=page.getByRole('link',{name:'登入工坊 Star',exact:true});
  await expect(star).toHaveAttribute('href','/#skills');
  await details.locator('summary').click();
  await expect(details.getByText(example.guide!.beginner.workshop_use,{exact:true})).toBeVisible();
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await page.locator('.public-skill-cover img').boundingBox())!.height).toBeLessThanOrEqual(82);
  }
  await page.screenshot({path:'test-results/public-skill-compact-phone.png',fullPage:true});
  await details.locator('summary').click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'test-results/public-skill-compact-viewport.png'});
});

test('the original repository leads member introductions and public skill pages',async({page})=>{
  const library=await openLibrary(page);
  const card=library.locator('article[data-book-id="security-scanner"]');
  await library.getByLabel('搜尋技能書',{exact:true}).fill('AI Security Scanner');
  await card.getByRole('button',{name:'預覽技能書',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'AI Security Scanner',exact:true});
  const website='https://teddashh.github.io/ai-security-scanner/';
  const original='https://github.com/teddashh/ai-security-scanner';
  await expect(dialog.locator('.skill-intro-primary-actions > .btn-primary')).toHaveCount(1);
  await expect(dialog.getByRole('button',{name:'開始練習 ↓',exact:true})).toHaveClass(/btn-primary/);
  await expect(dialog.getByRole('link',{name:'開啟原作 ↗',exact:true})).toBeVisible();
  await dialog.getByText('作者、授權與收錄來源',{exact:true}).click();
  await expect(dialog.getByRole('link',{name:'前往作者網站 ↗',exact:true})).toHaveAttribute('href',website);
  await expect(dialog.getByRole('link',{name:'開啟原作 ↗',exact:true})).toHaveAttribute('href',original);
  await dialog.getByText('作者與共同開發（進階）',{exact:true}).click();
  await expect(dialog.getByRole('link',{name:'查看工坊整合版本 ↗',exact:true})).toHaveAttribute('href','https://github.com/FreeTWAI/ai-security-scanner');
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900});
    expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await dialog.evaluate(element=>element.scrollTop=0);
    await page.screenshot({path:`test-results/author-first-skill-${width}.png`});
  }
  await page.keyboard.press('Escape');
  await page.goto('/development/skills/security-scanner');
  await expect(page.locator('.public-skill-entry .public-skill-actions a').first()).toHaveAttribute('href','#skill-use-title');
  await expect(page.getByRole('link',{name:'前往作者網站 ↗',exact:true})).toHaveAttribute('href',website);
  await expect(page.getByRole('link',{name:'到 GitHub 看原始碼 ↗',exact:true})).toHaveAttribute('href',original);
});

test('every bookshelf uses compact illustrated rows with full copy, live counts and expandable secondary metrics',async({page})=>{
  const metrics={repository_url:'https://github.com/Hao0321/claude-skill-social-post',stargazers_count:127,forks_count:18,open_issues_count:4,subscribers_count:6,pushed_at:'2026-09-20T10:00:00Z',language:'TypeScript',archived:false,checked_at:'2026-09-23T10:00:00Z',stale:false,error:null};
  await page.route('**/api/v1/me/github',route=>route.fulfill({json:{configured:true,connected:true,github_user:{id:'synthetic-density',login:'synthetic-density'}}}));
  await page.route('**/api/v1/me/github/books/*/star',route=>route.fulfill({json:{book_id:route.request().url().split('/').at(-2),starred:false,connected:true}}));
  await page.route('**/api/v1/github/books/*/metrics',route=>route.fulfill({json:{...metrics,book_id:route.request().url().split('/').at(-2)}}));
  const library=await openLibrary(page),catalog=await (await page.request.get('/api/v1/community')).json() as {skill_books:SkillBook[]},book=catalog.skill_books.find(value=>value.id==='social-post')!;
  await page.route('**/api/v1/me/skill-books',route=>route.fulfill({json:{items:[{...book,book_id:book.id}]}}));
  await library.getByLabel('搜尋技能書',{exact:true}).fill('社群貼文');
  async function check(card:Locator,width:number){
    await page.setViewportSize({width,height:900});await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.skill-library-purpose')).toHaveText(book.guide!.beginner.purpose);
    await expect(card.locator('.github-star-count,.github-fork-count')).toHaveText(['127','18']);
    const sizes=await card.evaluate(element=>{
      const cover=element.querySelector('.skill-library-heading > img')!,heading=element.querySelector('.skill-library-copy')!,purpose=element.querySelector<HTMLElement>('.skill-library-purpose')!,title=element.querySelector<HTMLElement>('.skill-library-title')!;
      return {cover:cover.getBoundingClientRect().toJSON(),heading:heading.getBoundingClientRect().toJSON(),cardHeight:element.getBoundingClientRect().height,purposeHeight:purpose.clientHeight,purposeScroll:purpose.scrollHeight,titleHeight:title.clientHeight,titleScroll:title.scrollHeight,font:parseFloat(getComputedStyle(purpose).fontSize),overflow:element.scrollWidth>element.clientWidth};
    });
    expect(sizes.cover.width).toBeLessThanOrEqual(width<=600?64:80);expect(sizes.cover.height).toBeLessThanOrEqual(60);
    expect(sizes.cover.right).toBeLessThan(sizes.heading.left);expect(Math.abs(sizes.cover.top-sizes.heading.top)).toBeLessThan(35);
    expect(sizes.purposeScroll).toBeLessThanOrEqual(sizes.purposeHeight+1);expect(sizes.titleScroll).toBeLessThanOrEqual(sizes.titleHeight+1);expect(sizes.font).toBeGreaterThanOrEqual(14);
    expect(sizes.overflow).toBe(false);
    // Real practice goals may make cards taller: preserve full readable copy rather than clipping to the old 300px cap.
    await expect(card.locator('.skill-library-result p')).toHaveText(book.guide!.first_result);
    expect(await card.locator('.skill-library-result p').evaluate(element=>element.scrollHeight<=element.clientHeight+1)).toBe(true);
    await expect(card.getByRole('button',{name:/^(閱讀|預覽)技能書$/})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const control of [card.getByRole('button',{name:/^(閱讀|預覽)技能書$/}),card.getByRole('button',{name:'分享技能',exact:true})])expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const card=library.locator('article[data-book-id="social-post"]');
  for(const width of [320,390,1440]){await check(card,width);await card.screenshot({path:`test-results/skill-shelf-compact-${width}.png`});}
  const more=card.locator('.github-metrics-details');await expect(more).not.toHaveAttribute('open');await expect(more.locator('dd').first()).not.toBeVisible();await more.locator('summary').click();await expect(more.locator('dd')).toHaveText(['4','6','2026/9/20']);await expect(more.getByText('數據更新',{exact:false})).toBeVisible();await more.locator('summary').click();
  await page.setViewportSize({width:320,height:900});await card.getByRole('button',{name:/^(閱讀|預覽)技能書$/}).click();const modal=page.getByRole('dialog',{name:book.title,exact:true});expect((await modal.locator('.skill-intro-art').boundingBox())!.height).toBeLessThanOrEqual(48);await expect(modal.locator('.skill-intro-purpose')).toHaveText(book.guide!.beginner.purpose);expect(await modal.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await page.screenshot({path:'test-results/skill-dialog-compact-phone.png'});await page.keyboard.press('Escape');
  await navigate(page, '會員首頁');await navigate(page, '技能書架');
  await page.getByRole('button',{name:/^已解鎖(?: · \d+)?$/}).click();await check(page.locator('.community-library article[data-book-id="social-post"]'),320);
  await navigate(page, '職業公會');await expect(page.locator('.guild-bookshelf')).toHaveCount(0);
  await navigate(page, '我的名片');await expect(page.locator('.member-bookshelf')).toHaveCount(0);
});

test('cards in one shelf row share a height and keep the GitHub footer on one line in every theme and width',async({page})=>{
  test.setTimeout(90000);
  const library=await openLibrary(page);
  for(const [theme,label] of [['dark','自由工坊－夜航'],['light','自由工坊－明亮'],['versefolk','自由工坊－敘生']] as const){
    await page.getByRole('button',{name:'設定',exact:true}).click();
    await openSettingsPanel(page,'appearance');await page.getByRole('menuitemradio',{name:label,exact:true}).click();
    await page.getByRole('button',{name:'設定',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    // 1440px is three columns, 820px two; 390px is a single column, so no card shares a row there.
    for(const [width,columns] of [[1440,3],[820,2],[390,1]] as const){
      await page.setViewportSize({width,height:900});
      for(const shelf of [library,page.locator('.community-skill-library')]){
        const rows=await shelf.locator('article.skill-library-book').evaluateAll(cards=>{
          const byTop=new Map<number,{height:number;footer:number}[]>();
          for(const card of cards){
            const box=card.getBoundingClientRect(),footer=card.querySelector(':scope > .github-book-social'),key=Math.round(box.top);
            byTop.set(key,[...(byTop.get(key)??[]),{height:box.height,footer:footer?footer.getBoundingClientRect().bottom:NaN}]);
          }
          return [...byTop.values()];
        });
        const where=`${theme} ${width}px`;
        expect(Math.max(...rows.map(row=>row.length)),`${where} columns`).toBe(columns);
        for(const row of rows)for(const card of row){
          expect(Number.isNaN(card.footer),`${where} footer present`).toBe(false);
          expect(Math.abs(card.height-row[0].height),`${where} card height`).toBeLessThanOrEqual(1);
          expect(Math.abs(card.footer-row[0].footer),`${where} footer line`).toBeLessThanOrEqual(1);
        }
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme} ${width}px horizontal overflow`).toBe(true);
      if(theme==='light')await page.screenshot({path:`test-results/skill-shelf-equal-rows-${width}.png`,fullPage:true});
    }
  }
});

test('a published member work is packaged as a 社群技能書 like every catalog book',async({page})=>{
  const id='11111111-1111-4111-8111-111111111111',repo='https://github.com/example/event-form',path=`/development/submissions/${id}`;
  const item={submission_id:id,title:'活動報名表產生器',description:'輸入活動名稱與日期，產生可分享的報名表與提醒訊息草稿。',repository_url:repo,relationship:'curator',relationship_verification:'self_declared',official:false,project_id:'22222222-2222-4222-8222-222222222222',public_path:path,cover_url:'/art/community-skills/default.webp',illustration_url:null,
    source:{repository_full_name:'example/event-form',repository_url:repo,commit_sha:'a'.repeat(40),license_spdx:'MIT',license_evidence_url:null,is_fork:false,archived:false},published_at:'2026-09-29T10:00:00.000Z'};
  await page.route('**/api/v1/skill-submissions/published',route=>route.fulfill({json:{items:[item]}}));
  await page.route(`**/api/v1/skill-submissions/${id}`,route=>route.fulfill({json:{...item,use_notes:'npm create event-form@latest',demo_url:'https://example.com/event-form'}}));
  await page.route(`**/api/v1/skill-submissions/${id}/share-content`,route=>route.fulfill({json:{introductions:['一句給朋友的推薦。','第二句推薦。'],illustration_url:'',illustration_alt:''}}));
  await openLibrary(page);
  await expect(page.getByRole('heading',{name:'公會指定技能書',level:2,exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'社群技能書',level:2,exact:true})).toBeVisible();
  const shelf=page.locator('.community-skill-library'),cards=shelf.locator('article.skill-library-book');
  const shelfTotal=communityBookIds.length+1;await expect(shelf.getByRole('status')).toHaveText(`顯示 ${shelfTotal} / ${shelfTotal} 本社群技能書`);
  // Newest member works lead the shelf, in the same card as the catalog books after them.
  const card=cards.first();await expect(card).toHaveAttribute('data-submission-id',id);
  await expect(card.getByRole('heading',{name:item.title,level:3,exact:true})).toBeVisible();
  await expect(card.locator('.skill-library-meta')).toHaveText('社群技能書');
  await expect(card.locator('.skill-library-purpose')).toHaveText(item.description);
  await expect(card).toContainText('原作：example/event-form');
  await expect(card.locator('.skill-badge-community')).toHaveText('社群技能書');
  const cover=card.locator('.skill-library-heading > .skill-book-illustration');
  await expect(cover).toHaveAttribute('src',item.cover_url);
  await expect.poll(()=>cover.evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(card.getByRole('link',{name:'到 GitHub Star ↗',exact:true})).toHaveAttribute('href',repo);
  await expect(card.getByRole('link',{name:'Fork 專案 ↗',exact:true})).toHaveAttribute('href',`${repo}/fork`);
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:900});await card.scrollIntoViewIfNeeded();
    const box=(await cover.boundingBox())!;expect(box.width).toBeLessThanOrEqual(width<=600?64:80);
    for(const control of [card.getByRole('button',{name:'閱讀技能書',exact:true}),card.getByRole('button',{name:'分享技能',exact:true}),card.getByRole('link',{name:'到 GitHub Star ↗',exact:true})])expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  const trigger=card.getByRole('button',{name:'閱讀技能書',exact:true});await trigger.click();
  const dialog=page.getByRole('dialog',{name:item.title,exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByText('自由工坊 · 社群技能書',{exact:true})).toBeVisible();
  await expect(dialog.locator('.skill-badge-community')).toHaveText('社群技能書');
  await expect(dialog.locator('.skill-intro-purpose')).toHaveText(item.description);
  await expect(dialog.getByRole('link',{name:'開啟原作 ↗',exact:true})).toHaveAttribute('href',repo);
  await expect(dialog.locator('.skill-intro-primary-actions > .btn-primary')).toHaveCount(1);
  await expect(dialog.locator('.skill-intro-advanced')).not.toHaveAttribute('open');
  await expect(dialog.getByRole('link',{name:'交給 Agent ↗',exact:true})).toBeHidden();
  await dialog.getByText('作者與共同開發（進階）',{exact:true}).click();
  await expect(dialog.getByRole('link',{name:'開啟展示 ↗',exact:true})).toHaveAttribute('href','https://example.com/event-form');
  await expect(dialog.getByRole('link',{name:'交給 Agent ↗',exact:true})).toHaveAttribute('href',`${path}/SKILL.md`);
  await expect(dialog).toContainText('分享者自行聲明為推薦／整理者');
  await expect(dialog.locator('.skill-intro-start')).toHaveAttribute('open','');await expect(dialog.locator('pre')).toHaveText('npm create event-form@latest');
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
  await card.getByRole('button',{name:'分享技能',exact:true}).click();
  const share=page.getByRole('dialog',{name:`分享「${item.title}」`,exact:true});await expect(share).toBeVisible();
  await expect(share.locator('.skill-share-url')).toHaveText(new RegExp(`/development/submissions/${id}\\?intro=[12]$`));
  await share.getByRole('button',{name:'關閉分享預覽',exact:true}).click();
  const uses=shelf.getByRole('combobox',{name:'依內容與技術用途篩選',exact:true});
  await uses.selectOption('圖片');
  await expect(shelf.locator(`[data-submission-id="${id}"]`)).toHaveCount(0); // Submissions have no curated use mapping.
  await shelf.getByRole('button',{name:'清除篩選',exact:true}).click();
  await expect(card).toBeVisible();
  await expect(shelf.getByRole('status')).toHaveText(`顯示 ${shelfTotal} / ${shelfTotal} 本社群技能書`);
  const search=shelf.getByLabel('搜尋社群技能書',{exact:true});
  await search.fill('綠豆');await expect(cards).toHaveCount(1);await expect(cards.first()).toHaveAttribute('data-book-id','ai-manga-translator');
  await expect(shelf.getByRole('status')).toHaveText(`顯示 1 / ${shelfTotal} 本社群技能書`);
  await search.fill('沒有這本書');await expect(cards).toHaveCount(0);await expect(shelf.getByText('沒有符合的社群技能書。試試另一個關鍵字或用途。',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/community-skill-books.png'});
});

test('a 成長與行銷公會 member sees Open SEO Advisor unlocked on the guild shelf',async({page,e2eAuthPool})=>{
  await page.unroute('**/api/v1/me/skill-books');
  const id=randomUUID(),email=`seo-advisor-${id}@local.test`;
  await e2eAuthPool.query("INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active) SELECT $1,community_id,$2,'SEO 健檢夥伴',password_hash,$3,true FROM users WHERE email='maker@local.test'",[id,email,randomUUID()]);
  try {
    await page.goto('/');
    await page.getByLabel('電子郵件',{exact:true}).fill(email);
    await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
    await page.getByRole('button',{name:'登入',exact:true}).click();
    await expect(page.locator('.shell')).toBeVisible();
    const session=await (await page.request.get('/api/v1/session')).json() as {csrf_token:string};
    const joined=await page.request.post('/api/v1/guilds/guild_marketing/join',{headers:{Origin:e2eOrigin(),'X-CSRF-Token':session.csrf_token,'Idempotency-Key':randomUUID()},data:{}});
    expect(joined.ok(),await joined.text()).toBe(true);
    await navigate(page,'技能書架');
    const shelf=page.locator('section.skill-shelf').filter({has:page.getByRole('heading',{name:'公會指定技能書',exact:true})});
    await expect(shelf.getByRole('heading',{name:'公會指定技能書',level:2,exact:true})).toBeVisible();
    await shelf.getByLabel('搜尋技能書',{exact:true}).fill('SEO 健檢');
    const card=shelf.locator('article[data-book-id="open-seo-advisor"]');
    await expect(card).toHaveAttribute('data-access','unlocked');
    await expect(card).toContainText('作者：阿軒哥哥（阿軒割割）');
    const cover=card.locator('.skill-book-illustration');
    await expect(cover).toHaveAttribute('src','/art/skills/open-seo-advisor.webp');
    await expect.poll(()=>cover.evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(shelf.locator('article.skill-library-book')).toHaveCount(1);
    for(const width of [390,820,1280]){
      await page.setViewportSize({width,height:width===390?844:900});
      await card.scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/open-seo-advisor-shelf-${width}.png`,fullPage:true});
    }
  } finally {
    await e2eAuthPool.query('DELETE FROM outbox WHERE transition_id IN (SELECT transition_id FROM transition_journal WHERE actor_ref=$1)',[id]);
    await e2eAuthPool.query('DELETE FROM transition_journal WHERE actor_ref=$1',[id]);
    for(const table of ['member_skill_book_grants','positioning_profession_memberships','guild_member_preferences','command_receipts','sessions','member_accounts'])await e2eAuthPool.query(`DELETE FROM ${table} WHERE user_id=$1`,[id]);
    await e2eAuthPool.query('DELETE FROM users WHERE user_id=$1',[id]);
  }
});

test('member-shared maintainer and curator credits stay accurate on cards, dialogs and public pages',async({page,request})=>{
  await openLibrary(page);
  for(const [id,credit,role] of [['usage','ken-kk','維護'],['human-mode','啪哩啪啦','策展']]){
    const card=page.locator(`.community-skill-library article[data-book-id="${id}"]`);
    await expect(card).toContainText(`來源標示的${role}：${credit}`);
    await expect(card).not.toContainText(`作者：${credit}`);
    await card.getByRole('button',{name:'閱讀技能書',exact:true}).click();
    const dialog=page.locator('dialog[open]');
    await expect(dialog).toContainText(`來源標示的${role}：${credit}`);
    await expect(dialog).not.toContainText(`作者：${credit}`);
    await dialog.getByText('作者、授權與收錄來源',{exact:true}).click();
    const owner=id==='usage'?'kieiken':'madeofroc-arch';
    await expect(dialog.getByRole('link',{name:owner,exact:true})).toHaveAttribute('href',`https://github.com/${owner}`);
    await expect(dialog).toContainText('Repo 擁有者帳號，不代表會員身分已核實。');
    await page.keyboard.press('Escape');
    const response=await request.get(`/development/skills/${id}`);expect(response.status()).toBe(200);
    const html=await response.text();expect(html).toContain(`${role}：${credit}`);expect(html).not.toContain(`作者：${credit}`);
  }
});


test('reading-first library gives newcomers a clear entry and recoverable search',async({page})=>{
  const library=await openLibrary(page);
  await expect(page.getByText('找到工具，讀懂做法，動手試試。',{exact:true})).toBeVisible();
  await expect(page.locator('.skill-shelves>.skill-shelf').first().getByRole('heading',{name:'社群技能書',exact:true})).toBeVisible();
  const search=library.getByRole('searchbox',{name:'搜尋技能書',exact:true});
  await search.fill('no-such-skill-unique-fixture');
  await expect(library.locator('article.skill-library-book')).toHaveCount(0);
  await library.getByRole('button',{name:'清除篩選',exact:true}).click();
  await expect(search).toHaveValue('');await expect(search).toBeFocused();
  await expect(library.locator('article.skill-library-book')).toHaveCount(29);
  await page.getByRole('link',{name:'探索社群技能書 ↓',exact:true}).click();
  await expect(page.getByRole('heading',{name:'社群技能書',exact:true})).toBeFocused();
  const community=page.locator('.community-skill-library'),communitySearch=community.getByRole('searchbox',{name:'搜尋社群技能書',exact:true});
  await communitySearch.fill('no-such-skill-unique-fixture');
  await expect(community.getByText('沒有符合的社群技能書。試試另一個關鍵字或用途。',{exact:true})).toBeVisible();
  await community.getByRole('button',{name:'清除篩選',exact:true}).click();
  await expect(communitySearch).toHaveValue('');await expect(communitySearch).toBeFocused();
  await page.getByRole('link',{name:'查看公會技能書 ↓',exact:true}).click();
  await expect(page.getByRole('heading',{name:'公會指定技能書',exact:true})).toBeFocused();
});

for(const width of [1280,390])test(`practice is readable immediately, before supplementary art and collaboration at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:720});
  const library=await openLibrary(page);
  await library.locator('[data-book-id="local-workspace-mcp"]').getByRole('button',{name:'預覽技能書',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Local Workspace MCP 本機工作助手',exact:true}),practice=dialog.locator('.skill-intro-start');
  await expect(dialog.getByRole('button',{name:'開始練習 ↓',exact:true})).toBeInViewport();
  await expect(dialog.locator('.skill-intro-primary-actions > .btn-primary')).toHaveCount(1);
  await expect(dialog.getByText('想留著下次看？按「分享技能」可複製介紹與連結。',{exact:true})).toBeVisible();
  await expect(dialog.locator('.skill-intro-primary-actions').getByRole('button',{name:'分享技能',exact:true})).toBeVisible();
  await expect(dialog.getByRole('link',{name:'開啟原作 ↗',exact:true})).toBeVisible();
  const advanced=dialog.locator('.skill-intro-advanced');
  await expect(advanced).not.toHaveAttribute('open');
  await expect(dialog.getByRole('button',{name:'加入共同開發',exact:true})).toBeHidden();
  await expect(dialog.locator('.skill-install')).not.toHaveAttribute('open');
  expect(await dialog.evaluate(element=>{
    const goal=element.querySelector('.skill-intro-outcome')!,start=element.querySelector('.skill-intro-primary-actions')!,practice=element.querySelector('.skill-intro-start')!,install=element.querySelector('.skill-install')!;
    return Boolean(goal.compareDocumentPosition(start)&Node.DOCUMENT_POSITION_FOLLOWING)&&Boolean(practice.compareDocumentPosition(install)&Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await test.info().attach(`skillbook-intro-${width}px`,{body:await page.screenshot(),contentType:'image/png'});
  await expect(practice).toHaveAttribute('open','');
  await expect(practice.getByRole('heading',{name:'準備',exact:true})).toBeVisible();
  expect(await dialog.evaluate(element=>{
    const reading=element.querySelector('.skill-intro-start')!;
    return ['.skill-intro-illustration','.skill-intro-collaboration','.github-book-social'].every(selector=>{
      return [...element.querySelectorAll(selector)].every(next=>Boolean(reading.compareDocumentPosition(next)&Node.DOCUMENT_POSITION_FOLLOWING));
    });
  })).toBe(true);
  await practice.locator('summary').click();await expect(practice).not.toHaveAttribute('open');
  await dialog.getByRole('button',{name:'開始練習 ↓',exact:true}).click();await expect(practice).toHaveAttribute('open','');
  await expect(practice.locator('summary')).toBeFocused();
  await advanced.locator('summary').focus();await page.keyboard.press('Enter');
  await expect(advanced).toHaveAttribute('open','');
  await expect(dialog.getByRole('button',{name:'加入共同開發',exact:true})).toBeVisible();
  await advanced.locator('summary').click();await expect(advanced).not.toHaveAttribute('open');
  await test.info().attach(`skillbook-practice-${width}px`,{body:await page.screenshot(),contentType:'image/png'});
  await dialog.getByRole('button',{name:'關閉技能書介紹',exact:true}).click();
  await expect(library.locator('[data-book-id="local-workspace-mcp"]').getByRole('button',{name:'預覽技能書',exact:true})).toBeFocused();
});


// Measure the rendered caption and its actual painted surface, not theme token strings.
function illustrationCaptionContrast(element: Element) {
  const rgba = (value: string) => {
    const match = /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*([\d.]+))?\)$/.exec(value);
    if (!match) throw new Error(`Unsupported computed color: ${value}`);
    return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 1)];
  };
  const style = getComputedStyle(element), foreground = rgba(style.color);
  let background: number[] | null = null;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const paint = getComputedStyle(node), color = rgba(paint.backgroundColor);
    if (Number(paint.opacity) !== 1) throw new Error('Caption ancestor is translucent');
    if (!background) {
      if (paint.backgroundImage !== 'none') throw new Error('Caption background image needs explicit contrast analysis');
      if (color[3] === 1) background = color;
      else if (color[3] !== 0) throw new Error('Caption background needs alpha compositing');
    }
  }
  if (!background || foreground[3] !== 1) throw new Error('Caption needs opaque foreground and an opaque surface');
  const luminance = (rgb: number[]) => rgb.slice(0, 3).reduce((sum, value, index) => {
    const channel = value / 255;
    return sum + [0.2126, 0.7152, 0.0722][index] * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  }, 0);
  const a = luminance(foreground), b = luminance(background);
  return { foreground, background, fontSize: Number.parseFloat(style.fontSize), fontWeight: style.fontWeight,
    ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
}

for (const theme of ['light', 'dark', 'versefolk'] as const) {
  for (const width of [390, 1280]) {
    test(`catalog and member illustration captions have readable contrast in ${theme} at ${width}px`, async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('freedom-theme', value), theme);
      await page.setViewportSize({ width, height: 900 });
      const id = '11111111-1111-4111-8111-111111111111';
      const item = { submission_id: id, title: '圖說對比測試作品', description: '合成的技能書圖說驗證。', relationship: 'curator',
        cover_url: '/art/community-skills/default.webp', illustration_url: '/art/community-skills/default.webp',
        source: { repository_full_name: 'example/caption-fixture', repository_url: 'https://github.com/example/caption-fixture',
          commit_sha: 'a'.repeat(40), license_spdx: 'MIT', license_evidence_url: null, archived: false } };
      await page.route('**/api/v1/skill-submissions/published', route => route.fulfill({ json: { items: [item] } }));
      await page.route(`**/api/v1/skill-submissions/${id}`, route => route.fulfill({ json: { ...item, use_notes: '先閱讀原作說明。', demo_url: null } }));
      const library = await openLibrary(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const entries = [
        { trigger: library.locator('[data-book-id="local-workspace-mcp"]').getByRole('button', { name: '預覽技能書', exact: true }),
          dialog: page.locator('dialog.skill-intro-dialog[data-book-id="local-workspace-mcp"]') },
        { trigger: page.locator(`article[data-submission-id="${id}"]`).getByRole('button', { name: '閱讀技能書', exact: true }),
          dialog: page.locator(`dialog.skill-intro-dialog[data-submission-id="${id}"]`) },
      ];
      for (const { trigger, dialog } of entries) {
        await trigger.click();
        const caption = dialog.locator('.skill-intro-illustration > figcaption');
        await expect(caption).toHaveText('功能示意圖，非實際操作截圖。');
        await caption.scrollIntoViewIfNeeded();
        await expect(caption).toBeInViewport();
        await expect.poll(() => dialog.locator('.skill-intro-illustration > img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        const contrast = await caption.evaluate(illustrationCaptionContrast);
        expect(contrast.fontSize).toBeGreaterThanOrEqual(14);
        expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await dialog.getByRole('button', { name: '關閉技能書介紹', exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      }
    });
  }
}


for(const width of [1280,390])test(`both shelves combine content uses, business purposes and text, and reset at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  const guild=await openLibrary(page),community=page.locator('.community-skill-library');
  for(const [shelf,searchLabel,id,use,category,total,noun] of [
    [guild,'搜尋技能書','social-post','文字','內容與行銷',29,'技能書'],
    [community,'搜尋社群技能書','photo-border-remover','圖片','內容與行銷',24,'社群技能書'],
  ] as const){
    const search=shelf.getByRole('searchbox',{name:searchLabel,exact:true});
    const uses=shelf.getByRole('combobox',{name:'依內容與技術用途篩選',exact:true});
    const business=shelf.getByRole('combobox',{name:'依工坊用途篩選',exact:true});
    await uses.selectOption(use);
    await expect(shelf.locator(`article[data-book-id="${id}"]`)).toBeVisible();
    await business.selectOption(category);
    await expect(shelf.locator(`article[data-book-id="${id}"]`)).toBeVisible();
    await search.fill('no-matching-purpose-fixture');
    await expect(shelf.getByRole('status')).toContainText(`顯示 0 / ${total} 本${noun}`);
    await expect(shelf.getByText(`沒有符合的${noun}。試試另一個關鍵字或用途。`,{exact:true})).toBeVisible();
    await shelf.getByRole('button',{name:'清除篩選',exact:true}).click();
    await expect(search).toBeFocused();await expect(search).toHaveValue('');
    await expect(uses).toHaveValue('');await expect(business).toHaveValue('');
    await expect(shelf.getByRole('status')).toContainText(`顯示 ${total} / ${total} 本${noun}`);
    expect(await shelf.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  }
  // An unmapped catalog book remains readable in All.
  await expect(community.locator('article[data-book-id="hrflow"]')).toBeVisible();
});

for(const width of [1280,390])test(`skill introductions defer unvisited content and retain visited dialogs at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  let reads=0,releaseFirst!:()=>void;
  const firstRead=new Promise<void>(resolve=>{releaseFirst=resolve;});
  await page.route('**/api/v1/skills/supplier-client/collaboration',async route=>{
    const attempt=++reads;
    if(attempt===1)await firstRead;
    await route.fulfill({json:{purpose:attempt===1?'Late closed introduction':'Fresh reopened introduction',intent:{summary:'Synthetic cooperation guidance'}}}).catch(()=>{});
  });
  await page.route('**/api/v1/skills/supplier-client/share-content',route=>route.fulfill({json:{introductions:['Synthetic share introduction'],illustration_url:'',illustration_alt:''}}));
  await page.route('**/api/v1/promotion/links',route=>route.fulfill({json:{path:'/share/synthetic-skill-link',points:{week:0,all:0}}}));
  try {
  const library=await openLibrary(page),card=library.locator('article[data-book-id="supplier-client"]');
  const allShells=page.locator('.community-library .skill-intro-dialog, .community-skill-library .skill-intro-dialog');
  await expect(allShells).toHaveCount(53);
  await expect(allShells.locator(':scope > *')).toHaveCount(0);
  expect(reads).toBe(0);
  const trigger=card.getByRole('button',{name:'預覽技能書',exact:true});
  await trigger.focus();await page.keyboard.press('Enter');
  const modal=card.locator('.skill-intro-dialog');
  await expect(modal).toBeVisible();await expect(modal).toHaveAccessibleName('供應端工作台');
  await expect(modal.getByRole('button',{name:'關閉技能書介紹',exact:true})).toBeFocused();
  await expect(modal.getByRole('link',{name:'完整指南 ↗',exact:true})).toHaveAttribute('href','/development/skills/supplier-client');
  const practice=modal.locator('.skill-intro-start');
  await expect(practice).toHaveAttribute('open','');
  await practice.locator('summary').click();await expect(practice).not.toHaveAttribute('open','');
  const content=await modal.locator(':scope > .stack').elementHandle();
  const shareShell=await modal.locator('.skill-share-dialog').elementHandle();
  await expect.poll(()=>reads).toBe(1);
  await page.keyboard.press('Escape');await expect(modal).not.toBeVisible();await expect(trigger).toBeFocused();
  releaseFirst();
  await expect.poll(()=>content!.evaluate(element=>element.isConnected)).toBe(true);
  await expect.poll(()=>shareShell!.evaluate(element=>element.isConnected)).toBe(true);
  await trigger.press('Enter');await expect(modal).toBeVisible();
  await expect(modal.locator('.skill-intro-purpose')).toHaveText('Fresh reopened introduction');
  await expect(modal).not.toContainText('Late closed introduction');
  await expect(practice).not.toHaveAttribute('open','');
  expect(await content!.evaluate(element=>element===element.closest('dialog')?.querySelector(':scope > .stack'))).toBe(true);
  const shareTrigger=modal.getByRole('button',{name:'分享技能',exact:true});
  await shareTrigger.click();
  const nested=modal.locator('.skill-share-dialog');await expect(nested).toBeVisible();
  await expect(nested).toContainText('Synthetic share introduction');
  await page.keyboard.press('Escape');await expect(nested).not.toBeVisible();await expect(modal).toBeVisible();await expect(shareTrigger).toBeFocused();
  await modal.getByRole('button',{name:'關閉技能書介紹',exact:true}).click();await expect(trigger).toBeFocused();
  await expect(allShells.locator(':scope > .stack')).toHaveCount(1);
  await content!.dispose();await shareShell!.dispose();
  } finally { releaseFirst(); }
});
