import type { Page } from '@playwright/test';
import { syntheticSkillPage } from '../fixtures/skill-page-content.js';
export { syntheticSkillPage };

/** Fill the new authored page fields without bypassing browser validation. */
export async function fillSkillPageContent(page: Page) {
  const content = syntheticSkillPage;
  await page.getByLabel('如何開始使用', { exact: true }).fill('依 README 安裝套件後，開啟範例輸入會議文字，再執行整理並查看輸出摘要。');
  await page.getByRole('textbox', { name: /^效益主標/ }).fill(content.headline);
  await page.getByRole('textbox', { name: /^使用者遇到什麼問題/ }).fill(content.problem);
  await page.getByRole('textbox', { name: /^工具如何解決問題/ }).fill(content.mechanism);
  await page.getByRole('textbox', { name: /^三個實際成果/ }).fill(content.outcomes.join('\n'));
  await page.getByRole('textbox', { name: /^使用條件/ }).fill(content.flow.lead);
  await page.getByRole('textbox', { name: /^流程名稱/ }).fill(content.flow.title);
  for (let index = 0; index < 3; index++) {
    await page.getByRole('textbox', { name: new RegExp(`^步驟 ${index + 1} 名稱`) }).fill(content.flow.steps[index].title);
    await page.getByRole('textbox', { name: new RegExp(`^步驟 ${index + 1} 說明`) }).fill(content.flow.steps[index].note);
  }
}
