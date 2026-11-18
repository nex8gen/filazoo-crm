const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const esbuild = require('C:/Users/Administrator/AppData/Local/npm-cache/_npx/46dba4b4f8747427/node_modules/esbuild');
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { compile } = require('@tailwindcss/node');

(async () => {
  const source = fs.readFileSync('components/flow-builder.tsx', 'utf8');
  const metadata = source.slice(source.indexOf('const stepMeta:'), source.indexOf('const actionChoices:'));
  const iconSelection = source.match(/const InspectorIcon = [^;]+;/)[0];
  const header = source.split('\n').find(line => line.includes('<InspectorIcon')).trim();
  const lucideImport = source.match(/import \{([^}]+)\} from "lucide-react";/)[0];
  const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {AiIcon} from './components/ai-icon';import {Button} from './components/ui/button';${lucideImport}
    ${metadata}
    const labels={ai_auto_reply:'AI auto-reply',send_email:'Email details',create_task:'Create CRM task',change_category:'Change customer tag',update_company:'Update company',internal_alert:'Internal alert',wait:'Time delay details',split:'Split',if_condition:'If condition',stop:'End workflow'};
    const flowActionLabel=type=>labels[type];const closeSettings=()=>{};
    function Header({type}){const selectedStep=type==='trigger'?null:{type};const selection=type==='trigger'?'trigger':type;const inspectorTab=type==='activity'?'insights':'configure';${iconSelection}
      return <aside data-type={type} className={'wf-panel wf-inspector '+(type==='send_email'?'wf-email-panel':type==='wait'?'wf-wait-panel':type==='trigger'?'wf-trigger-panel':'')}>${header}</aside>}
    createRoot(document.getElementById('root')).render(<div className="headers">{['trigger',...Object.keys(stepMeta),'activity'].map(type=><Header key={type} type={type}/>)}</div>);`;
  const bundle = await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',metafile:true,define:{'process.env.NODE_ENV':'"development"'}});
  const candidates = new Set(entry.split(/[\s"'`]+/));
  for(const file of Object.keys(bundle.metafile.inputs).filter(f=>!f.includes('node_modules')&&/\.(tsx|ts)$/.test(f)))for(const word of fs.readFileSync(file,'utf8').split(/[\s"'`]+/))candidates.add(word);
  const compiler = await compile(fs.readFileSync('app/globals.css','utf8'),{base:path.resolve('app'),onDependency(){}});
  const css = compiler.build([...candidates])+fs.readFileSync('components/workflow-editor.css','utf8')+' body{padding:16px;background:var(--muted);font-family:Arial,sans-serif;color:var(--foreground)}.headers{display:grid;grid-template-columns:repeat(2,minmax(0,480px));gap:16px}.wf-panel{--wf-line:var(--border);width:100%;max-width:100%}.wf-settings-heading{border:0}@media(max-width:760px){.headers{grid-template-columns:minmax(0,1fr)}}';
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setContent('<style>'+css+'</style><div id="root"></div>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.locator('.wf-settings-icon').first().waitFor();
    for(const width of [1440,390])for(const theme of ['light','dark']) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(theme=>document.documentElement.className=theme,theme);await page.waitForTimeout(180);
      const measurements=await page.locator('.wf-settings-icon').evaluateAll(nodes=>nodes.map(node=>{const icon=node.querySelector('svg'),b=node.getBoundingClientRect(),s=icon.getBoundingClientRect();return {type:node.closest('[data-type]').dataset.type,badge:[b.width,b.height],glyph:[s.width,s.height],offset:[s.x+s.width/2-b.x-b.width/2,s.y+s.height/2-b.y-b.height/2],color:getComputedStyle(icon).color,expected:getComputedStyle(node).getPropertyValue('--primary').trim(),animations:icon.querySelectorAll('animate,animateTransform').length};}));
      assert.equal(measurements.length,12);
      for(const m of measurements){assert.deepEqual(m.badge,[40,40],m.type);assert.deepEqual(m.glyph,[22,22],m.type);assert.deepEqual(m.offset,[0,0],m.type);assert.equal(m.animations,0,m.type);assert.notEqual(m.color,'rgb(8, 121, 78)',m.type);}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:'.cache/workflow-header-icons-'+width+'-'+theme+'.png',fullPage:true});
      console.log('PASS '+width+' '+theme+': 12 headers; centered 22px static glyphs in 40px badges; no overflow');
    }
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
