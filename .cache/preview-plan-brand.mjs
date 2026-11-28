import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync('tests/subscription-plan-form.test.ts', 'utf8').replace(/\btest\(/g, 'skipPreviewTest(');
const setup = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const preview = `
function skipPreviewTest() {}
const ui = await mount({ enabled: false });
await ui.click('[name="plan"][value="business"]');
const { renderToStaticMarkup } = await import('react-dom/server');
const { compile } = await import('@tailwindcss/node');
const { AccountSetupProgress } = requireComponent('@/components/account-setup-progress');
const progress = renderToStaticMarkup(React.createElement(AccountSetupProgress, { current: 2, className: 'subscription-progress' }));
const body = '<main class="subscription-page"><div class="subscription-container"><section class="subscription-hero"><p class="subscription-eyebrow">Your plan</p><h1>A plan for your business</h1><p class="subscription-intro">Your customers, conversations, and team. One connected workspace, with room to grow.</p>' + progress + '</section>' + ui.host.innerHTML + '</div></main>';
const classes = [...new Set([...new JSDOM(body).window.document.querySelectorAll('[class]')].flatMap(element => element.getAttribute('class').split(/\\s+/)))];
const compiler = await compile(readFileSync('app/globals.css', 'utf8'), { base: process.cwd() + '/app', onDependency() {} });
const css = compiler.build(classes) + readFileSync('app/ai-theme.css','utf8') + readFileSync('components/ai-icon.css','utf8') + readFileSync('app/subscribe/subscribe.css','utf8') + ':root { --font-sans: Arial, sans-serif; }';
const html = (content, theme = '') => '<!doctype html><html class="' + theme + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plan brand preview</title><style>' + css + '</style></head><body>' + content + '</body></html>';
const { writeFileSync } = await import('node:fs');
writeFileSync('.cache/plan-brand-preview.html', html(body));
writeFileSync('.cache/plan-brand-preview-dark.html', html(body, 'dark'));
const mobile = html(body).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
writeFileSync('.cache/plan-brand-preview-mobile.html', '<!doctype html><title>Mobile plan preview</title><style>body{margin:0;background:#ddd;display:flex;justify-content:center}iframe{width:390px;height:950px;border:0;background:white}</style><iframe srcdoc="' + mobile + '"></iframe>');
await ui.dispose();
console.log('Rendered plan previews with actual form markup and styles.');
`;
fs.writeFileSync('.cache/preview-plan-brand-source.mjs', setup + preview);
await import('./preview-plan-brand-source.mjs');
