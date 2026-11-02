const { chromium } = require('C:/Users/17628/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"});
 for (const subRole of ['enterprise_employee','paid_individual']) {
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  const page = await context.newPage();
  await page.addInitScript((subRole)=>localStorage.setItem('weixun_identity',JSON.stringify({displayName:'验收用户',role:'player',subRole})),subRole);
  await page.route('**/api/game-data/projects',r=>r.fulfill({json:{data:[]}}));
  await page.route('**/game?**',r=>r.fulfill({body:'导航验收'}));
  await page.goto('http://127.0.0.1:3000/start');
  await page.getByRole('button',{name:'查看项目一'}).click();
  const mode = page.getByRole('button',{name:'联机 · 公司均由玩家控制'});
  if(subRole==='enterprise_employee') {
   await mode.waitFor();
   await page.getByRole('button',{name:'开始单机模式'}).click();
   await page.waitForURL('**/game?**');
   assert.equal(new URL(page.url()).searchParams.get('mode'),'solo');
   await page.goto('http://127.0.0.1:3000/start');
   await page.getByRole('button',{name:'查看项目一'}).click();
   await mode.click();
   await page.getByPlaceholder('房间码').fill('TEST123');
   await page.route('**/api/multiplayer/join',r=>r.fulfill({json:{data:{roomId:'test-room',sessionId:'test-session'}}}));
   await page.screenshot({path:__dirname+'/enterprise.png'});
   await page.getByRole('button',{name:'加入联机模式'}).click();
   await page.waitForURL('**/game?**');
   assert.equal(new URL(page.url()).searchParams.get('mode'),'multiplayer');
  } else {
   assert.equal(await mode.count(),0);
   assert.equal(await page.getByPlaceholder('房间码').count(),0);
   assert.equal(await page.getByText('游戏模式',{exact:true}).count(),0);
   await page.screenshot({path:__dirname+'/individual.png'});
   await page.getByRole('button',{name:'开始单机模式'}).click();
   await page.waitForURL('**/game?**');
   assert.equal(new URL(page.url()).searchParams.get('mode'),'solo');
  }
  console.log(subRole+': displayed controls and start navigation passed');
  await context.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});




