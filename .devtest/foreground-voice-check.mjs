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
async function fixture({width=1440,height,prefs,preview=false,recognition=true,wake='ok',reduced=false}={}){
 const context=await browser.newContext({viewport:{width,height:height||(width<600?844:1000)},deviceScaleFactor:width<600?3:1,reducedMotion:reduced?'reduce':'no-preference'});
 const page=await context.newPage(),calls=[],errors=[];let mode='normal',pending=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({recognition,wake,prefs})=>{
  if(prefs)localStorage.setItem("ember-prefs",JSON.stringify(prefs));
  window.recs=[];window.recMode='normal';window.wakes=[];window.wakeMode=wake;
  class Rec {
   start(){this.active=true;recs.push(this);if(recMode==='denied')setTimeout(()=>this.onerror?.({error:'not-allowed'}),0);else if(recMode!=='pending')setTimeout(()=>{this.onstart?.();const dead=window.deadAudio>0&&recs.length>1;if(dead)window.deadAudio--;else if(window.audioStart)this.onaudiostart?.()},0)}
   stop(){if(recMode!=='unconfirmed'){this.active=false;setTimeout(()=>this.onend?.(),window.recEndDelay||0)}}
   abort(){this.stop()}
  }
  window.SpeechRecognition=recognition?Rec:undefined;window.webkitSpeechRecognition=undefined;
  window.say=(text,final=true)=>{const r=recs.at(-1),v=[{transcript:text}];v.isFinal=final;r.onresult?.({results:[v],resultIndex:0})};
  Object.defineProperty(navigator,'wakeLock',{value:{request:async()=>{if(wakeMode==='deny')throw Error('denied');if(wakeMode==='pending')await new Promise(r=>window.resolveWake=r);const lock=new EventTarget();lock.released=false;lock.release=async()=>{lock.released=true;lock.dispatchEvent(new Event('release'))};wakes.push(lock);return lock}}});
  Object.defineProperty(navigator,'audioSession',{value:Object.assign(new EventTarget(),{type:'auto',state:'active'})});
 },{recognition,wake,prefs});
 const origin=preview?'https://voice-check.baxstar-ember.pages.dev':'https://ember.baxstarfishing.com';
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname.startsWith('/api/')){
   const body=route.request().postDataJSON();calls.push({path:u.pathname,body});
   if(u.pathname==='/api/connectors/status')return route.fulfill({json:{connectors:{}}});
   if(u.pathname==='/api/weather')return route.fulfill({json:{place:'Detroit Lakes, MN',source:'National Weather Service',fetchedAt:new Date().toISOString(),periods:[{name:'Today',day:true,temp:41,unit:'F',wind:'SSE 7 to 10 mph',pop:0,short:'Mostly Sunny',detail:'Mostly sunny. High near 41.'}],hours:[],alertsChecked:true,alerts:[]}});
   if((mode==='chatPending'&&u.pathname==='/api/messages')||(mode==='ttsPending'&&u.pathname==='/api/tts'))await new Promise(r=>pending.push(r));
   if(u.pathname==='/api/tts'){
    if(mode==='elevenUnavailable'&&body.voice==='elevenlabs')return route.fulfill({status:503,json:{error:'ElevenLabs unavailable'}});
    const headers=body.voice==='elevenlabs'?{'X-Ember-TTS-Provider':'elevenlabs'}:{};
    return route.fulfill(mode==='ttsFailure'?{status:502,json:{error:'provider-refused'}}:{contentType:'audio/wav',headers,body:wav}).catch(()=>{});
   }
   const q=body.messages?.at(-1)?.content||'';
   const text=/ONLY valid JSON/.test(q)?'{"voicemails":[],"emails":[],"events":[]}':mode==='long'?'This is the complete long reply. '.repeat(45):mode==='hourly'?'Next 12 hours: 9 AM 32° S 7 mph 0%; 10 AM 35° S 8 mph 0%; 11 AM 37° S 9 mph 0%; 12 PM 39° S 10 mph 0%; 1 PM 41° S 10 mph 0%; 2 PM 42° S 12 mph 5%; 3 PM 41° S 12 mph 5%; 4 PM 40° S 11 mph 5%; 5 PM 37° S 10 mph 5%; 6 PM 35° S 9 mph 5%; 7 PM 33° S 8 mph 10%; 8 PM 30° S 6 mph 10%.':mode==='claim'?"Sarah wanted to move Saturday's charter to 9. She said so in her voicemail. She would like a call back today. She also asked about the pontoon. She sounded happy.":'Your voice is connected. The boat is ready, and your next trip is on the calendar.';
   // A verified lookup: the live-data guard requires a real connector result.
   const tools=/ONLY valid JSON/.test(q)||mode==='noTool'||mode==='claim'?[]:[{type:'mcp_tool_use',id:'t1',name:'list_events',server_name:'calendar'},{type:'mcp_tool_result',tool_use_id:'t1',is_error:false,content:[]}];
   return route.fulfill({json:{model:body.model,content:[...tools,{type:'text',text}],stop_reason:'end_turn'}}).catch(()=>{});
  }
  const rel=u.pathname==='/'?'index.html':u.pathname.slice(1),file=path.resolve(root,rel);
  if(!file.startsWith(root+path.sep))return route.abort();
  try {await route.fulfill({path:file})}catch{await route.abort()}
 });
 await page.goto(origin);await page.getByRole('textbox',{name:'Ask Ember'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.chat-controls button[aria-pressed="true"]'));
 const panel=page.getByRole('region',{name:'Ember voice controls'});
 const start=async()=>{await page.getByRole('button',{name:'Talk to Ember',exact:true}).click();await page.locator('[data-voice-phase="listening"]').waitFor()};
 const finish=async(text='Check my next trip.',final=true)=>{await page.evaluate(([t,f])=>say(t,f),[text,final]);await panel.getByRole('button',{name:'Stop voice'}).click();await page.locator('.foreground-voice [data-phase="ready"]').waitFor({state:'attached'})};
 const ask=async(text='Check my next trip.')=>{await page.evaluate(t=>say(t),text)};
 return {page,context,panel,calls,errors,start,finish,ask,mode:v=>mode=v,resolve:()=>{pending.splice(0).forEach(r=>r())},async end(){await page.locator('audio[aria-label="Ember reply"]').evaluate(a=>a.currentTime=a.duration-.05);await page.locator('.foreground-voice [data-phase="ready"]').waitFor({state:'attached'})}};
}
try{
 for (const width of [1440, 390]) {
  const f = await fixture({ width });
  const voice = f.page.getByRole('combobox', { name: 'Spoken voice', exact: true });
  const speechCalls = () => f.calls.filter(call => call.path === '/api/tts');
  const aria = 'en-US-AriaNeural';
  check(`${width}: Aria is the default spoken voice`, await voice.inputValue() === aria);
  await voice.selectOption('elevenlabs');
  await f.page.reload();
  await f.page.waitForFunction(() => document.querySelector('select[aria-label="Spoken voice"]')?.value === 'elevenlabs');
  check(`${width}: selecting and restoring ElevenLabs does not synthesize audio`, speechCalls().length === 0);
  await f.start();
  check(`${width}: the voice selection is locked during capture`, await voice.isDisabled());
  await f.ask();
  await f.panel.locator('[data-phase="playing"]').waitFor();
  check(`${width}: spoken turn uses the saved ElevenLabs selection`, speechCalls().length === 1 && speechCalls()[0].body.voice === 'elevenlabs');
  await f.panel.getByRole('button', { name: 'Stop voice' }).click();
  await voice.selectOption(aria);
  await f.panel.getByRole('button', { name: 'Read reply', exact: true }).click();
  await f.panel.locator('[data-phase="playing"]').waitFor();
  const calls = speechCalls();
  check(`${width}: replaying the same reply after switching to Aria requests fresh Aria audio`, calls.length === 2 && calls[1].body.voice === aria && calls[1].body.text === calls[0].body.text);
  await f.context.close();
 }
 {
  const f = await fixture();
  const voice = f.page.getByRole('combobox', { name: 'Spoken voice', exact: true });
  await voice.selectOption('elevenlabs');
  f.mode('elevenUnavailable');
  await f.start();
  await f.ask();
  await f.panel.getByText(/ElevenLabs is unavailable\. Choose Aria/).waitFor();
  const messages = f.calls.filter(call => call.path === '/api/messages').length;
  await voice.selectOption('en-US-AriaNeural');
  await f.panel.getByRole('button', { name: 'Read reply', exact: true }).click();
  await f.panel.locator('[data-phase="playing"]').waitFor();
  const voices = f.calls.filter(call => call.path === '/api/tts').map(call => call.body.voice);
  check('after ElevenLabs is unavailable, Aria can read the existing answer', voices.join(',') === 'elevenlabs,en-US-AriaNeural' && f.calls.filter(call => call.path === '/api/messages').length === messages);
  await f.context.close();
 }
 for(const action of ['stop','hide']){
  const f=await fixture();await f.page.evaluate(()=>{window.audioStart=true;window.deadAudio=1});await f.start();await f.ask('First turn');
  await f.panel.locator('[data-phase="playing"]').waitFor();await f.panel.locator('audio').evaluate(a=>a.currentTime=a.duration-.05);
  await f.page.waitForFunction(()=>recs.length===2&&recs[1].active);
  await f.page.evaluate(()=>window.recEndDelay=700);await f.panel.locator('[data-phase="releasing"]').waitFor();
  if(action==='stop')await f.panel.getByRole('button',{name:'Stop voice'}).click();
  else await f.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
  await f.page.waitForTimeout(2500);
  if(action==='hide')await f.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});
  await f.page.waitForTimeout(300);
  check(`${action} during a delayed microphone retry never reopens capture`,await f.page.evaluate(()=>recs.length===2&&recs.every(r=>!r.active)));
  await f.context.close();
 }
 {
  const f=await fixture();await f.start();await f.ask('One answer');await f.panel.locator('[data-phase="playing"]').waitFor();
  await f.page.evaluate(()=>{const t=document.createElement('textarea');t.id='voice-key-fixture';t.style='position:fixed;top:0;left:0;z-index:9999';document.body.append(t)});
  await f.page.locator('#voice-key-fixture').fill('draft');await f.page.locator('#voice-key-fixture').press('Space');await f.page.locator('#voice-key-fixture').press('Escape');
  check('voice keyboard shortcuts leave text editing alone',(await f.page.locator('#voice-key-fixture').inputValue())==='draft '&&await f.panel.locator('[data-phase="playing"]').count()===1);
  await f.page.locator('#voice-key-fixture').evaluate(t=>t.remove());
  await f.page.evaluate(()=>{document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,repeat:true}));document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,ctrlKey:true}))});
  check('held keys and modified shortcuts do not interrupt voice',await f.panel.locator('[data-phase="playing"]').count()===1);
  await f.page.locator('body').click({position:{x:1,y:1}});await f.page.keyboard.press('Space');
  await f.panel.locator('[data-phase="listening"]').waitFor({timeout:4000});
  check('Space cuts off the reply and opens one listening turn',await f.page.evaluate(()=>recs.length===2&&recs[1].active&&document.querySelector('audio').paused));
  await f.page.getByRole('button',{name:'Talk to Ember',exact:true}).focus();await f.page.keyboard.press('Escape');await f.panel.locator('[data-phase="ready"]').waitFor({state:'attached'});await f.page.waitForTimeout(1000);
  check('Escape stops voice from the focused mouth without restarting',await f.page.evaluate(()=>recs.length===2&&recs.every(r=>!r.active)));
  await f.context.close();
 }
 if(!process.env.EMBER_HARDENING_ONLY){
 for(const [width,command] of [[1440,'Stop.'],[390,'STOP LISTENING!'],[390,'Ember, stop.']]){
  const f=await fixture({width});await f.start();
  await f.page.evaluate(t=>{window.lateStopResult=recs.at(-1).onresult;say(t)},command);
  await f.panel.locator('[data-phase="ready"]').waitFor();
  await f.page.evaluate(()=>{const v=[{transcript:'stale words after stop'}];v.isFinal=true;lateStopResult({results:[v],resultIndex:0});document.querySelector('audio').dispatchEvent(new Event('ended'))});
  await f.page.waitForTimeout(1300);
  check(`${width} ${command}: releases mic and never rearms`,await f.page.evaluate(()=>recs.length===1&&recs.every(r=>!r.active)&&wakes.every(w=>w.released)));
  check(`${width} ${command}: no model or speech request`,!f.calls.some(c=>['/api/messages','/api/tts'].includes(c.path)));
  check(`${width} ${command}: command and stale result stay out of chat/draft`,(await f.page.locator('[aria-label="Ask Ember"]').inputValue())===''&&!(await f.page.locator('.home-thread').allTextContents()).join(' ').includes(command));
  check(`${width} ${command}: visibly stopped`,(await f.panel.innerText()).includes('Voice stopped. Tap the mouth to talk again.'));
  await f.start();await f.ask('A new question');await f.panel.locator('[data-phase="playing"]').waitFor();
  check(`${width} ${command}: a new explicit tap still works`,f.calls.some(c=>c.path==='/api/messages'&&c.body.messages.at(-1)?.content==='A new question'));
  check(`${width} ${command}: no runtime errors`,f.errors.length===0);await f.context.close();
 }
 {
  const f=await fixture();await f.start();await f.page.evaluate(()=>say('Stop',false));await f.page.waitForTimeout(1300);
  check('provisional Stop does not cut off a continuing sentence',await f.page.evaluate(()=>recs.at(-1).active)&&!f.calls.some(c=>c.path==='/api/messages'));
  await f.ask('Stop by the marina on the way home.');await f.panel.locator('[data-phase="playing"]').waitFor();
  check('a normal sentence containing stop is sent normally',f.calls.some(c=>c.path==='/api/messages'&&c.body.messages.at(-1)?.content==='Stop by the marina on the way home.'));
  await f.panel.getByRole('button',{name:'Close voice'}).click();
  await f.page.getByRole('textbox',{name:'Ask Ember'}).fill('stop');await f.page.getByRole('textbox',{name:'Ask Ember'}).press('Enter');
  await f.page.waitForFunction(()=>Array.from(document.querySelectorAll('.home-thread [data-role="user"]')).some(e=>e.textContent.startsWith('stop')));
  check('typed stop remains a normal text message',f.calls.some(c=>c.path==='/api/messages'&&c.body.messages.at(-1)?.content==='stop'));
  await f.context.close();
 }
 {
  const f=await fixture();await f.start();
  await f.page.evaluate(()=>{say('Keep my unfinished question.',true);const results=['Keep my unfinished question.','Stop.'].map(transcript=>Object.assign([{transcript}],{isFinal:true}));recs.at(-1).onresult({results,resultIndex:1})});
  await f.page.waitForFunction(()=>document.querySelector('[aria-label="Ask Ember"]').value==='Keep my unfinished question.');
  await f.page.waitForTimeout(1300);
  check('standalone stop after dictation cancels its pending send',!f.calls.some(c=>['/api/messages','/api/tts'].includes(c.path))&&await f.page.evaluate(()=>recs.every(r=>!r.active)));
  check('preceding dictation stays editable without the command',(await f.page.getByRole('textbox',{name:'Ask Ember'}).inputValue())==='Keep my unfinished question.');
  await f.context.close();
 }
 {
  const f=await fixture();await f.page.evaluate(()=>window.recMode='unconfirmed');await f.start();await f.ask('Stop listening');
  await f.panel.getByRole('button',{name:'I checked: mic indicator is off'}).waitFor();
  check('spoken stop preserves the unconfirmed mic release gate',await f.panel.getByRole('button',{name:'Talk',exact:true}).isDisabled()&&!f.calls.some(c=>c.path==='/api/messages'));
  await f.page.evaluate(()=>{recs.at(-1).active=false;recs.at(-1).onend()});await f.panel.locator('[data-phase="ready"]').waitFor();
  check('late mic release after spoken stop never auto-sends',!f.calls.some(c=>['/api/messages','/api/tts'].includes(c.path)));
  await f.context.close();
 }
 for(const prefs of [{v:4,chatModel:'claude-sonnet-5-5',chatEffort:'medium'},{v:5,chatModel:'claude-sonnet-5-5',chatEffort:'low'}]){
  const f=await fixture({prefs});const labels=await f.page.locator('.chat-controls button[aria-pressed="true"]').allTextContents();
  check(`preferences v${prefs.v}: requested migration or later override persists`,labels.join('|')===(prefs.v===4?'Opus|High':'Sonnet|Low'));await f.context.close();
 }
 {
  const f=await fixture();await f.start();await f.page.evaluate(()=>{say('unfinished',false);recs.at(-1).onend()});await f.page.locator('.foreground-voice [data-phase="ready"]').waitFor({state:'attached'});
  check('unfinished natural recognition end never auto-sends',!f.calls.some(c=>c.path==='/api/messages'));await f.context.close();
 }
 {
  const f=await fixture();await f.start();f.mode('chatPending');await f.page.evaluate(()=>say('Cancel my question'));await f.panel.locator('[data-phase="thinking"]').waitFor();await f.panel.getByRole('button',{name:'Stop voice'}).click();f.resolve();await f.page.waitForTimeout(600);
  check('Stop during automatic answer prevents speech and rearming',!f.calls.some(c=>c.path==='/api/tts')&&await f.page.evaluate(()=>recs.length===1&&recs.every(r=>!r.active)));await f.context.close();
 }
 {
  const f=await fixture();await f.start();await f.page.evaluate(()=>say('One answer'));await f.panel.locator('[data-phase="playing"]').waitFor();await f.panel.getByRole('button',{name:'Stop voice'}).click();await f.panel.locator('audio').evaluate(a=>a.dispatchEvent(new Event('ended')));await f.page.waitForTimeout(650);
  check('late ended event after Stop cannot restart the microphone',await f.page.evaluate(()=>recs.length===1&&recs.every(r=>!r.active)));await f.context.close();
 }

 for(const width of [1440,390]){
  const f=await fixture({width});await f.start();
  for(let n=0;n<3;n++){
   await f.page.evaluate(n=>say('Automatic turn '+n),n);
   await f.panel.locator('[data-phase="playing"]').waitFor();
   check(`${width}: automatic turn ${n+1} speaks without Send`,f.calls.filter(c=>c.path==='/api/tts').length===n+1);
   check(`${width}: no listening over Aria`,await f.page.evaluate(()=>recs.every(r=>!r.active)));
   await f.page.locator('audio').evaluate(a=>a.currentTime=a.duration-.05);
   await f.panel.locator('[data-phase="listening"]').waitFor();
  }
  check(`${width}: one mouth tap supports three conversation turns`,await f.page.evaluate(()=>recs.length===4));
  await f.panel.getByRole('button',{name:'Close voice'}).click();
  const spoken=f.calls.filter(c=>c.path==='/api/tts').length;
  await f.page.getByRole('textbox',{name:'Ask Ember'}).fill('Typed question');await f.page.getByRole('textbox',{name:'Ask Ember'}).press('Enter');
  await f.page.waitForTimeout(400);
  check(`${width}: typed chat stops the conversation and stays text-only`,f.calls.filter(c=>c.path==='/api/tts').length===spoken&&await f.page.evaluate(()=>recs.every(r=>!r.active)));
  await f.context.close();
 }

 for(const [width,height] of [[1024,700],[1100,640],[1280,720],[1440,900],[1920,1080]]){
  const f=await fixture({width,height});
  const geometry=()=>f.page.evaluate(()=>{const w=document.querySelector('.conversation-workspace'),r=document.querySelector('.reactor-stage').getBoundingClientRect(),d=document.querySelector('.console-dock').getBoundingClientRect(),t=document.querySelector('.tools-rail').getBoundingClientRect();return {scroll:document.documentElement.scrollHeight-innerHeight,workspaceOverflow:w.scrollHeight-w.clientHeight,skull:r.width,bottom:r.bottom,dock:d.top,tools:t.bottom}});
  const initial=await geometry();
  check(`${width} desktop fits without page scrolling`,initial.scroll<=1&&initial.tools<=initial.dock);
  await f.start();await f.ask();await f.panel.locator('[data-phase="playing"]').waitFor();
  const active=await geometry();await f.page.waitForTimeout(1600);await f.page.screenshot({path:`/tmp/ember-fit-${width}.png`});
  check(`${width} voice controls fit and skull stays stable`,active.scroll<=1&&active.workspaceOverflow<=1&&Math.abs(active.skull-initial.skull)<1&&active.bottom<=active.dock);
  await f.context.close();
 }

 for(const width of [1440,390]){
  const f=await fixture({width});const hero=f.page.locator('.reactor-stage');const before=await hero.boundingBox();
  check(`${width}: mic never starts on load`,await f.page.evaluate(()=>recs.length===0));
  await f.start();check(`${width}: explicit mouth tap starts one session`,await f.page.evaluate(()=>recs.length===1));
  await f.panel.locator('[data-wake="held"]').waitFor();await f.ask();await f.panel.locator('[data-phase="playing"]').waitFor();
  check(`${width}: capture ends before Aria speaks`,await f.page.evaluate(()=>recs.every(r=>!r.active)));
  check(`${width}: the panel has no review box, Send or Type instead`,await f.panel.locator('textarea').count()===0&&await f.panel.getByRole('button',{name:/^(Send|Type instead)$/}).count()===0);
  check(`${width}: spoken turn keeps the selected Opus model at Fast-replies Low effort`,f.calls.some(c=>c.path==='/api/messages'&&c.body.model==='claude-opus-5-5'&&c.body.output_config?.effort==='low'&&c.body.max_tokens===4000&&c.body.messages[0]?.content.includes('Effort: LOW')&&!c.body.messages[0]?.content.includes('Effort: HIGH')&&c.body.messages.at(-1)?.content==='Check my next trip.'));
  check(`${width}: Aria uses tested endpoint`,f.calls.some(c=>c.path==='/api/tts'&&c.body.voice==='en-US-AriaNeural'));
  check(`${width}: default Aria turn uses no alternate voice endpoint`,!f.calls.some(c=>c.path.includes('/voice/')&&c.path!=='/api/voice/trace'));
  check(`${width}: reply reaches persistent normal conversation`,await f.page.locator('.home-thread [data-role="assistant"]').innerText().then(t=>t.includes('Your voice is connected')));
  const after=await hero.boundingBox();check(`${width}: skull does not shrink after reply`,Math.abs(before.width-after.width)<1&&after.width>250);
  check(`${width}: transcript remains bounded`,await f.page.locator('.home-thread').evaluate(e=>e.clientHeight>=90&&e.clientHeight<=180));
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
  check(`${width}: stop clears audio but preserves words`,await f.panel.locator('audio').getAttribute('src')===null&&(await f.page.locator('.home-thread').innerText()).includes('next trip'));
  await f.start();await f.page.evaluate(()=>say('Unfinished words',false));await f.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
  await f.page.locator('.foreground-voice [data-phase="ready"]').waitFor({state:'attached'});
  check(`${width}: interruption puts received words in the Ask Ember box`,(await f.page.getByRole('textbox',{name:'Ask Ember'}).inputValue())==='Unfinished words');
  await f.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});
  check(`${width}: return never rearms mic`,await f.page.evaluate(()=>recs.length===2&&recs.every(r=>!r.active)));
  check(`${width}: dock unchanged`,(await f.page.locator('.dock-label').allTextContents()).map(t=>t.replace(/\u00ad/g,'')).join('|')==='OPS|Caption Studio|Knowledge Graph|Google Drive|FareHarbor|Projects');
  check(`${width}: no runtime errors`,f.errors.length===0);await f.context.close();
 }
 {
  // Fast replies is the default for spoken turns only; typed chat keeps Brady's Model/Effort.
  const f=await fixture({prefs:{v:5,chatModel:'claude-opus-5-5',chatEffort:'high'}});
  await f.page.getByRole('textbox',{name:'Ask Ember'}).fill('Typed question');await f.page.getByRole('textbox',{name:'Ask Ember'}).press('Enter');
  await f.page.waitForFunction(()=>document.querySelector('.home-thread [data-role="assistant"]')?.innerText.includes('Your voice is connected'));
  check('typed chat keeps selected Opus/High while Fast replies is on',f.calls.some(c=>c.path==='/api/messages'&&c.body.output_config?.effort==='high'&&c.body.max_tokens===12000&&c.body.messages.at(-1)?.content==='Typed question'));
  const toggle=f.page.getByRole('button',{name:/Fast replies/});
  check('Fast replies is visible and enabled before opening voice',await toggle.isVisible()&&await toggle.isEnabled());
  check('Fast replies defaults on',await toggle.getAttribute('aria-pressed')==='true');
  await f.start();
  check('Fast replies cannot change mid-capture',await toggle.isDisabled());
  await f.panel.getByRole('button',{name:'Stop voice'}).click();await f.page.locator('.foreground-voice [data-phase="ready"]').waitFor({state:'attached'});await toggle.click();
  check('Fast replies toggles off',await toggle.getAttribute('aria-pressed')==='false');
  await f.page.waitForFunction(()=>JSON.parse(localStorage.getItem('ember-prefs')||'{}').voiceFast===false);check('Fast replies choice persists',true);
  await f.start();await f.ask();await f.panel.locator('[data-phase="playing"]').waitFor();
  check('Fast replies off: spoken turn uses the selected Opus/High',f.calls.some(c=>c.path==='/api/messages'&&c.body.model==='claude-opus-5-5'&&c.body.output_config?.effort==='high'&&c.body.messages.at(-1)?.content==='Check my next trip.'));
  check('Fast replies toggle adds no runtime errors',f.errors.length===0);await f.context.close();
 }
 {
  const f=await fixture({prefs:{v:5,chatModel:'claude-sonnet-5-5',chatEffort:'medium',voiceFast:false}});
  await f.start();check('saved Fast replies off is restored',await f.page.getByRole('button',{name:/Fast replies/}).getAttribute('aria-pressed')==='false');await f.context.close();
 }
 {
  // Second-turn mic check (2026-11-11): an automatic turn whose mic the phone never opens.
  const f=await fixture();await f.page.evaluate(()=>{window.audioStart=true;window.deadAudio=2});
  await f.start();await f.page.evaluate(()=>say('First question'));await f.panel.locator('[data-phase="playing"]').waitFor();await f.end();
  await f.page.getByText(/Reopening the microphone/).waitFor();check('dead re-armed mic gets one quiet retry',await f.page.evaluate(()=>recs.length===2&&!recs[1].active));
  await f.page.getByText(/didn’t reopen the microphone after Aria spoke/).waitFor({timeout:15000});
  check('second dead re-arm pauses with a tap-the-mouth note',await f.page.evaluate(()=>recs.length===3&&recs.every(r=>!r.active)));
  check('dead re-arm never shows LISTENING',await f.page.locator('[data-voice-phase="listening"]').count()===0);
  check('dead re-arm sends nothing',f.calls.filter(c=>c.path==='/api/messages'&&!/ONLY valid JSON/.test(c.body.messages?.at(-1)?.content||'')).length===1);
  check('dead re-arm releases the screen lock',await f.page.evaluate(()=>wakes.every(w=>w.released)));
  await f.start();check('a tap after the pause starts a normal turn',await f.page.evaluate(()=>recs.length===4&&recs[3].active));
  check('second-turn check adds no runtime errors',f.errors.length===0);await f.context.close();
 }
 {
  const f=await fixture();await f.page.evaluate(()=>{window.audioStart=true;window.deadAudio=1});
  await f.start();await f.page.evaluate(()=>say('First question'));await f.panel.locator('[data-phase="playing"]').waitFor();await f.end();
  await f.page.getByText(/Reopening the microphone/).waitFor();await f.page.waitForFunction(()=>recs.length===3&&recs[2].active);await f.page.locator('[data-voice-phase="listening"]').waitFor();
  await f.page.evaluate(()=>say('Second question'));await f.panel.locator('[data-phase="playing"]').waitFor();
  check('a successful retry carries the conversation to the next reply',f.calls.some(c=>c.path==='/api/messages'&&c.body.messages?.at(-1)?.content==='Second question'));await f.context.close();
 }
 {
  const f=await fixture();await f.page.evaluate(()=>{window.audioStart=true});
  await f.start();await f.page.evaluate(()=>say('First question'));await f.panel.locator('[data-phase="playing"]').waitFor();await f.end();
  await f.page.waitForFunction(()=>recs.length===2&&recs[1].active);await f.page.locator('[data-voice-phase="listening"]').waitFor();
  check('a re-armed mic that opens keeps listening past the audio check',await (async()=>{await f.page.waitForTimeout(3000);return f.page.evaluate(()=>recs[1].active)})());
  await f.page.getByText(/I didn’t hear anything. Listening again/).waitFor({timeout:15000});
  check('a silent re-armed turn gets one fresh recognizer after a gap',await f.page.evaluate(()=>recs.length===2&&recs.every(r=>!r.active)));
  await f.page.waitForFunction(()=>recs.length===3&&recs[2].active,null,{timeout:6000});
  check('the fresh retry is reported as a deaf retry',await f.page.evaluate(()=>emberVoiceTraces.at(-1).outcome==='no-words-retry'));
  await f.page.getByText(/Paused: no words heard/).waitFor({timeout:15000});
  check('a second silent turn pauses instead of listening for 30 s',await f.page.evaluate(()=>recs.length===3&&recs.every(r=>!r.active))&&await f.page.locator('[data-voice-phase="listening"]').count()===0);
  check('the pause is reported with its trigger',await f.page.evaluate(()=>{const t=emberVoiceTraces.at(-1);return t.outcome==='no-words'&&t.trigger==='deaf-retry'&&t.marks.onstart>=0}));
  check('traces reach the self-report route on production',f.calls.filter(c=>c.path==='/api/voice/trace').length>=3);await f.context.close();
 }
 {
  // A spoken weather question waits for the forecast and carries the voice-only weather rule.
  const f=await fixture();await f.start();await f.ask("What's the weather?");await f.panel.locator('[data-phase="playing"]').waitFor();
  const turn=f.calls.find(c=>c.path==='/api/messages'&&c.body.messages?.at(-1)?.content==="What's the weather?");
  check('a spoken weather question carries the forecast',turn?.body.messages[0].content.includes('LIVE WEATHER: National Weather Service forecast for Detroit Lakes, MN'));
  check('a spoken weather question carries the voice-only weather rule',turn?.body.messages[0].content.includes('Weather by voice: answer the question asked in one or two short sentences, leading with any active alert.'));
  check('the spoken prompt says where Aria stops',turn?.body.messages[0].content.includes('Aria stops speaking after 4 sentences or 3 times of day'));
  await f.context.close();
 }
 {
  // "Keep going" reads the next part of a shortened reply with no new model request.
  const f=await fixture();await f.start();f.mode('long');await f.ask('Tell me everything.');await f.panel.locator('[data-phase="playing"]').waitFor();
  const asks=()=>f.calls.filter(c=>c.path==='/api/messages'&&!/ONLY valid JSON/.test(c.body.messages?.at(-1)?.content||'')).length;
  const before=asks(),ttsBefore=f.calls.filter(c=>c.path==='/api/tts').length;
  await f.end();await f.page.waitForFunction(()=>recs.length===2&&recs[1].active,null,{timeout:10000});await f.page.locator('[data-voice-phase="listening"]').waitFor();
  await f.page.evaluate(()=>say('Keep going.'));
  await f.page.waitForFunction(()=>document.querySelector('[data-phase="playing"]'),null,{timeout:10000});
  const next=f.calls.filter(c=>c.path==='/api/tts').slice(ttsBefore);
  check('"keep going" sends no new model request',asks()===before);
  check('"keep going" speaks the next 4 sentences',next.length===1&&next[0].body.text==='This is the complete long reply. '.repeat(4).trim());
  check('"keep going" adds no runtime errors',f.errors.length===0);await f.context.close();
 }
 {
  // After Stop, an old reply's leftover is gone: "keep going" asks the model again.
  const f=await fixture();await f.start();f.mode('long');await f.ask('Tell me everything.');await f.panel.locator('[data-phase="playing"]').waitFor();
  const asks=()=>f.calls.filter(c=>c.path==='/api/messages'&&!/ONLY valid JSON/.test(c.body.messages?.at(-1)?.content||''));
  await f.panel.getByRole('button',{name:'Stop voice'}).click();await f.panel.locator('[data-phase="ready"]').waitFor();
  f.mode('normal');await f.start();await f.ask('Keep going.');await f.panel.locator('[data-phase="playing"]').waitFor();
  check('after Stop, "keep going" is a new question, not an old leftover',asks().length===2&&asks()[1].body.messages.at(-1).content==='Keep going.');
  await f.context.close();
 }
 {
  // The live-data guard's warning is never cut by the spoken cap.
  const f=await fixture();await f.start();f.mode('claim');await f.ask('What did Sarah want?');await f.panel.locator('[data-phase="playing"]').waitFor();
  const said=f.calls.filter(c=>c.path==='/api/tts').map(c=>c.body.text).join(' ');
  check("a capped unverified reply still speaks the \"didn't check\" warning",said.includes("I didn't check your live calendar, email or calls for that, so don't rely on it. Ask me to look it up."));
  check('the warning follows the kept part of the answer',said.startsWith("Sarah wanted to move Saturday's charter to 9.")&&!said.includes('She sounded happy.'));
  await f.context.close();
 }
 {
  // An hour-by-hour list written as one sentence stops at 3 times of day.
  const f=await fixture();await f.start();f.mode('hourly');await f.ask('Give me the hourly forecast.');await f.panel.locator('[data-phase="playing"]').waitFor();
  const said=f.calls.filter(c=>c.path==='/api/tts').map(c=>c.body.text).join(' ');
  const times=(said.match(/\b\d{1,2}(?::\d{2})?\s?[AP]M\b/g)||[]).length;
  check('a one-sentence 12-hour list is spoken only to its 3rd hour',times===3&&said.startsWith('Next 12 hours: 9 AM 32°')&&said.endsWith('…'));
  check('the panel says a short version was spoken',(await f.panel.innerText()).includes('Short version spoken'));
  await f.context.close();
 }
 {
  const f=await fixture({preview:true});await f.start();await f.finish();check('preview sends nothing and keeps the words in the Ask Ember box',!f.calls.some(c=>c.path==='/api/messages'&&!/ONLY valid JSON/.test(c.body.messages?.at(-1)?.content||''))&&(await f.page.getByRole('textbox',{name:'Ask Ember'}).inputValue()).includes('next trip'));check('preview makes no TTS calls',!f.calls.some(c=>c.path==='/api/tts'));await f.context.close();
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
  const f=await fixture();await f.start();f.mode('ttsFailure');await f.ask();await f.page.getByText(/Aria’s speech service returned HTTP 502/).waitFor();
  check('failed TTS has no speaking animation',await f.page.locator('.brand-phrase').count()===0);
  const chats=f.calls.filter(c=>c.path==='/api/messages').length;f.mode('normal');await f.panel.getByRole('button',{name:'Read reply',exact:true}).click();await f.panel.locator('[data-phase="playing"]').waitFor();check('speech retry never resends chat',f.calls.filter(c=>c.path==='/api/messages').length===chats);await f.context.close();
 }
 for(const mode of ['chatPending','ttsPending']){
  const f=await fixture();await f.start();f.mode(mode);await f.ask();await f.panel.locator(`[data-phase="${mode==='chatPending'?'thinking':'preparing'}"]`).waitFor();await f.panel.getByRole('button',{name:'Stop voice'}).click();f.resolve();await f.page.waitForTimeout(150);
  check(`${mode}: cancelled response cannot start audio`,await f.panel.locator('audio').getAttribute('src')===null&&await f.page.locator('.brand-phrase').count()===0);await f.context.close();
 }
 {
  const f=await fixture();await f.page.evaluate(()=>window.recMode='unconfirmed');await f.start();await f.panel.getByRole('button',{name:'Stop voice'}).click();await f.panel.getByRole('button',{name:'I checked: mic indicator is off'}).waitFor();
  check('unconfirmed mic sends nothing',!f.calls.some(c=>c.path==='/api/messages'&&!/ONLY valid JSON/.test(c.body.messages?.at(-1)?.content||'')));
  await f.panel.getByRole('button',{name:'I checked: mic indicator is off'}).click();check('physical confirmation releases gate',await f.panel.getByRole('button',{name:'Talk',exact:true}).isEnabled());await f.context.close();
 }
 {
  const f=await fixture({reduced:true});await f.start();f.mode('long');await f.ask();await f.panel.locator('[data-phase="playing"]').waitFor();
  check('long spoken reply says it spoke the short version',(await f.panel.innerText()).includes('Short version spoken'));
  check('long reply retained in full',await f.page.locator('.home-thread [data-role="assistant"]').innerText().then(t=>t.length>1000));
  // Hard spoken cap (2026-11-14): a conversation turn speaks at most 3 sentences / 420 characters.
  const spokenTurn=f.calls.find(c=>c.path==='/api/tts').body.text;
  check('a spoken turn stops after 4 sentences',spokenTurn==='This is the complete long reply. '.repeat(4).trim());
  check('a spoken turn never exceeds 420 characters',f.calls.filter(c=>c.path==='/api/tts').every(c=>c.body.text.length<=420));
  check('reduced motion disables branding transform',await f.page.locator('.brand-phrase').evaluate(e=>getComputedStyle(e).animationName==='none'&&getComputedStyle(e).transform==='none'));
  await f.panel.getByRole('button',{name:'Stop voice'}).click();await f.panel.getByRole('button',{name:'Read first part',exact:true}).click();await f.panel.locator('[data-phase="playing"]').waitFor();
  const replay=f.calls.filter(c=>c.path==='/api/tts').at(-1).body.text;
  check('an explicit Read reply still reads up to the 1000-character limit',replay.length>420&&replay.length<=1000);
  check('an explicit Read reply never reuses the shortened audio',f.calls.filter(c=>c.path==='/api/tts').length===2);
  await f.context.close();
 }
 {
  const f=await fixture();await f.page.evaluate(()=>recMode='denied');await f.page.getByRole('button',{name:'Talk to Ember',exact:true}).click();
  await f.page.getByText(/Microphone permission was denied/).waitFor();check('denied permission keeps actionable guidance after mic release',true);check('denied permission never sends text',!f.calls.some(c=>c.path==='/api/messages'));await f.context.close();
 }
 {
  const f=await fixture();await f.page.evaluate(()=>{window.realPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=()=>Promise.reject(new DOMException('Blocked','NotAllowedError'))});
  await f.start();await f.ask();await f.page.getByText(/Audio is ready. Tap Play/).waitFor();
  check('blocked autoplay retains native audio controls',await f.panel.locator('audio').isVisible());
  await f.page.evaluate(()=>{HTMLMediaElement.prototype.play=realPlay;document.querySelector('audio').play()});await f.panel.locator('[data-phase="playing"]').waitFor();check('explicit playback starts without another API request',f.calls.filter(c=>c.path==='/api/tts').length===1);await f.context.close();
 }
 {
  const f=await fixture();await f.start();await f.ask();await f.panel.locator('[data-phase="playing"]').waitFor();await f.panel.getByRole('button',{name:'Stop voice'}).click();
  for(let n=0;n<3;n++){await f.start();await f.ask('Repeated turn '+n);await f.panel.locator('[data-phase="playing"]').waitFor();await f.panel.getByRole('button',{name:'Stop voice'}).click()}
  check('four complete successive turns never capture over playback',await f.page.evaluate(()=>recs.length===4&&recs.every(r=>!r.active)));
  check('successive turns use exactly one speech request each',f.calls.filter(c=>c.path==='/api/tts').length===4);await f.context.close();
 }
 {
  const f=await fixture();await f.start();await f.page.evaluate(()=>say('A finished phrase'));await f.page.waitForTimeout(150);await f.page.evaluate(()=>say('Still talking',false));await f.page.waitForTimeout(850);
  check('interim speech cancels the pending phrase cutoff',await f.page.evaluate(()=>recs.at(-1).active));
  await f.page.evaluate(()=>say('Now finished'));await f.panel.locator('[data-phase="playing"]').waitFor();
  check('final phrase automatically sends and speaks',await f.page.evaluate(()=>!recs.at(-1).active)&&f.calls.some(c=>c.path==='/api/tts'));await f.panel.getByRole('button',{name:'Stop voice'}).click();
  await f.start();await f.page.evaluate(()=>{say('Keep these words',false);window.lateResult=recs.at(-1).onresult});await f.panel.getByRole('button',{name:'Stop voice'}).click();await f.page.locator('.foreground-voice [data-phase="ready"]').waitFor({state:'attached'});
  await f.page.evaluate(()=>{const r=[{transcript:'stale transcript'}];r.isFinal=true;lateResult({results:[r],resultIndex:0})});
  check('late recognition event cannot replace interrupted words',(await f.page.getByRole('textbox',{name:'Ask Ember'}).inputValue())==='Keep these words');
  await f.start();await f.page.evaluate(()=>say('and continue'));await f.panel.getByRole('button',{name:'Stop voice'}).click();await f.page.locator('.foreground-voice [data-phase="ready"]').waitFor({state:'attached'});
  check('later unsent words join the Ask Ember box instead of a review step',(await f.page.getByRole('textbox',{name:'Ask Ember'}).inputValue())==='Keep these words and continue');
  await f.context.close();
 }
 {
  const f=await fixture();await f.start();await f.panel.getByRole('button',{name:'Close voice'}).click();
  check('closing voice releases capture and wake lock',await f.page.evaluate(()=>recs.every(r=>!r.active)&&wakes.every(w=>w.released)));
  check('closing returns keyboard focus to the mouth',await f.page.evaluate(()=>document.activeElement.classList.contains('reactor-stage')));
  await f.start();await f.page.locator('.console-dock').getByRole('button',{name:'Caption Studio',exact:true}).click();
  check('changing Ember workspace stops voice',await f.page.evaluate(()=>recs.every(r=>!r.active)&&wakes.every(w=>w.released)));await f.context.close();
 }
 }
 console.log(`Foreground voice: ${checks} checks passed.`);
}finally{await browser.close()}
