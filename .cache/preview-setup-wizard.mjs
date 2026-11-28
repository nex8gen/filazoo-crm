import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync('tests/workspace-setup-wizard.test.ts','utf8').replace(/\btest\(/g,'skipPreviewTest(').replace('"./setup-wizard.module.css": { default: {} }','"./setup-wizard.module.css": { default: new Proxy({}, { get: (_, name) => "wizard_" + name }) }');
const setup=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const preview=`
function skipPreviewTest() {}
const pages=[];
const ui=await mount();
pages.push(['team',ui.host.innerHTML]);
await ui.click('Skip for now');
pages.push(['email',ui.host.innerHTML]);
await ui.edit('provider','smtp');
pages.push(['email-smtp',ui.host.innerHTML]);
await ui.click('Skip for now');
pages.push(['customer',ui.host.innerHTML]);
await ui.click('Skip for now');
pages.push(['complete',ui.host.innerHTML]);
const {compile}=await import('@tailwindcss/node');
const {writeFileSync}=await import('node:fs');
const classes=[...new Set(pages.flatMap(([,html])=>[...new JSDOM(html).window.document.querySelectorAll('[class]')].flatMap(el=>el.className.baseVal?.split(/\\s+/)??el.className.split(/\\s+/))))];
const compiler=await compile(readFileSync('app/globals.css','utf8'),{base:process.cwd()+'/app',onDependency(){}});
let css=compiler.build(classes);
css+='\\n'+readFileSync('app/workspaces/setup/setup-wizard.module.css','utf8').replace(/:global\\(([^)]+)\\)/g,'$1').replace(/\\.([a-zA-Z][\\w-]*)/g,(all,name)=>name==='dark'?all:'.wizard_'+name);
css+='\\n'+readFileSync('components/onboarding-shell.module.css','utf8').replace(/:global\\(([^)]+)\\)/g,'$1').replace(/\\.([a-zA-Z][\\w-]*)/g,(all,name)=>name==='dark'?all:'.shell_'+name);
css+='\\n:root{--font-sans:Arial,sans-serif}body{margin:0;font-family:Arial,sans-serif}';
for(const [name,html] of pages){
 const body='<main class="shell_page"><div class="shell_body">'+html+'</div><footer class="shell_footer">Your workspace. Your data. Your team.<span>Terms · Privacy</span></footer></main>';
 for(const theme of ['light','dark']){
  const page='<!doctype html><html class="'+(theme==='dark'?'dark':'')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NewAI setup '+name+'</title><style>'+css+'</style></head><body>'+body+'</body></html>';
  writeFileSync('.cache/setup-'+name+'-'+theme+'.html',page);
  if(theme==='light')writeFileSync('.cache/setup-'+name+'-mobile.html','<!doctype html><title>Mobile '+name+'</title><style>body{margin:0;background:#ddd;display:flex;justify-content:center}iframe{width:390px;height:1150px;border:0;background:white}</style><iframe srcdoc="'+page.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"></iframe>');
 }
}
await ui.dispose();
console.log('Created desktop, dark and mobile previews of all setup forms from their rendered markup.');
`;
fs.writeFileSync('.cache/preview-setup-wizard-source.mjs',setup+preview);
await import('./preview-setup-wizard-source.mjs');
