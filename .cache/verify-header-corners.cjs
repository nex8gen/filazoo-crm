const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

function loadComponent(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code, {exports, require: name => dependencies[name] || require(name)});
  return exports;
}
const { PageHeader, PageActions } = loadComponent('components/page-header.tsx');
const { buttonVariants } = loadComponent('components/ui/button.tsx', {'@base-ui/react/button':{Button:'button'},cn:{cn: (...args) => args.filter(Boolean).join(' ')}});
const h = React.createElement;
function fixture(kind) {
  const isCompany = kind === 'companies';
  const action = (label, variant, size) => h(isCompany ? 'button' : 'a', {'data-slot':isCompany ? 'button' : undefined, href:isCompany ? undefined : '#', className:buttonVariants({variant,size})},label);
  let actions = renderToStaticMarkup(h(PageActions,null,action(isCompany?'Export':'Analytics','outline',isCompany?'sm':'default'),action(isCompany?'+ Add company':'+ Create workflow','default',isCompany?'sm':'default')));
  actions = actions.replace(/^<div class="mb-3">/,'').replace(/<\/div>$/,'');
  let header = renderToStaticMarkup(h(PageHeader,{title:isCompany?'Companies':'Workflow',icon:props=>h('svg',props)}));
  header = header.replace('self-start empty:hidden"></div>',`self-start empty:hidden">${actions}</div>`);
  return `<div data-workspace-shell class="h-dvh"><div class="workspace-page flex h-full min-w-0 flex-col overflow-hidden bg-background">${header}<main class="flex-1 border-t p-6">${isCompany?'Company list':'Workflow analytics'}</main></div></div>`;
}
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:3000/login',{waitUntil:'networkidle'});
    const sheets = await page.locator('link[rel="stylesheet"]').evaluateAll(links=>links.map(link=>link.href));
    assert.ok(sheets.length,'Next.js stylesheets loaded');
    const css = (await Promise.all(sheets.map(async url=>(await page.request.get(url)).text()))).join('\n');
    for (const width of [1440,820,390]) {
      await page.setViewportSize({width,height:720});
      for (const theme of ['light','dark']) for (const kind of ['companies','workflow']) {
        await page.setContent(`<html class="${theme}"><head><style>${css}\n${fs.readFileSync('app/responsive.css','utf8')}</style></head><body>${fixture(kind)}</body></html>`);
        const geometry = await page.evaluate(()=>{
          const outer=document.querySelector('.workspace-page');
          const button=document.querySelector('[data-page-actions] > :last-child');
          const o=outer.getBoundingClientRect(), b=button.getBoundingClientRect();
          const os=getComputedStyle(outer), bs=getComputedStyle(button);
          return {top:b.top-o.top,right:o.right-b.right,outerRadius:parseFloat(os.borderTopRightRadius),buttonRadius:parseFloat(bs.borderTopRightRadius),overflow:document.documentElement.scrollWidth>innerWidth};
        });
        assert.equal(geometry.top,geometry.right,`${width} ${theme} ${kind}: equal edge gaps`);
        assert.equal(geometry.outerRadius,16,`${width} ${theme} ${kind}: original page rounding`);
        assert.equal(geometry.buttonRadius,12,`${width} ${theme} ${kind}: standard control rounding`);
        assert.equal(geometry.overflow,false);
        await page.screenshot({path:`.cache/header-corners-${kind}-${width}-${theme}.png`});
        console.log(`PASS ${kind} ${width}px ${theme}: ${JSON.stringify(geometry)}`);
      }
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
