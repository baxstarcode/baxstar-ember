// Real rendered app and HTML audio; SpeechRecognition, wake lock and providers
// are deterministic fixtures. These checks do not prove physical iPhone/CarPlay audio.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium'});
let checks=0;
function check(label,value){assert.ok(value,label);checks++;console.log('PASS '+label)}
const wav=Buffer.alloc(44+16000*2*6);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(Math.round(Math.sin((i-44)/2/16000*440*2*Math.PI)*800),i);
async function fixture({width=1440,preview=false,recognition=true,wake='ok',reduced=false}={}){
 const context=await browser.newContext({viewport:{width,height:width<600?844:1000},deviceScaleFactor:width<600?3:1,reducedMotion:reduced?'reduce':'no-preference'});
 const page=await context.newPage(),calls=[],errors=[];let mode='normal',pending=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({recognition,wake})=>{
  window.recs=[];window.recMode='normal';window.wakes=[];window.wakeMode=wake;
  class Rec {
   start(){this.active=true;recs.push(this);if(recMode==='denied')setTimeout(()=>this.onerror?.({error:'not-allowed'}),0);else if(recMode!=='pending')setTimeout(()=>this.onstart?.(),0)}
   stop(){if(recMode!=='unconfirmed'){this.active=false;setTimeout(()=>this.onend?.(),0)}}
   abort(){this.stop()}
  }
  window.SpeechRecognition=recognition?Rec:undefined;window.webkitSpeechRecognition=undefined;
  window.say=(text,final=true)=>{const r=recs.at(-1),v=[{transcript:text}];v.isFinal=final;r.onresult?.({results:[v],resultIndex:0})};
  Object.defineProperty(navigator,'wakeLock',{value:{request:async()=>{if(wakeMode==='deny')throw Error('denied');if(wakeMode==='pending')await new Promise(r=>window.resolveWake=r);const lock=new EventTarget();lock.released=false;lock.release=async()=>{lock.released=true;lock.dispatchEvent(new Event('release'))};wakes.push(lock);return lock}}});
  Object.defineProperty(navigator,'audioSession',{value:Object.assign(new EventTarget(),{type:'auto',state:'active'})});
 },{recognition,wake});
 const origin=preview?'https://voice-check.baxstar-ember.pages.dev':'https://ember.baxstarfishing.com';
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname.startsWith('/api/')){
   const body=route.request().postDataJSON();calls.push({path:u.pathname,body});
   if(u.pathname==='/api/connectors/status')return route.fulfill({json:{connectors:{}}});
   if((mode==='chatPending'&&u.pathname==='/api/messages')||(mode==='ttsPending'&&u.pathname==='/api/tts'))await new Promise(r=>pending.push(r));
   if(u.pathname==='/api/tts')return route.fulfill(mode==='ttsFailure'?{status:502,json:{error:'provider-refused'}}:{contentType:'audio/wav',body:wav}).catch(()=>{});
   const q=body.messages?.at(-1)?.content||'';
   const text=/ONLY valid JSON/.test(q)?'{"voicemails":[],"emails":[],"events":[]}':mode==='long'?'This is the complete long reply. '.repeat(45):'Your voice is connected. The boat is ready, and your next trip is on the calendar.';
   return route.fulfill({json:{model:body.model,content:[{type:'text',text}],stop_reason:'end_turn'}}).catch(()=>{});
  }
  const rel=u.pathname==='/'?'index.html':u.pathname.slice(1),file=path.resolve(root,rel);
  if(!file.startsWith(root+path.sep))return route.abort();
  try {await route.fulfill({path:file})}catch{await route.abort()}
 });
 await page.goto(origin);await page.getByRole('textbox',{name:'Ask Ember'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.chat-controls button[aria-pressed="true"]'));
 const panel=page.getByRole('region',{name:'Ember voice controls'});
 const start=async()=>{await page.getByRole('button',{name:'Talk to Ember',exact:true}).click();await page.locator('[data-voice-phase="listening"]').waitFor()};
 const finish=async(text='Check my next trip.',final=true)=>{await page.evaluate(([t,f])=>say(t,f),[text,final]);await panel.getByRole('button',{name:'Finish talking'}).click();await panel.locator('[data-phase="ready"]').waitFor()};
 return {page,context,panel,calls,errors,start,finish,mode:v=>mode=v,resolve:()=>{pending.splice(0).forEach(r=>r())},async end(){await page.locator('audio[aria-label="Ember reply"]').evaluate(a=>a.currentTime=a.duration-.05);await panel.locator('[data-phase="ready"]').waitFor()}};
}
try{
 for(const width of [1440,390]){
  const f=await fixture({width});const hero=f.page.locator('.reactor-stage');const before=await hero.boundingBox();
  check(`${width}: mic never starts on load`,await f.page.evaluate(()=>recs.length===0));
  await f.start();check(`${width}: explicit mouth tap starts one session`,await f.page.evaluate(()=>recs.length===1));
  await f.panel.locator('[data-wake="held"]').waitFor();await f.finish();
  check(`${width}: capture ends before Send`,await f.page.evaluate(()=>recs.every(r=>!r.active)));
  await f.panel.getByRole('button',{name:'Send',exact:true}).click();await f.panel.locator('[data-phase="playing"]').waitFor();
  check(`${width}: selected Opus/Medium uses normal chat`,f.calls.some(c=>c.path==='/api/messages'&&c.body.model==='claude-opus-5-5'&&c.body.output_config?.effort==='medium'&&c.body.messages.at(-1)?.content==='Check my next trip.'));
  check(`${width}: Jenny uses tested endpoint`,f.calls.some(c=>c.path==='/api/tts'&&c.body.voice==='en-US-JennyNeural'));
  check(`${width}: new voice providers never used`,!f.calls.some(c=>c.path.includes('/voice/')));
  check(`${width}: reply reaches persistent normal conversation`,await f.page.locator('.home-thread [data-role="assistant"]').innerText().then(t=>t.includes('Your voice is connected')));
  const after=await hero.boundingBox();check(`${width}: skull does not shrink after reply`,Math.abs(before.width-after.width)<1&&after.width>250);
  check(`${width}: transcript remains bounded`,await f.page.locator('.home-thread').evaluate(e=>e.clientHeight>=120&&e.clientHeight<=160));
  check(`${width}: playback requests iPhone playback session`,await f.page.evaluate(()=>navigator.audioSession.type==='playback'));
  await f.page.waitForTimeout(450);
  check(`${width}: playback brings the whole skull above the dock`,await hero.evaluate(e=>{const r=e.getBoundingClientRect(),d=document.querySelector('.console-dock').getBoundingClientRect();return r.top>=0&&r.bottom<=d.top}));
  await f.page.screenshot({path:`/tmp/ember-foreground-${width}.png`,fullPage:false});
  if(width===1440){await f.page.locator('.brand-phrase').evaluate(e=>{const a=e.getAnimations()[0];a.pause();a.currentTime=365});await hero.screenshot({path:'/tmp/ember-brand-impact.png'});await f.page.locator('.brand-phrase').evaluate(e=>e.getAnimations()[0]?.play())}
  check(`${width}: decorative brand doesn't intercept controls`,await f.page.locator('.mouth-brand').evaluate(e=>getComputedStyle(e).pointerEvents==='none'));
  await f.end();check(`${width}: playback releases screen lock`,await f.page.evaluate(()=>wakes.every(w=>w.released)));
  const count=f.calls.filter(c=>c.path==='/api/tts').length;
  await f.panel.getByRole('button',{name:'Stop voice'}).click();await f.panel.getByRole('button',{name:'Read reply',exact:true}).click();await f.panel.locator('[data-phase="playing"]').waitFor();
  check(`${width}: speech replay uses cached audio`,f.calls.filter(c=>c.path==='/api/tts').length===count);
  await f.panel.getByRole('button',{name:'Stop voice'}).click();
  check(`${width}: stop clears audio but preserves words`,await f.panel.locator('audio').getAttribute('src')===null&&(await f.panel.locator('textarea').inputValue()).includes('next trip'));
  await f.start();await f.page.evaluate(()=>say('Unfinished words',false));await f.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
  await f.panel.locator('[data-phase="ready"]').waitFor();
  check(`${width}: interruption retains received words`,(await f.panel.locator('textarea').inputValue())==='Unfinished words');
  await f.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});
  check(`${width}: return never rearms mic`,await f.page.evaluate(()=>recs.length===2&&recs.every(r=>!r.active)));
  check(`${width}: dock unchanged`,(await f.page.locator('.dock-label').allTextContents()).map(t=>t.replace(/\u00ad/g,'')).join('|')==='OPS|Caption Studio|Knowledge Graph|Google Drive|FareHarbor|Projects');
  check(`${width}: no runtime errors`,f.errors.length===0);await f.context.close();
 }
 {
  const f=await fixture({preview:true});await f.start();await f.finish();check('preview Send is gated',await f.panel.getByRole('button',{name:'Send',exact:true}).isDisabled());check('preview makes no TTS calls',!f.calls.some(c=>c.path==='/api/tts'));await f.context.close();
 }
 {
  const f=await fixture({recognition:false});await f.page.getByRole('button',{name:'Talk to Ember',exact:true}).click();check('unsupported recognition has readable fallback',await f.panel.innerText().then(t=>t.includes('Voice recognition is unavailable')));await f.context.close();
 }
 {
  const f=await fixture({wake:'deny'});await f.start();await f.panel.locator('[data-wake="unavailable"]').waitFor();check('wake denial does not block capture',await f.page.evaluate(()=>recs.at(-1).active));await f.context.close();
 }
 {
  const f=await fixture({wake:'pending'});await f.start();await f.panel.getByRole('button',{name:'Stop voice'}).click();await f.page.evaluate(()=>resolveWake());await f.page.waitForFunction(()=>wakes.length&&wakes.every(w=>w.released));check('late wake grant after Stop is released',true);await f.context.close();
 }
 {
  const f=await fixture();await f.start();await f.finish();f.mode('ttsFailure');await f.panel.getByRole('button',{name:'Send',exact:true}).click();await f.page.getByText(/Jenny’s speech service returned HTTP 502/).waitFor();
  check('failed TTS has no speaking animation',await f.page.locator('.brand-phrase').count()===0);
  const chats=f.calls.filter(c=>c.path==='/api/messages').length;f.mode('normal');await f.panel.getByRole('button',{name:'Read reply',exact:true}).click();await f.panel.locator('[data-phase="playing"]').waitFor();check('speech retry never resends chat',f.calls.filter(c=>c.path==='/api/messages').length===chats);await f.context.close();
 }
 for(const mode of ['chatPending','ttsPending']){
  const f=await fixture();await f.start();await f.finish();f.mode(mode);await f.panel.getByRole('button',{name:'Send',exact:true}).click();await f.panel.locator(`[data-phase="${mode==='chatPending'?'thinking':'preparing'}"]`).waitFor();await f.panel.getByRole('button',{name:'Stop voice'}).click();f.resolve();await f.page.waitForTimeout(150);
  check(`${mode}: cancelled response cannot start audio`,await f.panel.locator('audio').getAttribute('src')===null&&await f.page.locator('.brand-phrase').count()===0);await f.context.close();
 }
 {
  const f=await fixture();await f.page.evaluate(()=>window.recMode='unconfirmed');await f.start();await f.panel.getByRole('button',{name:'Stop voice'}).click();await f.panel.getByRole('button',{name:'I checked: mic indicator is off'}).waitFor();
  check('unconfirmed mic blocks sending',await f.panel.getByRole('button',{name:'Send',exact:true}).isDisabled());
  await f.panel.getByRole('button',{name:'I checked: mic indicator is off'}).click();check('physical confirmation releases gate',await f.panel.getByRole('button',{name:'Talk',exact:true}).isEnabled());await f.context.close();
 }
 {
  const f=await fixture({reduced:true});await f.start();await f.finish();f.mode('long');await f.panel.getByRole('button',{name:'Send',exact:true}).click();await f.panel.locator('[data-phase="playing"]').waitFor();
  check('long reply explicitly announces partial speech',(await f.panel.innerText()).includes('Speaking the first part only'));
  check('long reply retained in full',await f.page.locator('.home-thread [data-role="assistant"]').innerText().then(t=>t.length>1000));
  check('TTS respects 1000-character Worker cap',f.calls.find(c=>c.path==='/api/tts').body.text.length<=1000);
  check('reduced motion disables branding transform',await f.page.locator('.brand-phrase').evaluate(e=>getComputedStyle(e).animationName==='none'&&getComputedStyle(e).transform==='none'));
  await f.context.close();
 }
 {
  const f=await fixture();await f.page.evaluate(()=>recMode='denied');await f.page.getByRole('button',{name:'Talk to Ember',exact:true}).click();
  await f.page.getByText(/Microphone permission was denied/).waitFor();check('denied permission keeps actionable guidance after mic release',true);check('denied permission never sends text',!f.calls.some(c=>c.path==='/api/messages'));await f.context.close();
 }
 {
  const f=await fixture();await f.page.evaluate(()=>{window.realPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=()=>Promise.reject(new DOMException('Blocked','NotAllowedError'))});
  await f.start();await f.finish();await f.panel.getByRole('button',{name:'Send',exact:true}).click();await f.page.getByText(/Audio is ready. Tap Play/).waitFor();
  check('blocked autoplay retains native audio controls',await f.panel.locator('audio').isVisible());
  await f.page.evaluate(()=>{HTMLMediaElement.prototype.play=realPlay;document.querySelector('audio').play()});await f.panel.locator('[data-phase="playing"]').waitFor();check('explicit playback starts without another API request',f.calls.filter(c=>c.path==='/api/tts').length===1);await f.context.close();
 }
 {
  const f=await fixture();await f.start();await f.finish();await f.panel.getByRole('button',{name:'Send',exact:true}).click();await f.panel.locator('[data-phase="playing"]').waitFor();await f.end();
  for(let n=0;n<3;n++){await f.start();await f.finish('Repeated turn '+n);await f.panel.getByRole('button',{name:'Send',exact:true}).click();await f.panel.locator('[data-phase="playing"]').waitFor();await f.end()}
  check('four complete successive turns never capture over playback',await f.page.evaluate(()=>recs.length===4&&recs.every(r=>!r.active)));
  check('successive turns use exactly one speech request each',f.calls.filter(c=>c.path==='/api/tts').length===4);await f.context.close();
 }
 {
  const f=await fixture();await f.start();await f.page.evaluate(()=>say('A finished phrase'));await f.page.waitForTimeout(150);await f.page.evaluate(()=>say('Still talking',false));await f.page.waitForTimeout(850);
  check('interim speech cancels the pending phrase cutoff',await f.page.evaluate(()=>recs.at(-1).active));
  await f.page.evaluate(()=>say('Now finished'));await f.panel.locator('[data-phase="ready"]').waitFor();
  check('final phrase ends capture without auto-sending',await f.page.evaluate(()=>!recs.at(-1).active)&&!f.calls.some(c=>c.path==='/api/messages'));
  await f.start();await f.page.evaluate(()=>{say('Keep these words',false);window.lateResult=recs.at(-1).onresult});await f.panel.getByRole('button',{name:'Stop voice'}).click();await f.panel.locator('[data-phase="ready"]').waitFor();
  await f.page.evaluate(()=>{const r=[{transcript:'stale transcript'}];r.isFinal=true;lateResult({results:[r],resultIndex:0})});
  check('late recognition event cannot replace interrupted words',(await f.panel.locator('textarea').inputValue())==='Keep these words');
  await f.start();await f.page.evaluate(()=>say('and continue'));await f.panel.getByRole('button',{name:'Finish talking'}).click();await f.panel.locator('[data-phase="ready"]').waitFor();
  check('explicit continuation carries interrupted draft',(await f.panel.locator('textarea').inputValue())==='Keep these words and continue');
  await f.context.close();
 }
 {
  const f=await fixture();await f.start();await f.panel.getByRole('button',{name:'Close voice'}).click();
  check('closing voice releases capture and wake lock',await f.page.evaluate(()=>recs.every(r=>!r.active)&&wakes.every(w=>w.released)));
  check('closing returns keyboard focus to the mouth',await f.page.evaluate(()=>document.activeElement.classList.contains('reactor-stage')));
  await f.start();await f.page.locator('.console-dock').getByRole('button',{name:'Caption Studio',exact:true}).click();
  check('changing Ember workspace stops voice',await f.page.evaluate(()=>recs.every(r=>!r.active)&&wakes.every(w=>w.released)));await f.context.close();
 }
 console.log(`Foreground voice: ${checks} checks passed.`);
}finally{await browser.close()}
