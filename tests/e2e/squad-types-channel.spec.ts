import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {navigate,signOut} from './navigation.js';
import {test,expect,type Page} from './member-feature-fixture.js';

async function member(pool:Pool,label:string){
  const id=randomUUID(),email=`squad-channel-${id}@local.test`;
  await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    SELECT $1,community_id,$2,$3,password_hash,$4,false FROM users WHERE email='maker@local.test'`,[id,email,label,randomUUID()]);
  return email;
}
async function login(page:Page,email:string){
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill(email);
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('button',{name:'設定',exact:true})).toBeVisible();
}

test('a coaching squad shows its public channel and owner can rename it on desktop and phone',async({page,e2eAuthPool})=>{
  const owner=await member(e2eAuthPool,'陪跑隊主'),viewer=await member(e2eAuthPool,'路過會員'),name=`陪跑練習 ${randomUUID().slice(0,8)}`;
  await page.setViewportSize({width:1440,height:900});
  await login(page,owner);await navigate(page,'小隊集合');
  await page.getByRole('button',{name:'成立一支小隊',exact:true}).click();
  const form=page.locator('form').filter({has:page.getByRole('heading',{name:'成立一支小隊'})});
  await form.getByLabel('小隊名稱').fill(name);
  await form.getByLabel('小隊類型').selectOption('coaching');
  await form.getByLabel('我們想一起完成什麼').fill('每週互相陪伴練習。');
  await form.getByLabel('小隊溝通頻道名稱（選填）').fill('LINE 陪跑交流');
  await form.getByRole('button',{name:'成立小隊'}).click();
  const detail=page.getByRole('region',{name:'小隊詳情'});
  await expect(detail.getByText('溝通頻道：LINE 陪跑交流')).toBeVisible();
  await page.screenshot({path:'test-results/squad-channel-desktop.png'});
  await detail.getByRole('button',{name:'成員與管理'}).click();
  await detail.locator('.squad-manage > summary').click();
  await detail.getByLabel('小隊溝通頻道名稱',{exact:true}).fill('LINE 新頻道');
  await detail.getByRole('button',{name:'儲存頻道名稱'}).click();
  await expect(detail.getByText('溝通頻道：LINE 新頻道')).toBeVisible();
  await signOut(page);
  await login(page,viewer);await navigate(page,'小隊集合');
  await page.getByLabel('搜尋小隊',{exact:true}).fill(name);
  await page.getByLabel('篩選小隊類型').selectOption('coaching');
  const card=page.locator('.expedition-squad').filter({hasText:name});
  await expect(card.getByText('技能學習陪跑小隊')).toBeVisible();
  await expect(card.getByText('溝通頻道：LINE 新頻道')).toBeVisible();
  await card.getByRole('button',{name:`查看小隊：${name}`}).click();
  await expect(detail.getByText('溝通頻道：LINE 新頻道')).toBeVisible();
  await expect(detail.getByRole('button',{name:'儲存頻道名稱'})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/squad-channel-phone.png',fullPage:true,animations:'disabled'});
});

test('four kinds share one compact directory; creation and owner cards open invitations directly',async({page,e2eAuthPool})=>{
  const owner=await member(e2eAuthPool,'四類隊長'),peer=await member(e2eAuthPool,'小隊受邀夥伴');
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await login(page,owner);await navigate(page,'小隊集合');
  await expect(page.getByLabel('小隊名稱',{exact:true})).toHaveCount(0);
  const kinds=[['project','開源專案合作團隊'],['mutual_help','生意機會合作團隊'],['coaching','技能學習陪跑小隊'],['social','吃喝玩樂交流小隊']];
  for(const [kind,label] of kinds){
    await page.getByRole('button',{name:'成立一支小隊',exact:true}).click();
    await expect(page.getByLabel('小隊名稱',{exact:true})).toBeFocused();
    await page.getByLabel('小隊名稱',{exact:true}).fill(label+'測試');
    await page.getByRole('combobox',{name:'小隊類型',exact:true}).selectOption(kind);
    await page.getByLabel('我們想一起完成什麼').fill('一起規劃下一次聚會，分享想法和共同完成的成果。');
    await page.getByRole('button',{name:'成立小隊',exact:true}).click();
    const detail=page.getByRole('region',{name:'小隊詳情'});
    await expect(detail.getByLabel('搜尋要邀請的夥伴')).toBeVisible();
    await expect(page.getByLabel('搜尋小隊',{exact:true})).toBeHidden();
    await expect(detail.locator('.squad-manage')).toHaveCount(0);
    await detail.getByRole('button',{name:'返回小隊列表'}).click();
    await page.getByRole('button',{name:'我的小隊與申請',exact:true}).click();
    await page.getByLabel('篩選小隊類型').selectOption(kind);
    const card=page.locator('.expedition-squad');
    await expect(card).toHaveCount(1);await expect(card.getByText(label,{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'清除小隊篩選'}).click();
    await page.getByRole('button',{name:'我的小隊與申請',exact:true}).click();
  }
  await expect(page.locator('.expedition-squad')).toHaveCount(4);
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>window.scrollTo(0,0));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/squads-directory-${width}.png`,fullPage:true,animations:'disabled'});
  }
  for(const theme of ['dark','versefolk']){
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.scrollTo(0,0);},theme);
    await page.screenshot({path:`test-results/squads-directory-${theme}.png`,fullPage:true,animations:'disabled'});
  }
  await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
  await page.getByRole('button',{name:'邀請夥伴：吃喝玩樂交流小隊測試',exact:true}).click();
  const detail=page.getByRole('region',{name:'小隊詳情'});
  await detail.getByLabel('搜尋要邀請的夥伴').fill('小隊受邀夥伴');
  await detail.getByRole('button',{name:'搜尋夥伴',exact:true}).click();
  await detail.getByRole('button',{name:'邀請 小隊受邀夥伴',exact:true}).click();
  await expect(detail.getByText('已邀請，等候回覆')).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));
  await expect(detail).toContainText('隊長：四類隊長');
  await page.screenshot({path:'test-results/squads-invite-390.png',fullPage:true,animations:'disabled'});
  await signOut(page);await login(page,peer);await navigate(page,'小隊集合');
  await expect(page.getByRole('button',{name:'邀請夥伴：吃喝玩樂交流小隊測試',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'接受邀請：吃喝玩樂交流小隊測試',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('creation draft and owner tab inputs survive returning, with honest scopes and keyboard focus',async({page,e2eAuthPool})=>{
  const owner=await member(e2eAuthPool,'草稿隊長'),name=`保留輸入 ${randomUUID().slice(0,8)}`;
  await login(page,owner);await navigate(page,'小隊集合');
  const create=page.getByRole('button',{name:'成立一支小隊',exact:true});await create.click();
  await page.getByLabel('小隊名稱',{exact:true}).fill(name);await page.getByLabel('我們想一起完成什麼').fill('尚未成立，不自動邀請。');
  await page.getByRole('button',{name:'返回小隊列表',exact:true}).click();await expect(create).toBeFocused();
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM member_squads WHERE name=$1',[name])).rows[0].n).toBe(0);
  await create.click();await expect(page.getByLabel('小隊名稱',{exact:true})).toHaveValue(name);await expect(page.getByLabel('小隊名稱',{exact:true})).toBeFocused();
  await page.getByRole('button',{name:'成立小隊',exact:true}).click();
  const detail=page.getByRole('region',{name:'小隊詳情'});
  await detail.getByRole('button',{name:'成員與管理',exact:true}).click();await detail.locator('.squad-manage > summary').click();
  await detail.getByLabel('小隊名稱',{exact:true}).fill(name+'未儲存');
  await detail.getByRole('button',{name:'邀請夥伴',exact:true}).click();
  await detail.getByLabel('搜尋要邀請的夥伴').fill('尚未送出的搜尋');
  await detail.getByRole('button',{name:'成員與管理',exact:true}).click();await expect(detail.getByLabel('小隊名稱',{exact:true})).toHaveValue(name+'未儲存');
  await detail.getByRole('button',{name:'邀請夥伴',exact:true}).click();await expect(detail.getByLabel('搜尋要邀請的夥伴')).toHaveValue('尚未送出的搜尋');
  await detail.getByRole('button',{name:'返回小隊列表',exact:true}).click();
  await page.getByRole('button',{name:'我的小隊與申請',exact:true}).click();await expect(page.getByRole('button',{name:'我的小隊與申請',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByLabel('搜尋小隊',{exact:true}).fill('不符合的名稱');await expect(page.getByText('沒有符合條件的小隊',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'清除小隊篩選',exact:true}).click();await expect(page.getByRole('button',{name:'我的小隊與申請',exact:true})).toHaveAttribute('aria-pressed','true');
  for(const theme of ['light','dark','versefolk'])for(const width of [320,390,1280]){
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

test('a lost squad creation response freezes input and retries the original command only',async({page,e2eAuthPool})=>{
  const owner=await member(e2eAuthPool,'未知建立隊長'),name=`只成立一次 ${randomUUID().slice(0,8)}`;
  await login(page,owner);await navigate(page,'小隊集合');await page.getByRole('button',{name:'成立一支小隊',exact:true}).click();
  await page.getByLabel('小隊名稱',{exact:true}).fill(name);await page.getByLabel('我們想一起完成什麼').fill('測試未知結果保留原意圖。');
  const writes:{key:string|undefined;body:unknown}[]=[];
  await page.route(/\/api\/v1\/squads$/,async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    writes.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});
    const response=await route.fetch();expect(response.ok()).toBe(true);
    if(writes.length===1)await route.abort('failed');else await route.fulfill({response});
  });
  await page.getByRole('button',{name:'成立小隊',exact:true}).click();
  const retry=page.getByRole('button',{name:'確認原操作結果',exact:true});await expect(retry).toBeVisible();
  await expect(page.getByLabel('小隊名稱',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'返回小隊列表',exact:true})).toBeDisabled();
  await page.goBack();await expect(page).toHaveURL(/#squads$/);await expect(retry).toBeVisible();
  await page.evaluate(()=>{window.location.hash='#skills';});await expect(page).toHaveURL(/#squads$/);await expect(retry).toBeVisible();
  expect(writes).toHaveLength(1);await retry.click();await expect(page.getByRole('region',{name:'小隊詳情'})).toBeVisible();
  expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM member_squads WHERE name=$1',[name])).rows[0].n).toBe(1);
});

test.describe('squad authored outcomes retain the original intent',()=>{
  test.use({memberFeatures:{squadOutcomesEnabled:true,eventOutcomesEnabled:true}});
  test('lost draft response survives closing detail, and outcome deep-link return preserves newer unsaved input',async({page,e2eAuthPool})=>{
    const owner=await member(e2eAuthPool,'成果草稿隊長'),name=`成果返回 ${randomUUID().slice(0,8)}`,title=`一次草稿 ${randomUUID().slice(0,8)}`;
    await login(page,owner);await navigate(page,'小隊集合');await page.getByRole('button',{name:'成立一支小隊',exact:true}).click();
    await page.getByLabel('小隊名稱',{exact:true}).fill(name);await page.getByLabel('我們想一起完成什麼').fill('整理實際完成的內容。');await page.getByRole('button',{name:'成立小隊',exact:true}).click();
    const detail=page.getByRole('region',{name:'小隊詳情'}),outcomes=page.getByRole('region',{name:'小隊成果'});
    await outcomes.getByLabel('成果標題').fill(title);await outcomes.getByLabel('成果摘要').fill('尚未公開的作者原稿。');
    expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);
    const writes:{key:string|undefined;body:unknown}[]=[];
    await page.route(/\/api\/v1\/squads\/[0-9a-f-]+\/outcomes$/,async route=>{
      if(route.request().method()!=='POST'){await route.continue();return;}
      writes.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});
      const response=await route.fetch();expect(response.ok()).toBe(true);
      if(writes.length===1)await route.abort('failed');else await route.fulfill({response});
    });
    await outcomes.getByRole('button',{name:'儲存私人草稿',exact:true}).click();
    const retry=page.getByRole('button',{name:'確認原操作結果',exact:true});await expect(retry).toBeVisible();
    await outcomes.locator('.squad-outcome-editor > summary').click();await expect(retry).toBeVisible();
    await detail.getByRole('button',{name:'返回小隊列表',exact:true}).click();await expect(retry).toBeVisible();
    await page.evaluate(()=>{window.location.hash='#squad-outcomes/00000000-0000-4000-8000-000000000000';});await expect(page).toHaveURL(/#squads$/);
    await retry.click();await expect(retry).toHaveCount(0);expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
    const saved=(await e2eAuthPool.query('SELECT outcome_id,state FROM member_squad_outcomes WHERE title=$1',[title])).rows;expect(saved).toHaveLength(1);expect(saved[0].state).toBe('draft');
    await page.getByRole('button',{name:`查看小隊：${name}`,exact:true}).click();await expect(outcomes.getByLabel('成果標題')).toHaveValue(title);
    await expect(outcomes.getByRole('button',{name:'依所選範圍發布已儲存草稿'})).toBeDisabled();
    expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(false);
    await outcomes.getByLabel('成果標題').fill(title+'未儲存');await outcomes.getByRole('link',{name:title,exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`#squad-outcomes/${saved[0].outcome_id}$`));await expect(page.getByRole('heading',{name:title,exact:true})).toBeFocused();
    await page.getByRole('link',{name:'返回小隊',exact:true}).click();await expect(detail).toBeVisible();await expect(outcomes.getByLabel('成果標題')).toHaveValue(title+'未儲存');
    expect((await e2eAuthPool.query('SELECT state FROM member_squad_outcomes WHERE outcome_id=$1',[saved[0].outcome_id])).rows[0].state).toBe('draft');
  });
});
