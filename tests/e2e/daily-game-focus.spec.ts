import {test,expect} from './fixtures.js';
import {cashDeck} from '../../apps/portal-web/src/games/domain.js';

for(const game of ['photo','stamp','cash'] as const)test(`${game}: clicking the scene restores keyboard play after using a control`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1280,height:900});
  await page.clock.install({time:new Date('2026-11-06T12:00:00Z')});
  await page.goto(`/play?game=${game}&seed=42`);
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15000});
  await page.clock.pauseAt(new Date('2026-11-06T12:01:00Z'));
  await page.getByRole('button',{name:game==='stamp'?'先蓋一張練習紙':'開始這一局',exact:true}).click();
  const board=page.locator('.fw-arcade-board'),scene=page.locator('.fw-arcade-stage');
  const exit=page.getByRole('button',{name:'退出全螢幕',exact:true});
  await expect(exit).toHaveAttribute('aria-disabled','false');
  const control=game==='photo'?page.getByRole('button',{name:'鏡頭往右',exact:true}):game==='stamp'?page.getByRole('button',{name:'啪！蓋章',exact:true}):page.getByRole('button',{name:cashDeck(42)[0].valid?'收道具鈔 →':'← 退票券',exact:true});
  await control.click();await expect(control).toBeFocused();
  const progress=page.locator('.fw-arcade-controls .fw-arcade-meta');
  if(game==='cash')await expect(progress).toContainText('已分類 1 / 30 · 分錯 0 次');
  if(game==='stamp')await expect(page.locator('.fw-arcade-counter')).toHaveText('0/12');
  const before=game==='photo'?await page.getByRole('button',{name:'拍照快門',exact:true}).textContent():await progress.textContent();
  // Native controls retain their own arrow-key behavior before the scene is clicked.
  await page.keyboard.press(game==='cash'?(cashDeck(42)[1].valid?'ArrowRight':'ArrowLeft'):'ArrowDown');
  expect(game==='photo'?await page.getByRole('button',{name:'拍照快門',exact:true}).textContent():await progress.textContent()).toBe(before);
  for(const mode of ['fullscreen','normal'] as const){
    if(mode==='normal'){
      await exit.click();await expect(page.getByRole('dialog',{name:'遊戲全螢幕'})).toHaveCount(0);
      // A real button now owns focus outside the game board. No locator.focus()
      // or locator.press() may conceal missing pointer-to-keyboard recovery.
      await expect(page.getByRole('button',{name:'⛶ 全螢幕',exact:true})).toBeFocused();
    }
    await page.clock.fastForward(250);
    await scene.click();await expect(board).toBeFocused();
    if(game==='photo'){
      await page.keyboard.press(mode==='fullscreen'?'Space':'Enter');
      await expect(page.getByRole('button',{name:'拍照快門',exact:true})).toContainText(`快門 · ${mode==='fullscreen'?1:0} 張`);
      await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(mode==='fullscreen'?1:2);
    }else if(game==='cash'){
      const index=mode==='fullscreen'?1:2;
      await page.keyboard.press(cashDeck(42)[index].valid?'ArrowRight':'ArrowLeft');
      await expect(progress).toContainText(`已分類 ${index+1} / 30 · 分錯 0 次`);
    }else{
      // Move away from the actual target, then verify that the real stamp rule
      // records exactly one miss. The pointer's own stamp is counted separately.
      const misses=Number((await progress.textContent())!.match(/多蓋 (\d+) 次/)![1]);
      for(let i=0;i<4;i++)await page.keyboard.press('ArrowDown');
      await page.clock.fastForward(230);await page.keyboard.press('Space');
      await expect(progress).toContainText(`多蓋 ${misses+1} 次`);
    }
  }
  await expect(page.getByRole('region',{name:'遊戲成果'})).toHaveCount(0);
  expect(errors).toEqual([]);
});
