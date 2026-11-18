import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const origin = 'https://ember.baxstarfishing.com';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium' });
let checks = 0;
function check(label, value) { assert.ok(value, label); checks++; console.log('PASS '+label); }
async function fixture(width = 390) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: width < 600 ? 3 : 1 });
  const page = await context.newPage(), calls = [], errors = [];
  let mode = 'drive';
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.abort();
    if (u.pathname.startsWith('/api/')) {
      const body = route.request().postDataJSON() || {};
      if (u.pathname === '/api/connectors/status') return route.fulfill({ json: { connectors: { gdrive:'connected', gmail:'connected', calendar:'connected', quo:'connected' } } });
      if (u.pathname !== '/api/messages') return route.fulfill({status:503,json:{error:'unavailable'}});
      const q = body.messages.at(-1)?.content || '';
      if (/ONLY valid JSON/.test(q)) return route.fulfill({json:{content:[{type:'text',text:'{"voicemails":[],"emails":[],"events":[]}'}],stop_reason:'end_turn'}});
      calls.push(body);
      const server = mode === 'wrong' ? 'calendar' : 'gdrive';
      const noTool = mode === 'denial' || (mode === 'retry' && !q.includes('[Ember check'));
      const tools = noTool ? [] : [
        {type:'mcp_tool_use', id:'read1', name:server === 'gdrive' ? 'read_file_content' : 'list_events', server_name:server, input:{}},
        {type:'mcp_tool_result', tool_use_id:'read1', is_error:mode === 'error', content:[]}
      ];
      const text = noTool ? 'I cannot access Google Docs.' : 'The document says the launch is Friday.';
      return route.fulfill({json:{model:body.model,content:[...tools,{type:'text',text}],stop_reason:'end_turn'}});
    }
    const file = path.resolve(root, u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
    if (!file.startsWith(root+path.sep)) return route.abort();
    try { await route.fulfill({path:file}); } catch { await route.abort(); }
  });
  await page.goto(origin);
  await page.getByRole('button',{name:'Fast replies: on',exact:true}).waitFor();
  await page.waitForFunction(() => !document.querySelector('.voice-fast-toggle').disabled);
  async function ask(q) {
    const input=page.getByRole('textbox',{name:'Ask Ember'});
    await input.fill(q); await input.press('Enter');
    await page.locator('.home-thread [data-role="assistant"]').last().waitFor();
    await page.waitForFunction(() => document.querySelector('.home-thread')?.getAttribute('aria-busy') === 'false');
    return page.locator('.home-thread [data-role="assistant"]').last().innerText();
  }
  return {context,page,calls,errors,ask,mode:v=>mode=v};
}
try {
  for (const width of [390,1440]) {
    const f=await fixture(width);
    const button=f.page.getByRole('button',{name:'Fast replies: on',exact:true});
    check(`${width}: Fast visible before microphone starts`,await button.isVisible()&&await button.isEnabled());
    await button.click();
    await f.page.waitForFunction(()=>JSON.parse(localStorage.getItem('ember-prefs')||'{}').voiceFast===false);
    await f.page.reload();
    check(`${width}: Fast off survives refresh`,await f.page.getByRole('button',{name:'Fast replies: off',exact:true}).isVisible());
    for (const q of ['Can you access Google Docs?','Can you access Google Docs via my Zapier connection?','Read my Google Doc','Open https://docs.google.com/document/d/test/edit','Summarize it','Can you try through Zapier?']) {
      const start=f.calls.length, answer=await f.ask(q), request=f.calls.at(-1);
      check(`${width}: ${q}`,answer.includes('launch is Friday')&&f.calls.length===start+1&&request.mcp_servers.some(s=>s.name==='gdrive'));
      check(`${width}: document context is read-only and names the real connection`,request.messages[0].content.includes('no Zapier chat connector')&&request.messages[0].content.includes('read_file_content before summarizing'));
    }
    await f.ask('Read me a joke');
    check(`${width}: a new subject is not forced into the previous document lookup`,!f.calls.at(-1).messages[0].content.includes('no Zapier chat connector'));
    f.mode('retry'); let start=f.calls.length;
    check(`${width}: premature access denial gets one real-read retry`,(await f.ask('Read my Google Doc')).includes('launch is Friday')&&f.calls.length===start+2);
    f.mode('wrong'); start=f.calls.length;
    const wrong=await f.ask('Summarize my Google Doc');
    check(`${width}: calendar result cannot prove a document read`,wrong.includes("couldn't get a live result from your files")&&!wrong.includes('launch')&&f.calls.length===start+2);
    f.mode('error'); start=f.calls.length;
    const failed=await f.ask('Read my Google Doc');
    check(`${width}: failed Drive tool is honest and is not retried`,failed.includes("couldn't get a live result from your files")&&f.calls.length===start+1);
    f.mode('denial'); start=f.calls.length;
    check(`${width}: missing tools stop after one retry`,(await f.ask('Read my Google Doc')).includes("couldn't get a live result from your files")&&f.calls.length===start+2);
    check(`${width}: no invented connector URL or client credentials`,f.calls.every(c=>c.mcp_servers.every(s=>Object.keys(s).join('|')==='name')));
    if(width===1440)check('desktop still has no page scroll',await f.page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));
    await f.page.screenshot({path:`/tmp/ember-docs-fast-${width}.png`});
    check(`${width}: no runtime errors`,f.errors.length===0);
    await f.context.close();
  }
} finally { await browser.close(); }
console.log(`Docs and Fast replies: ${checks} checks passed.`);
