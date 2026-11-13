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
    import { Save, Copy, Download, Trash2, ChevronDown } from 'lucide-react';
    import { Button } from './components/ui/button';
    import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from './components/ui/dropdown-menu';
    import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './components/ui/select';
    const longLabel = 'A very long translated option that exceeds the entire width of a small mobile screen';
    createRoot(document.getElementById('root')).render(<div style={{display:'flex',gap:8,justifyContent:'flex-end',padding:16}}>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm"/>}>Manage template<ChevronDown/></DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem><Save/>Save as template</DropdownMenuItem><DropdownMenuItem><Copy/>Save as new template</DropdownMenuItem><DropdownMenuItem><Download/>Export HTML</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem><Trash2/>Clear content</DropdownMenuItem>
        <DropdownMenuSub><DropdownMenuSubTrigger>More options</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem>Move to another workspace</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub>
        <DropdownMenuCheckboxItem>Show all available columns</DropdownMenuCheckboxItem><DropdownMenuRadioGroup><DropdownMenuRadioItem value="ask">Ask for approval</DropdownMenuRadioItem></DropdownMenuRadioGroup>
      </DropdownMenuContent></DropdownMenu>
      <Select><SelectTrigger aria-label="Sort"><SelectValue placeholder="Sort"/></SelectTrigger><SelectContent><SelectItem value="short">Recently updated first</SelectItem><SelectItem value="long">{longLabel}</SelectItem></SelectContent></Select>
    </div>);
  `;
  const candidates = new Set(entry.split(/[\s"'`]+/));
  for (const name of ['dropdown-menu','select','button']) for (const word of fs.readFileSync(`components/ui/${name}.tsx`,'utf8').split(/[\s"`]+/)) candidates.add(word);
  const compiler = await compile(fs.readFileSync('app/globals.css','utf8'),{base:path.resolve('app'),onDependency(){}});
  const css = compiler.build([...candidates]);
  const bundle = await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
  const browser = await chromium.launch({headless:true});
  try {
    for(const width of [1440,375,320]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      if(process.argv.includes('--app')) {
        await page.goto('http://localhost:3000/login',{waitUntil:'domcontentloaded',timeout:30000});
        await page.evaluate(()=>{const root=document.createElement('div');root.id='root';Object.assign(root.style,{position:'fixed',inset:'0',background:'white',zIndex:'1'});document.body.append(root);});
      } else await page.setContent('<style>'+css+'</style><div id="root"></div>');
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.getByRole('button',{name:'Manage template'}).click();
      const menu=page.locator('[data-slot="dropdown-menu-content"]');
      await menu.waitFor({state:'visible'});
      await page.waitForTimeout(250);
      const result=await menu.evaluate(menu=>{
        const box=menu.getBoundingClientRect();
        const rows=[...menu.querySelectorAll(':scope > [role^="menuitem"]')].map(item=>{
          const ranges=[];const walker=document.createTreeWalker(item,NodeFilter.SHOW_TEXT);
          while(walker.nextNode()){const range=document.createRange();range.selectNodeContents(walker.currentNode);for(const rect of range.getClientRects())ranges.push({left:rect.left,right:rect.right,top:rect.top});}
          return {text:item.textContent,lines:new Set(ranges.map(r=>Math.round(r.top))).size,fits:ranges.every(r=>r.left>=box.left&&r.right<=box.right)};
        });
        return {width:box.width,left:box.left,right:box.right,client:menu.clientWidth,scroll:menu.scrollWidth,rows};
      });
      assert.equal(result.scroll,result.client,`Menu must not need horizontal scrolling: ${JSON.stringify(result)}`);
      assert.ok(result.left>=0&&result.right<=width);
      for(const row of result.rows){assert.equal(row.lines,1,row.text);assert.ok(row.fits,`Full label visible: ${row.text}`);}
      if(width===375)await page.screenshot({path:'.cache/template-dropdown-mobile.png'});
      const save=await page.getByRole('menuitem',{name:'Save as new template',exact:true}).boundingBox();
      assert.ok(save.width>162,'Template action expands beyond narrow trigger');
      await page.getByRole('menuitem',{name:'More options',exact:true}).hover();
      await page.getByRole('menuitem',{name:'Move to another workspace'}).waitFor({state:'visible'});
      const sub=await page.locator('[data-slot="dropdown-menu-sub-content"]').evaluate(m=>({client:m.clientWidth,scroll:m.scrollWidth}));
      assert.equal(sub.client,sub.scroll,'Submenu full label fits');
      await page.keyboard.press('Escape');await page.keyboard.press('Escape');
      await page.getByRole('combobox',{name:'Sort'}).click();
      await page.getByRole('option',{name:'Recently updated first'}).waitFor({state:'visible'});
      const select=await page.locator('[data-slot="select-content"]').evaluate(m=>({left:m.getBoundingClientRect().left,right:m.getBoundingClientRect().right,client:m.clientWidth,scroll:m.scrollWidth,overflow:getComputedStyle(m).overflowX}));
      assert.ok(select.left>=0&&select.right<=width);
      if(select.scroll>select.client)assert.equal(select.overflow,'auto');
      await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
      assert.deepEqual(errors,[]);
      console.log(`PASS ${width}px: full template labels visible with no horizontal scroll; submenu fits; long select options remain accessible; keyboard interaction works.`);
      if(width===375)await page.screenshot({path:'.cache/dropdown-layout-mobile.png'});
      await page.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
