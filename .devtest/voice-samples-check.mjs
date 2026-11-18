import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
const root=path.resolve(new URL('..',import.meta.url).pathname), origin='https://ember.baxstarfishing.com';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium'});
const wav=Buffer.alloc(44+1600);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1600,40);
let checks=0;
function check(label,ok){assert.ok(ok,label);checks++;console.log('PASS '+label)}
try {
 for(const width of [390,1440]) {
  const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:width<600?3:1});
  const page=await context.newPage(),calls=[],errors=[];let mode='ok',release;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin!==origin)return route.abort();
   if(u.pathname.startsWith('/api/')){
    calls.push({path:u.pathname,body:route.request().postDataJSON()});
    if(mode==='wait')await new Promise(r=>release=r);
    try { return await route.fulfill(mode==='error'?{status:502,json:{error:'failed'}}:{contentType:'audio/wav',body:wav}); }catch{return}
   }
   const file=path.resolve(root,u.pathname.endsWith('/')?u.pathname.slice(1)+'index.html':u.pathname.slice(1));
   if(!file.startsWith(root+path.sep))return route.abort();
   try{await route.fulfill({path:file})}catch{await route.abort()}
  });
  await page.goto(origin+'/work/voice-samples/');
  check(`${width}: no automatic API call or microphone`,calls.length===0&&await page.locator('audio:not([hidden])').count()===0);
  for(const name of ['Jenny','Aria','Michelle']){
   await page.getByRole('button',{name:'Play '+name,exact:true}).click();
   await page.getByRole('link',{name:'Download '+name+' sample'}).waitFor();
   check(`${width}: real voice ID for ${name}`,calls.at(-1).body.voice===`en-US-${name}Neural`);
   check(`${width}: ${name} download is playable audio URL`,(await page.getByRole('link',{name:'Download '+name+' sample'}).getAttribute('href')).startsWith('blob:'));
  }
  check(`${width}: fair comparison uses identical words`,new Set(calls.map(c=>c.body.text)).size===1);
  const before=calls.length;await page.getByRole('button',{name:'Play Jenny',exact:true}).click();
  check(`${width}: repeated sample uses cache`,calls.length===before);
  check(`${width}: only existing speech API used`,calls.every(c=>c.path==='/api/tts'));
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  check(`${width}: Stop pauses all samples`,await page.locator('audio').evaluateAll(items=>items.every(a=>a.paused)));
  await page.screenshot({path:`/tmp/ember-voice-samples-${width}.png`});
  await page.reload();mode='error';await page.getByRole('button',{name:'Play Aria',exact:true}).click();
  await page.getByRole('status').filter({hasText:'HTTP 502'}).waitFor();
  check(`${width}: provider error is visible without fake playback`,await page.locator('audio:not([hidden])').count()===0);
  mode='wait';await page.getByRole('button',{name:'Play Michelle',exact:true}).click();
  await page.waitForTimeout(100);await page.getByRole('button',{name:'Stop',exact:true}).click();mode='ok';release();
  await page.waitForTimeout(150);
  check(`${width}: late response cannot start after Stop`,await page.locator('audio:not([hidden])').count()===0&&await page.getByRole('status').innerText()==='Stopped.');
  check(`${width}: no runtime errors`,errors.length===0);
  await context.close();
 }
} finally {await browser.close()}
console.log(`Voice samples: ${checks} checks passed.`);
