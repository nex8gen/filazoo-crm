const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const esbuild = require('C:/Users/Administrator/AppData/Local/npm-cache/_npx/46dba4b4f8747427/node_modules/esbuild');
const { chromium } = require('C:/Users/Administrator/AppData/Local/npm-cache/_npx/d71ea5ed3eabc9b3/node_modules/playwright-core');
const { compile } = require('@tailwindcss/node');

(async () => {
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { DocumentsWorkspace } from './components/documents-workspace';
    import { newEmailDesign, newEmailBlock } from './lib/email-design';
    const colors = ['#e7eddb','#eadfd7','#e5e5f7','#f7e4cb','#dce9eb','#f0dfdc','#dce7d9','#f4eacb'];
    const titles = ['Weekend collection','A fresh start for your home','New product launch','Summer specials','Explore the collection','A note from our team','Your exclusive invitation','Monthly newsletter'];
    const templates = titles.map((name,i) => {
      const design = newEmailDesign();
      design.theme = {...design.theme,background:colors[i],marginTop:0};
      design.blocks = [newEmailBlock('text',{text:'FILAZOO',align:'center',fontSize:24,padding:24}),newEmailBlock('text',{text:name.toUpperCase(),fontSize:40,align:'center',padding:36,background:colors[i]}),newEmailBlock('text',{text:'Thoughtfully selected. Made for you.\\nDiscover something new in our latest collection.',align:'center',padding:32}),newEmailBlock('button',{text:'EXPLORE THE COLLECTION',align:'center',padding:24}),newEmailBlock('text',{text:'Hello {{first_name}},\\n\\nWe have something special to share with you. Take a look at the latest news, products, and ideas from our team.\\n\\nSee what is new this season.',padding:32})];
      return {id:'template-'+i,name,kind:'template',mime_type:'text/plain',size:0,folder_id:null,company:'',tags:[],description:'',subject:name,body:'Hello {{first_name}}, welcome to the latest collection.',created_at:'2026-11-13T01:00:00Z',updated_at:'2026-11-13T01:00:00Z',deleted_at:null,starred:i===3,category:i===7?'everyday':'promotion',related_ids:[],design_version:'1',email_design:design};
    });
    window.__templates = templates;
    const rows = templates.map((t,i) => i === 1 ? {...t,email_design:null} : i === 2 ? {...t,email_design:null,design_version:null} : t);
    const stats = {files:0,templates:rows.length,starred:1,trash:0};
    const collection = {documents:rows,folders:[],stats};
    window.fetch = async (url, options) => {
      window.__requests = [...(window.__requests||[]),url];
      if (options?.method === 'POST') return Response.json({document:rows[0]});
      const match = String(url).match(/documents\\/(template-\\d+)/);
      if (match) return Response.json({document:templates.find(t=>t.id===match[1]),related:[]});
      return Response.json({...collection,collection,total:rows.length});
    };
    createRoot(document.getElementById('root')).render(<DocumentsWorkspace workspaceName="Filazoo" canWrite initialCategory="promotion" initialData={{...collection,collection,total:7}} />);
  `;
  const candidates = new Set(entry.split(/[\s"'`]+/));
  for (const name of fs.readdirSync('components').filter(n=>n.endsWith('.tsx'))) for (const word of fs.readFileSync('components/'+name,'utf8').split(/[\s"'`]+/)) candidates.add(word);
  for (const name of fs.readdirSync('components/ui').filter(n=>n.endsWith('.tsx'))) for (const word of fs.readFileSync('components/ui/'+name,'utf8').split(/[\s"'`]+/)) candidates.add(word);
  const compiler = await compile(fs.readFileSync('app/globals.css','utf8'),{base:path.resolve('app'),onDependency(){}});
  const css = compiler.build([...candidates]) + fs.readFileSync('app/tables.css','utf8') + fs.readFileSync('components/documents-workspace.css','utf8') + 'html,body,#root{height:100%;margin:0}body{font-family:Arial,sans-serif}';
  const bundle = await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'next-harness',setup(build){
    build.onResolve({filter:/^next\/(navigation|dynamic|link)$/},args=>({path:args.path,namespace:'shim'}));
    build.onLoad({filter:/.*/,namespace:'shim'},args=>({contents:args.path==='next/navigation'?'export const useRouter = () => ({ push: url => { window.__navigation=url } });':args.path==='next/link'?'import React from "react"; export default function Link(props){return React.createElement("a",props)}':'import React from "react"; export default function dynamic(){return function Editor(props){return React.createElement("section",{"aria-label":"Editor opened"},React.createElement("button",{onClick:props.onClose},"Close editor"))}}',loader:'js',resolveDir:process.cwd()}));
  }}]});
  const browser = await chromium.launch({headless:true});
  try {
    for (const width of [1600,1000,390,320]) {
      const page = await browser.newPage({viewport:{width,height:1000}});
      const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
      await page.route('https://crm.test/**', route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body></body></html>'}));
      await page.goto('https://crm.test');
      await page.setContent('<style>'+css+'</style><div id="root"></div>');
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.locator('.library-template-card').first().waitFor();
      await page.waitForFunction(()=>document.querySelectorAll('.library-template-canvas iframe').length===6);
      assert.equal(await page.locator('.library-template-card').count(),7);
      assert.equal(await page.getByRole('table').count(),0);
      assert.equal(await page.getByRole('button',{name:'List view',exact:true}).count(),0);
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('.library-template-card')].map(c=>{const r=c.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height,top:r.top,bottom:r.bottom}})}));
      assert.ok(layout.scroll<=width,JSON.stringify(layout));
      for(let i=0;i<layout.cards.length;i++)for(let j=i+1;j<layout.cards.length;j++){const a=layout.cards[i],b=layout.cards[j];assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,'Cards must not overlap: '+JSON.stringify([a,b]));}
      assert.ok(layout.cards.every(c=>c.left>=0&&c.right<=width&&c.height>=300),JSON.stringify(layout));
      await page.screenshot({path:'.cache/template-cards-'+width+'.png',fullPage:true});
      await page.getByRole('searchbox',{name:'Search library'}).fill('fresh start');
      await page.waitForFunction(()=>document.querySelectorAll('.library-template-card').length===1);
      await page.getByRole('button',{name:'Actions for A fresh start for your home',exact:true}).click();
      await page.getByRole('menuitem',{name:'Edit template',exact:true}).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'Preview A fresh start for your home',exact:true}).click();
      await page.getByRole('button',{name:'Close preview',exact:true}).waitFor();
      await page.getByRole('button',{name:'Close preview',exact:true}).click();
      await page.getByRole('button',{name:'New template',exact:true}).click();
      await page.getByRole('region',{name:'Editor opened'}).waitFor();
      await page.getByRole('button',{name:'Close editor',exact:true}).click();
      if(width>=768){
        await page.getByRole('button',{name:'Clear filters',exact:true}).click();
        await page.getByRole('button',{name:'Custom emails',exact:true}).click();
        await page.waitForFunction(()=>document.querySelectorAll('.library-template-card').length===1);
        await page.getByRole('button',{name:'All files',exact:false}).click();
        await page.getByRole('table').waitFor();
        await page.getByRole('button',{name:'Email templates',exact:false}).first().click();
        await page.waitForFunction(()=>document.querySelectorAll('.library-template-card').length===8);
      }
      assert.deepEqual(errors,[]);
      console.log('PASS '+width+'px: preview cards, lazy saved design, text fallback, no horizontal overflow, search, actions, preview, creation'+(width>=768?', template categories and file list':''));
      await page.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
