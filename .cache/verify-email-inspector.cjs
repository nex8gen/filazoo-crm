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
    import { EmailDesignEditor } from './components/email-design-editor';
    import { newEmailDesign } from './lib/email-design';
    createRoot(document.getElementById('root')).render(<EmailDesignEditor initial={{...newEmailDesign(),blocks:[]}} name="Inspector verification" subject="Settings" onSave={async (design,name)=>({id:'test',name})} onApply={design=>window.applied=design} onClose={()=>{}} />);
  `;
  const bundle = await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},metafile:true,define:{'process.env.NODE_ENV':'"development"'}});
  const candidates = new Set(entry.split(/[\s"'`]+/));
  for(const file of Object.keys(bundle.metafile.inputs).filter(f=>!f.includes('node_modules') && /\.(tsx|ts)$/.test(f))) {
    for(const word of fs.readFileSync(file,'utf8').split(/[\s"'`]+/)) candidates.add(word);
  }
  const compiler = await compile(fs.readFileSync('app/globals.css','utf8'),{base:path.resolve('app'),onDependency(){}});
  const css = compiler.build([...candidates])+['email-design-editor','email-editor-controls','email-block-controls','email-product-editor','email-social-editor'].map(f=>fs.readFileSync('components/'+f+'.css','utf8')).join('\n');
  const browser = await chromium.launch({headless:true});
  try {
    for(const sidebar of [300,336,440]) {
      const page = await browser.newPage({viewport:{width:1440,height:1000}});
      const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
      await page.route('http://localhost:4177/**', route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
      await page.goto('http://localhost:4177/');
      await page.setContent('<style>'+css+'</style><div id="root"></div>');
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.locator('.email-designer-shell').evaluate((node,width)=>node.style.setProperty('--email-editor-sidebar-width',width+'px'),sidebar);
      await page.getByRole('button',{name:'Text',exact:true}).click();
      const body=page.locator('.email-designer-sidebarBody');
      const sections=body.locator('details.email-block-section');
      assert.ok(await sections.count()>5);
      for(let i=0;i<await sections.count();i++) {
        const section=sections.nth(i),summary=section.locator(':scope > summary');
        const wasOpen=await section.evaluate(n=>n.open);
        await summary.click();
        await page.waitForTimeout(30);
        assert.equal(await section.evaluate(n=>n.open),!wasOpen);
        await summary.click();
      }
      await page.getByRole('combobox',{name:'Font',exact:true}).click();
      await page.getByRole('option',{name:'Georgia',exact:true}).click();
      const letter=page.getByRole('spinbutton',{name:'Letter spacing',exact:true});
      await letter.fill('1.0');assert.equal(await letter.inputValue(),'1.0');
      await letter.fill('-0.5');await letter.press('Tab');
      await page.getByRole('button',{name:'bold',exact:true}).click();
      await page.getByRole('button',{name:'italic',exact:true}).click();
      await page.getByRole('button',{name:'underline',exact:true}).click();
      await page.getByRole('button',{name:'strikethrough',exact:true}).click();
      const control=letter.locator('..');
      const before=await control.boundingBox();await control.hover();
      assert.deepEqual(await control.boundingBox(),before,'hover must not resize the number control');
      const row=page.locator('.email-block-typographyRow');
      const bounds=await row.evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth,children:[...n.querySelectorAll('button,input')].map(c=>({left:c.getBoundingClientRect().left,right:c.getBoundingClientRect().right}))}));
      assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify(bounds));
      const background=sections.filter({has:page.locator('summary',{hasText:/^Text area background color$/})});
      await background.locator('summary').click();
      await page.getByRole('textbox',{name:'Content background color hex value',exact:true}).fill('#112233');
      await page.getByRole('checkbox',{name:'Content background color transparent',exact:true}).check();
      assert.equal(await background.evaluate(n=>n.open),true);
      await page.getByRole('button',{name:'Done',exact:true}).click();
      const applied=await page.evaluate(()=>window.applied);
      assert.equal(applied.blocks[0].presentation.letterSpacing,-0.5);
      assert.equal(applied.blocks[0].fontFamily,'Georgia');
      assert.ok(applied.blocks[0].bold&&applied.blocks[0].italic&&applied.blocks[0].underline&&applied.blocks[0].presentation.strike);
      assert.equal(errors.length,0,errors.join('\n'));
      await page.locator('.email-designer-sidebarScroll').evaluate(n=>n.scrollTop=0);
      await page.screenshot({path:'.cache/email-inspector-'+sidebar+'.png'});
      console.log('PASS real Chromium editor: sidebar '+sidebar+'px; all text disclosures; decimal spacing; formatting; stable number layout; background; applied design');
      if(sidebar===336) {
        for(const name of ['Image','Split','Button','Header bar','Drop shadow','Divider','Social links','Spacer','Product','Coupon','Table','Review quote','Video','HTML','Columns','Section']) {
          await page.getByRole('button',{name:'Add content',exact:true}).click();
          await page.getByRole('button',{name,exact:true}).click();
          const groups=body.locator('details.email-block-section');
          for(let i=0;i<await groups.count();i++) {
            const group=groups.nth(i),old=await group.evaluate(n=>n.open);
            await group.locator(':scope > summary').click();
            await page.waitForTimeout(20);
            assert.equal(await group.evaluate(n=>n.open),!old,name+' section '+i);
          }
          console.log('PASS Chromium disclosures: '+name+' ('+await groups.count()+' groups)');
        }
        await page.getByRole('button',{name:'Edit styles',exact:true}).click();
        const themeGroups=body.locator('details.email-block-section');
        assert.equal(await themeGroups.count(),4);
        for(let i=0;i<await themeGroups.count();i++) {
          const group=themeGroups.nth(i),old=await group.evaluate(n=>n.open);
          await group.locator(':scope > summary').click();await page.waitForTimeout(20);
          assert.equal(await group.evaluate(n=>n.open),!old);
        }
        console.log('PASS Chromium template style disclosures');
      }
      await page.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
