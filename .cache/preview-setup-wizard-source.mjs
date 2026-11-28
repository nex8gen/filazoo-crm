import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/workspaces/setup" });
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "FormData", "Event"])
    Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync("app/workspaces/setup/setup-wizard.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
async function mount(props = { canInvite: true, canAddCustomer: true }, overrides = {}) {
    const calls = [];
    const stub = (operation) => async (previous, form) => {
        calls.push({ operation, values: Object.fromEntries(form) });
        return overrides[operation]?.(previous, form) ?? { success: "Saved", ...(operation === "invite" ? { invitationUrl: "https://crm.test/join/private-token" } : {}) };
    };
    const dependencies = {
        "next/link": { default: ({ children, ...rest }) => React.createElement("a", rest, children) },
        "./setup-wizard.module.css": { default: new Proxy({}, { get: (_, name) => "wizard_" + name }) },
        "@/app/settings/team-actions": { createTeamInvitation: stub("invite") },
        "@/app/settings/apps/gmail-actions": { saveGmailConnection: stub("gmail") },
        "@/app/settings/apps/netease-actions": { saveNeteaseConnection: stub("netease") },
        "@/app/settings/actions": { savePersonalMailbox: stub("smtp") },
        "@/app/crm-actions": { createCompany: stub("customer") },
    };
    const exports = {};
    vm.runInNewContext(source, { exports, require: (name) => dependencies[name] ?? require(name), navigator });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await React.act(async () => root.render(React.createElement(exports.SetupWizard, { ...props, workspaceName: "Test workspace" })));
    return {
        host, calls,
        async rerender(nextProps) { await React.act(async () => root.render(React.createElement(exports.SetupWizard, { ...nextProps, workspaceName: "Test workspace" }))); },
        title: () => host.querySelector("h1").textContent,
        async edit(name, value) {
            await React.act(async () => {
                const input = host.querySelector(`[name="${name}"]`);
                const prototype = input.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
                Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
                input.dispatchEvent(new dom.window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
            });
        },
        async click(text) {
            const button = [...host.querySelectorAll("button")].find(button => button.textContent === text);
            assert.ok(button, text);
            await React.act(async () => button.click());
        },
        async submit() { await React.act(async () => host.querySelector("form").requestSubmit()); },
        async dispose() { await React.act(async () => root.unmount()); host.remove(); },
    };
}
skipPreviewTest("setup starts with the first permitted form and skipping never saves data", async () => {
    const ui = await mount({ canInvite: false, canAddCustomer: false });
    try {
        assert.equal(ui.title(), "Connect your email");
        assert.equal(ui.host.querySelector('[role="tab"]'), null);
        assert.equal(ui.host.querySelector('a[href="/settings/apps"]'), null);
        await ui.edit("email", "draft@example.com");
        await ui.click("Skip for now");
        assert.equal(ui.title(), "You're ready to go");
        assert.equal(ui.host.querySelector('a[href="/analytics"]')?.textContent, "Open your CRM");
        await ui.click("Back");
        assert.equal(ui.host.querySelector('[name="email"]').value, "draft@example.com");
        assert.equal(ui.calls.length, 0);
    }
    finally {
        await ui.dispose();
    }
});
skipPreviewTest("inline setup creates an invitation, connects email, creates a customer and preserves completed steps on Back", async () => {
    const ui = await mount();
    try {
        assert.equal(ui.title(), "Invite your team");
        await ui.edit("displayName", "Alex Morgan");
        await ui.edit("email", "alex@example.com");
        await ui.submit();
        assert.equal(ui.title(), "Invite your team");
        assert.equal(ui.host.querySelector('input[readonly]').value, "https://crm.test/join/private-token");
        await ui.rerender({ canInvite: false, canAddCustomer: true });
        assert.equal(ui.title(), "Invite your team", "capacity revalidation must not change the active step");
        await ui.click("Next");
        assert.equal(ui.title(), "Connect your email");
        await ui.edit("email", "sales@gmail.com");
        await ui.edit("password", "abcdefghijklmnop");
        await ui.submit();
        assert.equal(ui.title(), "Add your first customer");
        await ui.click("Back");
        assert.equal(ui.host.querySelector('[name="email"]').value, "sales@gmail.com");
        assert.equal(ui.host.querySelector('[name="password"]').value, "");
        assert.equal(ui.host.querySelector('fieldset').disabled, true);
        await ui.click("Next");
        await ui.edit("name", "Acme Industries");
        await ui.edit("country", "China");
        await ui.edit("segment", "Wholesale");
        await ui.submit();
        assert.equal(ui.title(), "You're ready to go");
        assert.deepEqual(ui.calls.map(call => call.operation), ["invite", "gmail", "customer"]);
        assert.equal(ui.calls[1].values.appPassword, "abcdefghijklmnop");
        assert.equal(ui.calls[1].values.mailboxScope, "personal");
        assert.deepEqual(JSON.parse(String(ui.calls[1].values.syncPreferences)), { historyLimit: 500, historyFolders: "inbox_sent", historyPaused: false });
        assert.equal(ui.calls[2].values.name, "Acme Industries");
        assert.equal(ui.calls[2].values.contactRole, "");
        await ui.click("Back");
        await ui.click("Next");
        assert.equal(ui.calls.length, 3);
    }
    finally {
        await ui.dispose();
    }
});
skipPreviewTest("failed saves remain on the current form with their inputs and server error", async () => {
    const ui = await mount(undefined, { invite: async () => ({ error: "Every included user place is in use." }) });
    try {
        await ui.edit("displayName", "Alex Morgan");
        await ui.edit("email", "alex@example.com");
        await ui.submit();
        assert.equal(ui.title(), "Invite your team");
        assert.match(ui.host.querySelector('[role="alert"]').textContent, /user place/);
        assert.equal(ui.host.querySelector('[name="email"]').value, "alex@example.com");
        await ui.click("Skip for now");
        await ui.click("Back");
        assert.equal(ui.title(), "Invite your team");
        assert.equal(ui.calls.length, 1);
    }
    finally {
        await ui.dispose();
    }
});
skipPreviewTest("NetEase and custom email submit the selected transport settings to existing actions", async () => {
    for (const provider of ["netease", "smtp"]) {
        const ui = await mount({ canInvite: false, canAddCustomer: true });
        try {
            await ui.edit("provider", provider);
            await ui.edit("email", "sales@example.com");
            await ui.edit("password", "client-password");
            if (provider === "smtp") {
                await ui.edit("smtpHost", "smtp.example.com");
                await ui.edit("imapHost", "imap.example.com");
            }
            await ui.submit();
            assert.equal(ui.title(), "Add your first customer");
            assert.equal(ui.calls[0].operation, provider);
            const values = ui.calls[0].values;
            if (provider === "netease") {
                assert.equal(values.clientPassword, "client-password");
                assert.equal(values.serverProfile, "standard");
                assert.equal(values.smtpPort, "994");
            }
            else {
                assert.equal(values.smtpPassword, "client-password");
                assert.equal(values.imapPassword, "client-password");
                assert.equal(values.smtpUsername, "sales@example.com");
                assert.equal(values.imapUsername, "sales@example.com");
            }
        }
        finally {
            await ui.dispose();
        }
    }
});
skipPreviewTest("the setup page checks invitation capacity only for administrators and excludes customer creation for viewers", async () => {
    const pageSource = ts.transpileModule(readFileSync("app/workspaces/setup/page.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    for (const [role, canInvite, capacityFails] of [["admin", true, false], ["admin", false, false], ["admin", false, true], ["viewer", false, false], ["operator", false, false]]) {
        let checks = 0;
        const dependencies = {
            "@/lib/auth": { requireWorkspaceMember: async () => ({ role, workspaceId: "workspace", workspaceName: "Test workspace" }) },
            "@/lib/data/team-capacity": { readTeamCapacity: async () => { checks++; if (capacityFails)
                    throw Error("unavailable"); return { canInvite }; } },
            "@/components/onboarding-shell": { OnboardingShell: () => null },
            "./setup-wizard": { SetupWizard: () => null },
        };
        const exports = {};
        vm.runInNewContext(pageSource, { exports, require: (name) => dependencies[name] ?? require(name) });
        const result = await exports.default();
        assert.equal(checks, role === "admin" ? 1 : 0);
        assert.equal(result.props.children.props.canInvite, canInvite);
        assert.equal(result.props.children.props.canAddCustomer, role !== "viewer");
        assert.equal(result.props.children.key, "workspace");
    }
});

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
const classes=[...new Set(pages.flatMap(([,html])=>[...new JSDOM(html).window.document.querySelectorAll('[class]')].flatMap(el=>el.className.baseVal?.split(/\s+/)??el.className.split(/\s+/))))];
const compiler=await compile(readFileSync('app/globals.css','utf8'),{base:process.cwd()+'/app',onDependency(){}});
let css=compiler.build(classes);
css+='\n'+readFileSync('app/workspaces/setup/setup-wizard.module.css','utf8').replace(/:global\(([^)]+)\)/g,'$1').replace(/\.([a-zA-Z][\w-]*)/g,(all,name)=>name==='dark'?all:'.wizard_'+name);
css+='\n'+readFileSync('components/onboarding-shell.module.css','utf8').replace(/:global\(([^)]+)\)/g,'$1').replace(/\.([a-zA-Z][\w-]*)/g,(all,name)=>name==='dark'?all:'.shell_'+name);
css+='\n:root{--font-sans:Arial,sans-serif}body{margin:0;font-family:Arial,sans-serif}';
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
