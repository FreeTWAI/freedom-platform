import {test,expect,openSeller} from './seller-console-fixture.js';
import {createE2ePaymentOrder} from './hosted-payment-fixture.js';
const hash=(s:{tenant:string;instance:string},path:string)=>`#stores/${s.tenant}/${s.instance}/${path}`;

test('E05 quick payment filters preserve route intent, IME edits stay local, and pasted numbers normalize on apply',async({page,browser,baseURL,e2eAuthPool})=>{
 test.setTimeout(120000);
 const p=await createE2ePaymentOrder(e2eAuthPool,browser,baseURL!,page.context()),s=p.store;
 const queries:URLSearchParams[]=[];
 await page.route('**/checkout-orders?*',async route=>{
  queries.push(new URL(route.request().url()).searchParams);await route.continue();
 });
 await openSeller(page,baseURL!,s.seller.email,hash(s,'overview'));
 const console=page.locator('.seller-console');
 await console.getByRole('link',{name:'查看待確認收款',exact:true}).click();
 await expect(page).toHaveURL(/awaiting_offline_payment=true/);
 await expect.poll(()=>queries.some(q=>q.get('awaiting_offline_payment')==='true')).toBe(true);
 await expect(console.getByLabel('只看待確認收款',{exact:true})).toBeChecked();
 await console.getByRole('link',{name:'全部訂單',exact:true}).click();
 const order=console.getByRole('link',{name:p.order.display_number,exact:true});await expect(order).toBeVisible();
 const form=console.getByRole('form',{name:'篩選訂單',exact:true}),input=form.getByLabel('訂單編號',{exact:true});
 const before=queries.length;
 const pasted='　'+p.order.display_number.toLowerCase().replace(/[!-~]/g,(char:string)=>String.fromCharCode(char.charCodeAt(0)+0xfee0))+'　';
 await input.dispatchEvent('compositionstart');await input.fill(pasted);
 await input.press('Enter');
 await expect(form.getByText('篩選條件已修改，按「套用篩選」後更新清單。',{exact:true})).toBeVisible();
 expect(queries.length).toBe(before);
 await input.dispatchEvent('compositionend',{data:pasted});
 await form.getByRole('button',{name:'套用篩選',exact:true}).click();
 await expect.poll(()=>queries.some(q=>q.get('display_number')===p.order.display_number)).toBe(true);
 await expect(input).toHaveValue(p.order.display_number);await expect(order).toBeVisible();
 await form.getByLabel('付款方式',{exact:true}).selectOption('bank_transfer');
 await form.getByLabel('只看待確認收款',{exact:true}).check();
 const beforeApply=queries.length;
 await expect(form.getByText('篩選條件已修改，按「套用篩選」後更新清單。',{exact:true})).toBeVisible();
 expect(queries.length).toBe(beforeApply);
 await form.getByRole('button',{name:'套用篩選',exact:true}).click();
 await expect.poll(()=>queries.some(q=>q.get('display_number')===p.order.display_number&&q.get('payment_method')==='bank_transfer'&&q.get('awaiting_offline_payment')==='true')).toBe(true);
 await page.goBack();await expect(form.getByLabel('付款方式',{exact:true})).toHaveValue('');
 await expect(input).toHaveValue(p.order.display_number);
 await form.getByRole('link',{name:'清除篩選',exact:true}).click();
 await expect(input).toHaveValue('');await expect(input).toBeFocused();await expect(order).toBeVisible();
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});
