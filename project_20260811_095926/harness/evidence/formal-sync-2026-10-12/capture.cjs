const {chromium}=require('C:/Users/17628/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {state,npcs}=require('./fixture.json');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();page.on('pageerror',e=>console.log('pageerror: '+e.message));
await page.addInitScript(()=>{localStorage.clear();localStorage.setItem('weixun_session','ui-fixture');localStorage.setItem('weixun_identity',JSON.stringify({role:'platform_designer',displayName:'同步验收'}));});
await page.route('**/api/**',async r=>{
 const url=new URL(r.request().url());
 let json={};
 if(url.pathname==='/api/game-data/npcs')json={data:npcs};
 else if(url.pathname==='/api/game/sessions/ui-fixture')json={gameSession:{id:'ui-fixture',state}};
 else if(url.pathname.endsWith('/messages'))json={messages:[]};
 else if(url.pathname.endsWith('/call-history'))json={records:[]};
 else if(url.pathname==='/api/designer/image-assets')json={assets:{}};
 else if(url.pathname==='/api/designer/prompt-config')json={};
 else if(url.pathname==='/api/project-one-preview/ai')json={sessionId:'fixture',state:{}};
 else if(url.pathname==='/api/game/sessions')json={saves:[]};
 await r.fulfill({json});
});
await page.goto('http://127.0.0.1:3000/game?location=project-1&mode=solo&sessionId=ui-fixture');
await page.getByText('张建国',{exact:true}).first().waitFor();
await page.screenshot({animations:"disabled",path:__dirname+'/before-formal.png'});
await page.goto('http://127.0.0.1:3000/project1-prototype-v9.html');
await page.getByRole('button',{name:'开始项目一'}).waitFor();
await page.getByRole('button',{name:'开始项目一'}).click();
await page.screenshot({animations:"disabled",path:__dirname+'/reference-global.png'});
await page.getByRole('button',{name:'查看 张建国 的联系人详情'}).click();
await page.screenshot({animations:"disabled",path:__dirname+'/reference-contact.png'});
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});



