const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const esbuild = require('C:/Users/Administrator/AppData/Local/npm-cache/_npx/46dba4b4f8747427/node_modules/esbuild');
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { compile } = require('@tailwindcss/node');

(async () => {
  console.log('Building isolated React preview');
  const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {AiReplyInspector} from './components/flow-ai-reply-settings';import {Button} from './components/ui/button';import {Sparkles,Eye,X,Check} from 'lucide-react';
  const initial={mailboxId:'personal',replyInThread:true,useProducts:true,usePrices:true,attachCatalog:true,catalogFirstMessageOnly:true,instructions:'',language:'en',sendWindow:'anytime',trackOpens:true,trackClicks:true,utmTracking:true,stopOnReply:false};
  function App(){const [config,setConfig]=useState(initial);const [disabled,setDisabled]=useState(false);window.currentConfig=config;window.reset=()=>setConfig(initial);window.setReadOnly=setDisabled;return <aside className="wf-panel wf-inspector" style={{height:'calc(100dvh - 32px)'}}><header className="wf-settings-heading"><span className="wf-settings-icon"><Sparkles/></span><h2>AI auto-reply</h2><button aria-label="Close"><X size={16}/></button></header><div className="wf-inspector-content"><Button variant="outline" size="sm" className="mb-5 w-full"><Eye/>Preview & test message</Button><AiReplyInspector config={config} onChange={setConfig} mailboxes={[{id:'personal',label:'Personal email · souravmallick1111@gmail.com'},{id:'team',label:'Team email · sales@filazoo.com'}]} disabled={disabled}/></div><footer className="wf-settings-footer" style={{justifyContent:'space-between'}}><span className="wf-save-state"><Check size={14}/>All changes saved</span><Button>Save</Button></footer></aside>};createRoot(document.getElementById('root')).render(<App/>);`;
  const bundle = await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},metafile:true,define:{'process.env.NODE_ENV':'"development"','process.env':'{}'}});
  console.log('Bundle ready');
  const candidates = new Set(entry.split(/[\s"'`]+/));
  for (const file of Object.keys(bundle.metafile.inputs).filter(f=>!f.includes('node_modules') && /\.(tsx|ts)$/.test(f))) for (const word of fs.readFileSync(file,'utf8').split(/[\s"'`]+/)) candidates.add(word);
  const compiler = await compile(fs.readFileSync('app/globals.css','utf8'),{base:path.resolve('app'),onDependency(){}});
  const css = compiler.build([...candidates])+fs.readFileSync('components/workflow-editor.css','utf8')+fs.readFileSync('components/flow-ai-reply-settings.css','utf8')+' body{padding:16px;background:var(--muted);font-family:Arial,sans-serif;color:var(--foreground)} .wf-panel{--wf-line:var(--border);max-width:100%;}';
  console.log('Styles ready; launching browser');
  const browser = await chromium.launch({headless:true});
  try {
    console.log('Browser ready');
    const page = await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
    await page.route('http://localhost:4177/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));await page.goto('http://localhost:4177/');
    await page.setContent('<style>'+css+'</style><div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.locator('.ai-reply-settings').waitFor();
    const group = name=>page.locator('.ai-reply-group').filter({has:page.locator('summary strong',{hasText:name})});
    for (const width of [1440,820,390]) {await page.setViewportSize({width,height:1000});for (const theme of ['light','dark']) {
      await page.evaluate(theme=>document.documentElement.className=theme,theme);
      await page.evaluate(()=>{document.querySelectorAll('details').forEach(n=>n.open=false);document.querySelector('.wf-inspector-content').scrollTop=0;});
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.ai-reply-group[open]').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page overflow');
      const geometry=await page.locator('.ai-reply-settings').evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth}));assert.ok(geometry.scroll<=geometry.width+1,JSON.stringify(geometry));
      await page.screenshot({path:'.cache/ai-reply-'+width+'-'+theme+'.png'});
      await group('Products & catalog').locator('summary').click();assert.equal(await page.getByRole('switch',{name:'Product information',exact:true}).isChecked(),true);
      await group('Instructions').locator('summary').click();await group('Delivery & tracking').locator('summary').click();
      assert.equal(await page.locator('.ai-reply-group[open]').count(),3);
      await page.waitForTimeout(200);
      await page.screenshot({path:'.cache/ai-reply-'+width+'-'+theme+'-expanded.png'});
      console.log('PASS layout '+width+' '+theme+' collapsed/expanded; no horizontal overflow');
    }}
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{document.documentElement.className='light';window.reset();});
    await page.getByRole('switch',{name:'Product information',exact:true}).click();assert.equal(await page.evaluate(()=>window.currentConfig.usePrices),false);assert.equal(await page.getByRole('switch',{name:'Quote saved prices',exact:true}).isDisabled(),true);
    await page.getByRole('radio',{name:/Collect requirements/}).check({force:true});assert.equal(await page.evaluate(()=>window.currentConfig.leadIntake),true);assert.equal(await page.evaluate(()=>window.currentConfig.useProducts),true);assert.equal(await page.evaluate(()=>window.currentConfig.attachCatalog),true);assert.equal(await page.evaluate(()=>window.currentConfig.usePrices),false);
    await page.getByRole('textbox',{name:'Company introduction',exact:true}).fill('Welcome to Filazoo.');
    await page.getByRole('textbox',{name:'Reply instructions',exact:true}).fill('Ask about quantity.');
    assert.equal(await page.evaluate(()=>window.currentConfig.instructions),'Ask about quantity.');assert.equal(await page.evaluate(()=>window.currentConfig.introductionTemplate),'Welcome to Filazoo.');
    await page.getByRole('switch',{name:'Send catalog when relevant',exact:true}).click();assert.equal(await page.getByRole('switch',{name:'Also attach to the first reply',exact:true}).count(),0);
    await page.getByRole('switch',{name:'Send catalog when relevant',exact:true}).click();
    await page.getByRole('switch',{name:'Also attach to the first reply',exact:true}).click();assert.equal(await page.evaluate(()=>window.currentConfig.catalogFirstMessageOnly),false);
    await page.getByRole('combobox',{name:'When to send',exact:true}).click();await page.getByRole('option',{name:'Business hours (09:00–17:00 UTC)',exact:true}).click();assert.equal(await page.evaluate(()=>window.currentConfig.sendWindow),'business_hours');
    for(const [name,key] of [['Keep replies in the same thread','replyInThread'],['Skip if a new reply arrives','stopOnReply'],['Track email opens','trackOpens'],['Track link clicks','trackClicks'],['Tag links for website analytics','utmTracking']]) {const before=await page.evaluate(key=>window.currentConfig[key],key);await page.getByRole('switch',{name,exact:true}).click();assert.equal(await page.evaluate(key=>window.currentConfig[key],key),!before);}
    await page.getByRole('combobox',{name:'Send from',exact:true}).click();await page.getByRole('option',{name:'Team email · sales@filazoo.com',exact:true}).click();assert.equal(await page.evaluate(()=>window.currentConfig.mailboxId),'team');
    await page.getByRole('radio',{name:/Answer questions/}).check({force:true});assert.equal(await page.evaluate(()=>window.currentConfig.leadIntake),false);
    await page.getByRole('radio',{name:/Answer questions/}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>window.currentConfig.leadIntake),true);
    await page.evaluate(()=>window.setReadOnly(true));await page.waitForFunction(()=>document.querySelector('input[type=radio]').disabled);assert.equal(await page.getByRole('radio',{name:/Answer questions/}).isDisabled(),true);for(const control of await page.getByRole('switch').all())assert.equal(await control.isDisabled(),true);assert.equal(await page.getByRole('textbox',{name:'Reply instructions',exact:true}).isDisabled(),true);
    assert.deepEqual(errors,[]);console.log('PASS real React controls: sender, purpose + keyboard, dependency resets, guidance, catalog, send window, all tracking flags, read-only; no browser errors');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
