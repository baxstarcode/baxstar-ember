// Smoke test for THE WORKS — the ecosystem graph on the OPS homepage.
// Proves the deterministic layout converged, every node and edge drew, the
// highlight and legend filter work, and the panel scrolls inside itself
// instead of pushing the page sideways on a phone.
import { chromium } from 'playwright';
import fs from 'fs';
const PRE='/opt/pw-browsers/chromium';
const b = await chromium.launch(fs.existsSync(PRE)?{executablePath:PRE}:{});
const OUT = process.env.ECO_SHOT_DIR ? process.env.ECO_SHOT_DIR : '/tmp/';
const fails=[];
const ok=(l,c,x='')=>{console.log(`${c?'PASS':'FAIL'} — ${l}${x?' :: '+x:''}`); if(!c)fails.push(l);};

for (const [name,vp] of [['DESKTOP',{width:1440,height:1000}],['PHONE',{width:390,height:844}]]) {
  const p = await b.newPage({viewport:vp});
  const errs=[];
  p.on('pageerror',e=>errs.push(String(e)));
  // Google Fonts is the one external request the build still makes; in a
  // sandbox behind a TLS proxy it can fail on cert grounds. That is the
  // environment, not the app, so it is not a failure of this test.
  const external = t => /ERR_CERT|Failed to load resource|fonts\.googleapis|fonts\.gstatic/i.test(t);
  p.on('console',m=>{if(m.type()==='error'&&!external(m.text()))errs.push(m.text());});
  await p.goto('http://localhost:8099/index.html',{waitUntil:'networkidle'});
  await p.waitForTimeout(700);

  console.log(`\n===== ${name} =====`);
  ok(`${name} no console/page errors`, errs.length===0, errs.slice(0,2).join(' | '));

  const rail = p.locator('.eco-rail');
  ok(`${name} graph panel present`, await rail.count()===1);

  const nodes = await p.locator('.eco-node').count();
  const lines = await p.locator('.eco-svg line').count();
  const head  = await p.locator('.eco-count').innerText();
  const [wantN, wantE] = head.match(/\d+/g).map(Number);
  ok(`${name} every part drew`, nodes===wantN, `${nodes}/${wantN}`);
  ok(`${name} every link drew`, lines===wantE, `${lines}/${wantE}`);

  // every node has finite, in-bounds coords (layout actually converged)
  const bad = await p.evaluate(()=>{
    // Bounds come from the live viewBox, not a hardcoded pair of numbers.
    const [,,VW,VH] = document.querySelector('.eco-svg').getAttribute('viewBox').split(/\s+/).map(Number);
    const cs=[...document.querySelectorAll('.eco-node circle')];
    return cs.filter(c=>{
      const x=+c.getAttribute('cx'), y=+c.getAttribute('cy');
      return !isFinite(x)||!isFinite(y)||x<0||x>VW||y<0||y>VH;
    }).length;
  });
  ok(`${name} layout converged, all nodes in frame`, bad===0, `${bad} out of bounds`);

  // no two nodes stacked on top of each other
  const minDist = await p.evaluate(()=>{
    // Only the PAINTED circles. Each node also carries a transparent
    // finger-sized hit circle at the same centre, which would read as a
    // zero-distance overlap.
    const cs=[...document.querySelectorAll('.eco-node > circle[stroke]')].map(c=>[+c.getAttribute('cx'),+c.getAttribute('cy')]);
    let m=1e9;
    for(let i=0;i<cs.length;i++)for(let j=i+1;j<cs.length;j++){
      const d=Math.hypot(cs[i][0]-cs[j][0],cs[i][1]-cs[j][1]); if(d<m)m=d;
    }
    return Math.round(m);
  });
  ok(`${name} nodes not overlapping`, minDist>=24, `closest pair ${minDist}px`);

  const dataBugs = await p.evaluate(()=>{
    const ids=new Set([...document.querySelectorAll('.eco-node title')].map(t=>t.textContent.split(' — ')[0]));
    const seen=new Set(); const out=[];
    for (const l of document.querySelectorAll('.eco-svg line')) {
      const k=[l.getAttribute('x1'),l.getAttribute('y1'),l.getAttribute('x2'),l.getAttribute('y2')].join(',');
      const r=[l.getAttribute('x2'),l.getAttribute('y2'),l.getAttribute('x1'),l.getAttribute('y1')].join(',');
      if (seen.has(k)||seen.has(r)) out.push('duplicate link');
      if (k.split(',')[0]===k.split(',')[2] && k.split(',')[1]===k.split(',')[3]) out.push('self link');
      seen.add(k);
    }
    return {bugs:out, labelled:ids.size};
  });
  ok(`${name} no duplicate or self links`, dataBugs.bugs.length===0, dataBugs.bugs.slice(0,3).join(','));
  ok(`${name} every node is named for screen readers`, dataBugs.labelled===nodes, `${dataBugs.labelled}/${nodes}`);

  // The real legibility metric: do the rendered LABELS collide?
  const clash = await p.evaluate(()=>{
    const bs=[...document.querySelectorAll('.eco-label')].map(t=>{
      const b=t.getBBox(); return {t:t.textContent,x:b.x,y:b.y,w:b.width,h:b.height};
    });
    const hits=[];
    for(let i=0;i<bs.length;i++)for(let j=i+1;j<bs.length;j++){
      const a=bs[i],c=bs[j];
      if(a.x<c.x+c.w&&c.x<a.x+a.w&&a.y<c.y+c.h&&c.y<a.y+a.h) hits.push(`${a.t}/${c.t}`);
    }
    return hits;
  });
  ok(`${name} labels do not collide`, clash.length===0, `${clash.length}: ${clash.slice(0,4).join(', ')}`);

  ok(`${name} legend has all 6 layers`, await p.locator('.eco-key').count()>=6);
  const hub = await p.evaluate(()=>document.querySelector('.eco-label.core')?.textContent?.trim());
  ok(`${name} EMBER is the hub`, hub==='EMBER', String(hub));

  // Selecting a node reveals its detail and dims the rest. Pick a node that is
  // actually inside the scroll box — on a phone the graph pans, so a fixed
  // index can sit off-screen and we would be testing scrolling, not selection.
  const pick = await p.evaluate(()=>{
    const sc=document.querySelector('.eco-scroll').getBoundingClientRect();
    const ns=[...document.querySelectorAll('.eco-node')];
    for(let i=0;i<ns.length;i++){
      const r=ns[i].getBoundingClientRect();
      if(r.x>=sc.x+12&&r.right<=sc.right-12&&r.y>=sc.y&&r.bottom<=sc.bottom) return i;
    }
    return 0;
  });
  await p.locator('.eco-node').nth(pick).click();
  await p.waitForTimeout(250);
  const detail = (await p.locator('.eco-detail').innerText()).trim();
  ok(`${name} tapping a node shows its detail`, detail.length>12 && /LINK/.test(detail), detail.slice(0,60));
  const dim = await p.evaluate(()=>[...document.querySelectorAll('.eco-node')].filter(g=>+g.getAttribute('opacity')<1).length);
  ok(`${name} tapping dims unrelated nodes`, dim>0, `${dim} dimmed`);

  // legend isolates a layer
  await p.locator('.eco-key').nth(3).click();
  await p.waitForTimeout(250);
  const dim2 = await p.evaluate(()=>[...document.querySelectorAll('.eco-node')].filter(g=>+g.getAttribute('opacity')<1).length);
  ok(`${name} legend isolates a layer`, dim2>10, `${dim2} dimmed`);

  await p.locator('.eco-key.reset').click();
  await p.waitForTimeout(250);
  const dim3 = await p.evaluate(()=>[...document.querySelectorAll('.eco-node')].filter(g=>+g.getAttribute('opacity')<1).length);
  ok(`${name} reset restores every node`, dim3===0, `${dim3} still dimmed`);

  // page must not scroll sideways (the graph scrolls inside its own box)
  const ov = await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  ok(`${name} no page-level sideways scroll`, ov<=0, `${ov}px`);

  await rail.scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  await rail.screenshot({path:`${OUT}graph-${name.toLowerCase()}.png`});
  await p.close();
}
await b.close();
console.log(fails.length?`\nECO FAIL: ${fails.join(' | ')}`:'\nECO PASS');
process.exit(fails.length?1:0);
