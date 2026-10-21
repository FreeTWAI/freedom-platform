import {test,expect,type Page} from './fixtures.js';
import {signOut} from './navigation.js';
import {randomUUID} from 'node:crypto';
import {DEMO_COMMUNITY,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {hashPassword} from '../../modules/identity-membership/service.js';

async function composer(page:Page,email='maker@local.test'){
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill(email);
  await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  return page.getByRole('dialog',{name:'建立貼文',exact:true});
}

test('buttons and keyboard traverse multiple drafts, close retains history, and editing clears redo',async({page})=>{
  const dialog=await composer(page),area=dialog.getByLabel('貼文內容',{exact:true});
  const undo=dialog.getByRole('button',{name:'復原上一步',exact:true}),redo=dialog.getByRole('button',{name:'重做',exact:true});
  await expect(undo).toBeDisabled();await expect(redo).toBeDisabled();
  await area.fill('第一稿：原始資訊與 https://example.test/?a=1&b=2');await area.press('Tab');
  await area.fill('第二稿：保留原本的連結與數字 42');await area.press('Tab');
  await area.fill('第三稿：繁中、emoji 🎨 與換行\n都要保留');
  await undo.click();await expect(area).toHaveValue('第二稿：保留原本的連結與數字 42');
  await area.press('Control+z');await expect(area).toHaveValue('第一稿：原始資訊與 https://example.test/?a=1&b=2');
  await area.press('Control+Shift+z');await expect(area).toHaveValue('第二稿：保留原本的連結與數字 42');
  await redo.click();await expect(area).toHaveValue('第三稿：繁中、emoji 🎨 與換行\n都要保留');
  await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  await undo.click();await area.fill('新的分支');await expect(redo).toBeDisabled();
  await undo.click();await expect(area).toHaveValue('第二稿：保留原本的連結與數字 42');
});

test('optimizer loads on demand, failed download retains editable history and explicit retry recovers',async({page})=>{
  let loads=0;
  await page.route('**/assets/SocialPostOptimizer-*.js*',async route=>{loads++;if(loads===1)await route.abort('failed');else await route.continue();});
  const dialog=await composer(page),area=dialog.getByLabel('貼文內容',{exact:true});
  await area.fill('工具失敗前的原稿');await area.press('Tab');await area.fill('工具失敗也要保留的修改');
  expect(loads).toBe(0);
  await dialog.getByRole('button',{name:'✦ Social Post 優化',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('文案優化未能開啟，草稿仍保留');
  await dialog.getByRole('button',{name:'復原上一步',exact:true}).click();await expect(area).toHaveValue('工具失敗前的原稿');
  await dialog.getByRole('button',{name:'重試開啟文案優化',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Social Post 文案優化',exact:true})).toBeVisible();expect(loads).toBe(2);
  await expect(area).toHaveValue('工具失敗前的原稿');
  await dialog.getByRole('button',{name:'重做',exact:true}).click();await expect(area).toHaveValue('工具失敗也要保留的修改');
});

test('unknown publication locks history, retry confirms the original command and clears history after acknowledgement',async({page,e2eAuthPool})=>{
  const id=randomUUID(),email=`social-history-${id}@example.test`;
  // Publishing must not consume the shared maker account's daily posting quota.
  await e2eAuthPool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    VALUES($1,$2,$3,'貼文歷程測試會員',$4,$5,false)`,[id,DEMO_COMMUNITY,email,hashPassword(DEMO_PASSWORD),randomUUID()]);
  const dialog=await composer(page,email),area=dialog.getByLabel('貼文內容',{exact:true});
  await area.fill('本機驗證：發布確認後才清除草稿歷程');
  await page.route('**/api/v1/social-posts/notes',route=>route.abort('failed'),{times:1});
  await dialog.getByRole('button',{name:'發布貼文',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'重試發布',exact:true})).toBeEnabled();
  await expect(area).toBeDisabled();await expect(dialog.getByRole('button',{name:'復原上一步',exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'重做',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'重試發布',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();await expect(area).toHaveValue('');
  await expect(dialog.getByRole('button',{name:'復原上一步',exact:true})).toBeDisabled();await area.press('Control+z');await expect(area).toHaveValue('');
});

test('signing out and signing in again cannot recover the previous session draft',async({page})=>{
  const dialog=await composer(page);
  await dialog.getByLabel('貼文內容',{exact:true}).fill('上一個登入階段的私人草稿');
  await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();await signOut(page);
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  await expect(dialog.getByLabel('貼文內容',{exact:true})).toHaveValue('');
  await expect(dialog.getByRole('button',{name:'復原上一步',exact:true})).toBeDisabled();
});

test('history controls fit a 320px composer and remain keyboard accessible',async({page})=>{
  await page.setViewportSize({width:320,height:844});
  const dialog=await composer(page),area=dialog.getByLabel('貼文內容',{exact:true});
  await area.fill('把一個想法，慢慢打磨成作品。');await area.press('Tab');await area.fill('第二版：保留創作的每一步。');
  const undo=dialog.getByRole('button',{name:'復原上一步',exact:true});await undo.click();await expect(area).toBeFocused();
  await expect(dialog.getByRole('button',{name:'重做',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.freedom/creator-evidence/social-history-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:'.freedom/creator-evidence/social-history-desktop.png',fullPage:true});
});
