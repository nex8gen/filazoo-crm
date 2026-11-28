import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { compile } from '@tailwindcss/node';
import * as plans from '../lib/billing/plans.ts';
import * as brand from '../lib/brand-assets.ts';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const modules = new Map();
const cssFiles = new Set();
const Link = ({children, href, ...props}) => React.createElement('a', {...props, href}, children);
let role = 'admin';
let order = {id:'preview', workspace_id:'fixture', user_id:'fixture', status:'paid', kind:'subscription', catalog_version:6, plan_id:'starter', seats:1, period_months:1, amount_fen:0, subscription_discount_id:'fixture', expires_at:'2099-01-01', created_at:'2026-11-28'};
const stubs = {
  'next/link': {default:Link},
  'next/navigation': {useRouter:() => ({replace(){},refresh(){}}), notFound(){throw Error('not found')}},
  '@/lib/auth': {requireViewer:async()=>({id:'fixture'}),requireWorkspaceMember:async()=>({role,workspaceName:'My company'})},
  '@/lib/billing/data': {ownerOrder:async()=>order},
  '@/lib/billing/alipay': {alipayReady:()=>true,orderExpired:o=>o.expires_at==='2000-01-01'},
  '@/lib/billing/plans':plans,
  '../lib/brand-assets':brand,
  '@/components/language-switcher':{LanguageSwitcher:()=>React.createElement('button', {'aria-label':'Change language',style:{fontSize:12,color:'var(--muted-foreground)'}},'EN')},
};
function load(file) {
  if(modules.has(file)) return modules.get(file);
  const exports={}; modules.set(file,exports);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>{
    if(name in stubs) return stubs[name];
    if(name.endsWith('.module.css')) {
      const path=name.startsWith('@/')?name.slice(2):file.slice(0,file.lastIndexOf('/')+1)+name.replace(/^\.\//,'');
      cssFiles.add(path);
      const prefix=path.split('/').at(-1).replace('.module.css','');
      return {default:new Proxy({},{get:(_,key)=>prefix+'_'+key})};
    }
    if(name.startsWith('@/components/')) return load(name.slice(2)+'.tsx');
    if(name==='./payment-status') return load('app/subscribe/orders/[id]/payment-status.tsx');
    return require(name);
  }});
  return exports;
}
const Setup=load('app/workspaces/setup/page.tsx').default;
const Payment=load('app/subscribe/orders/[id]/page.tsx').default;
const pages=[];
pages.push(['setup',renderToStaticMarkup(await Setup())]);
role='viewer';
const viewerHtml=renderToStaticMarkup(await Setup());
assert(!viewerHtml.includes('Invite your team'));
assert(viewerHtml.includes('Connect your email'));
assert(!viewerHtml.includes('<aside'));
pages.push(['setup-viewer',viewerHtml]);
pages.push(['activated',renderToStaticMarkup(await Payment({params:Promise.resolve({id:'preview'})}))]);
for(const status of ['pending','closed','refunded']) {
  order={...order,status,amount_fen:13900,subscription_discount_id:null};
  const html=renderToStaticMarkup(await Payment({params:Promise.resolve({id:'preview'})}));
  assert(!html.includes('Plan activated'));
  assert.equal(html.includes('<iframe'),status==='pending');
  pages.push([status,html]);
}
order={...order,status:'pending',expires_at:'2000-01-01'};
const expired=renderToStaticMarkup(await Payment({params:Promise.resolve({id:'preview'})}));
assert(expired.includes('Checkout expired'));
assert(!expired.includes('<iframe'));
pages.push(['expired',expired]);
const candidates=[...new Set(pages.flatMap(([,html])=>[...new JSDOM(html).window.document.querySelectorAll('[class]')].flatMap(el=>el.className.baseVal?.split(/\s+/)??el.className.split(/\s+/))))];
const compiler=await compile(fs.readFileSync('app/globals.css','utf8'),{base:process.cwd()+'/app',onDependency(){}});
let css=compiler.build(candidates);
for(const file of cssFiles){
  const prefix=file.split('/').at(-1).replace('.module.css','');
  css+='\n'+fs.readFileSync(file,'utf8').replace(/:global\(([^)]+)\)/g,'$1').replace(/\.([a-zA-Z][\w-]*)/g,(all,name)=>name==='dark'?all:'.'+prefix+'_'+name);
}
css+='\n:root{--font-sans:Arial,sans-serif}body{margin:0;font-family:Arial,sans-serif}';
for(const [name,html] of pages){
  for(const theme of ['light','dark']) fs.writeFileSync('.cache/onboarding-'+name+'-'+theme+'.html','<!doctype html><html class="'+(theme==='dark'?'dark':'')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NewAI '+name+' preview</title><style>'+css+'</style></head><body>'+html+'</body></html>');
}
for(const name of ['setup','activated']){
  const content=fs.readFileSync('.cache/onboarding-'+name+'-light.html','utf8').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  fs.writeFileSync('.cache/onboarding-'+name+'-mobile.html','<!doctype html><title>Mobile '+name+'</title><style>body{margin:0;background:#e8e8e8;display:flex;justify-content:center}iframe{width:390px;height:1250px;border:0;background:white}</style><iframe srcdoc="'+content+'"></iframe>');
}
console.log('Rendered actual page components: admin, viewer, activation, payment, closed, refunded and expired; light/dark/mobile previews. Role checks and state assertions passed.');
