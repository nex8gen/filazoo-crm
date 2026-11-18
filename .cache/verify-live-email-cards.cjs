const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const esbuild=require('C:/Users/Administrator/AppData/Local/npm-cache/_npx/46dba4b4f8747427/node_modules/esbuild');
const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {compile}=require('@tailwindcss/node');
(async()=>{
  let entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {FlowEmailActionCard} from './components/flow-email-action-card';import {FlowEmailPerformanceProvider} from './components/flow-email-performance';import {Sparkles,Mail,ChartNoAxesCombined} from 'lucide-react';import {Button} from './components/ui/button';
  const stats={sent:120,opens:60,clicks:12,openRate:50,clickRate:10,waiting:3,review:1,skipped:8};
  window.mode='ready';window.spend={recordedUsd:1.2345,requests:150,pending:0,untracked:false};
  window.fetch=async()=>Response.json(window.mode==='error'?{ok:false,error:'Synthetic test error'}:{ok:true,report:{asOf:'2026-11-18T00:00:00Z',from:'2026-10-20T00:00:00Z',actions:{'ai-stable':stats,email:stats},costs:{'ai-stable':window.spend}}},{status:window.mode==='error'?503:200});
  function App(){const[status,setStatus]=useState('live');const[version,setVersion]=useState(0);const[statuses,setStatuses]=useState({ai:'live',email:'live'});window.refresh=()=>setVersion(v=>v+1);window.setFlowStatus=setStatus;
  return <FlowEmailPerformanceProvider flowId="synthetic" version={String(version)} status={status} savedIds={['ai-stable','email']} disabled={false} onEmailStatusChange={(id,value)=>setStatuses(v=>({...v,[id]:value}))}><div className="workflow-editor"><div className="wf-canvas preview">{['ai','email'].map((id,index)=><div key={id}><FlowEmailActionCard actionId={id} kind={id==='ai'?'ai_auto_reply':'send_email'} label={id==='ai'?'AI auto-reply':'Email #1'} summary={id==='ai'?'Answer questions + catalog when relevant':'Text only email'} icon={id==='ai'?<Sparkles/>:<Mail/>} tone="text-primary" index={index} selected={false} disabled={false} last={index===1} config={id==='ai'?{performanceId:'ai-stable',attachCatalog:true,emailStatus:statuses.ai}:{emailStatus:statuses.email,templateId:'custom',subject:'Your product inquiry',body:'Hello'}} onSelect={()=>{}} onMove={()=>{}} onRemove={()=>{}} onPointerDown={()=>{}}/></div>)}</div></div></FlowEmailPerformanceProvider>};createRoot(document.getElementById('root')).render(<App/>);`;
  const toolbar=fs.readFileSync('components/flow-builder.tsx','utf8').split('\n').find(line=>line.includes('wf-reports-toggle')).trim();
  entry=entry.replace("function App(){const[status", "function App(){const[reportsVisible,setReportsVisible]=useState(true);const[status");
  entry=entry.replace('return <FlowEmailPerformanceProvider flowId=', "const draft={id:'synthetic',status};return <FlowEmailPerformanceProvider reportsVisible={reportsVisible} flowId=");
  entry=entry.replace('<div className="workflow-editor"><div className="wf-canvas preview">','<div className="workflow-editor"><header className="wf-topbar"><div className="wf-toolbar-actions">'+toolbar+'</div></header><div aria-label="Action settings"><input aria-label="Pending reply instructions" defaultValue="Unsaved instructions" /></div><div className="wf-canvas preview">');
  const bundle=await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',metafile:true,define:{'process.env.NODE_ENV':'"development"'}});
  const candidates=new Set(entry.split(/[\s"'`]+/));for(const file of Object.keys(bundle.metafile.inputs).filter(f=>!f.includes('node_modules')&&/\.(tsx|ts)$/.test(f)))for(const word of fs.readFileSync(file,'utf8').split(/[\s"'`]+/))candidates.add(word);
  const compiler=await compile(fs.readFileSync('app/globals.css','utf8'),{base:path.resolve('app'),onDependency(){}});
  const css=compiler.build([...candidates])+fs.readFileSync('components/workflow-editor.css','utf8')+' body{padding:20px;background:var(--muted);color:var(--foreground);font-family:Arial,sans-serif}.workflow-editor{display:block;height:auto;min-height:0;border:0;background:transparent}.wf-canvas.preview{display:grid;position:static;grid-template-columns:repeat(2,minmax(0,340px));gap:32px;overflow:visible;background:transparent}.preview>div{min-width:0}@media(max-width:760px){.wf-canvas.preview{grid-template-columns:minmax(0,1fr)}}';
  const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent('<style>'+css+'</style><div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByText('$1.2345',{exact:true}).waitFor();
    for(const width of [1440,390])for(const theme of ['light','dark']){await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.className=theme,theme);await page.waitForTimeout(180);assert.equal(await page.locator('[data-flow-expanded]').count(),2);assert.equal(await page.getByText('Placed order',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.cache/live-email-cards-'+width+'-'+theme+'.png',fullPage:true});console.log('PASS '+width+' '+theme+': AI/email live metrics, cost, no purchase placeholder or overflow');}
    for(const width of [1440,390])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.className=theme,theme);
      const instructions=page.getByRole('textbox',{name:'Pending reply instructions'});await instructions.fill('Keep this unsaved edit');
      const before=await page.locator('[data-flow-kind=ai_auto_reply]').boundingBox();
      await page.getByRole('button',{name:'Hide action reports',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Show action reports',exact:true}).getAttribute('aria-pressed'),'false');
      assert.equal(await page.locator('[data-flow-expanded]').count(),0);assert.equal(await instructions.inputValue(),'Keep this unsaved edit');
      assert.equal(await page.getByRole('dialog').count(),0);
      const after=await page.locator('[data-flow-kind=ai_auto_reply]').boundingBox();assert.ok(after.height<before.height);
      await page.waitForTimeout(200);await page.screenshot({path:'.cache/action-reports-hidden-'+width+'-'+theme+'.png',fullPage:true});
      await page.getByRole('button',{name:'Show action reports',exact:true}).click();await page.getByText('$1.2345',{exact:true}).waitFor();
      assert.equal(await page.locator('[data-flow-expanded]').count(),2);assert.equal(await instructions.inputValue(),'Keep this unsaved edit');
      assert.equal(await page.getByRole('button',{name:'Hide action reports',exact:true}).getAttribute('aria-pressed'),'true');
      await page.waitForTimeout(200);await page.screenshot({path:'.cache/action-reports-visible-'+width+'-'+theme+'.png',fullPage:true});
      console.log('PASS '+width+' '+theme+': actual toolbar handler toggles both reports; cards resize, no dialog, unsaved settings retained');
    }
    const ai=page.locator('[data-flow-kind=ai_auto_reply]');await ai.getByRole('button',{name:'Email status: live',exact:true}).click();await page.getByRole('menuitem',{name:'Draft',exact:true}).click();assert.equal(await ai.getByRole('button',{name:'Email status: draft',exact:true}).count(),1);assert.equal(await page.locator('[data-flow-kind=send_email]').getByRole('button',{name:'Email status: live',exact:true}).count(),1);
    await page.evaluate(()=>{window.spend={recordedUsd:.02,requests:3,pending:1,untracked:false};window.refresh();});await page.getByText('$0.02+',{exact:true}).waitFor();
    await page.evaluate(()=>{window.spend={recordedUsd:null,requests:0,pending:0,untracked:true};window.refresh();});await page.getByText('Not recorded',{exact:true}).waitFor();
    await page.evaluate(()=>{window.mode='error';window.refresh();});await page.getByText('Performance unavailable',{exact:true}).first().waitFor();assert.equal(await page.getByText('Not recorded',{exact:true}).count(),0);
    await page.evaluate(()=>{window.mode='ready';window.setFlowStatus('draft');});await page.locator('.wf-node-configure').first().waitFor();assert.equal(await page.locator('[data-flow-expanded]').count(),0);assert.deepEqual(errors,[]);console.log('PASS status isolation, pending and historical billing, error clearing, and draft cards');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
