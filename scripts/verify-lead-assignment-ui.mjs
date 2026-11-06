// Exercise the real form and Base UI controls in an isolated DOM.
// npm install --prefix tmp/lead-assignment-db --no-save --package-lock=false --ignore-scripts @electric-sql/pglite happy-dom esbuild
// node scripts/verify-lead-assignment-ui.mjs
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Window } from "../tmp/lead-assignment-db/node_modules/happy-dom/lib/index.js";
import { build } from "../tmp/lead-assignment-db/node_modules/esbuild/lib/main.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "tmp/lead-assignment-db/form.cjs");
mkdirSync(path.dirname(output), { recursive: true });
await build({
  absWorkingDir: root, stdin: { contents: 'export { LeadAssignmentForm } from "./app/settings/lead-assignment-form.tsx"', resolveDir: root, loader: "tsx" },
  outfile: output, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic",
  plugins: [{ name: "isolated-form", setup(builder) {
    builder.onResolve({filter: /^next\/link$/}, () => ({path:"link",namespace:"fixture"}));
    builder.onResolve({filter: /lead-assignment-actions$/}, () => ({path:"actions",namespace:"fixture"}));
    builder.onResolve({filter: /^@\//}, args => {
      const base=path.join(root,args.path.slice(2));
      return {path:[base,base+".ts",base+".tsx"].find(candidate=>existsSync(candidate))};
    });
    builder.onLoad({filter: /.*/, namespace:"fixture"}, args => ({resolveDir:root,contents:args.path==="actions"
      ? "export async function updateLeadAssignmentSettings(input) { return globalThis.__saveAssignment(input); }"
      : "import {createElement,forwardRef} from 'react'; export default forwardRef(function Link(props,ref){return createElement('a',{...props,ref});});"}));
  }}],
});
const window = new Window({ url: "http://localhost/settings/advanced" });
for (const key of ["window","document","navigator","HTMLElement","HTMLInputElement","Element","Node","Event","MouseEvent","FormData","MutationObserver","getComputedStyle","requestAnimationFrame","cancelAnimationFrame","ResizeObserver"]) {
  const value=key==="window" ? window : window[key];
  if(value) Object.defineProperty(globalThis,key,{configurable:true,value:typeof value==="function"&&/^(getComputedStyle|requestAnimationFrame|cancelAnimationFrame)$/.test(key)?value.bind(window):value});
}
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { LeadAssignmentForm } = createRequire(import.meta.url)(output);
const a="aaaaaaaa-1111-4111-8111-111111111111", b="bbbbbbbb-1111-4111-8111-111111111111";
let saved={revision:0,enabled:true,strategy:"lowest_workload",workload:"all",unassigned:3,members:[
  {userId:a,name:"Manager A",enabled:true,activated:true,capacity:null,total:3,open:1,lastAssignedAt:null},
  {userId:b,name:"Inactive B",enabled:false,activated:false,capacity:null,total:0,open:0,lastAssignedAt:null},
]};
const writes=[];
let saveError="", release;
globalThis.__saveAssignment=async input=>{
  writes.push(input);
  if(release) await new Promise(resolve=>{release=resolve;});
  if(saveError)return {error:saveError};
  saved={...saved,...input,revision:saved.revision+1,members:saved.members.map(member=>({...member,...input.members.find(item=>item.userId===member.userId)}))};
  return {saved};
};
const container=window.document.createElement("div");window.document.body.append(container);
const app=createRoot(container);
await act(async()=>app.render(createElement(LeadAssignmentForm,{initial:saved})));
const query=selector=>{const found=container.querySelector(selector);assert.ok(found,selector);return found;};
const button=text=>[...container.querySelectorAll("button")].find(item=>item.textContent.includes(text));
const click=async node=>act(async()=>node.click());
const change=async(node,value)=>act(async()=>{
  const prototype=node.tagName==="SELECT"?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,"value").set.call(node,value);
  node.dispatchEvent(new window.Event(node.tagName==="SELECT"?"change":"input",{bubbles:true}));
});
const submit=()=>act(async()=>query("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
assert.equal(button("Save assignment rules").disabled,true);
assert.equal(query(`#participation-${b}`).disabled,true);
const isChecked=node=>node.getAttribute("aria-checked") ?? String(node.checked);
assert.equal(isChecked(query("#assignment-enabled")),"true");
await click(query("#assignment-enabled"));
assert.equal(isChecked(query("#assignment-enabled")),"false");
assert.match(container.textContent,/Assignment paused/);
assert.equal(writes.length,0);
await click(button("Discard changes"));
assert.equal(isChecked(query("#assignment-enabled")),"true");
assert.equal(button("Save assignment rules").disabled,true);
await change(query("#assignment-strategy"),"round_robin");
await change(query("#assignment-workload"),"open");
await change(query(`#capacity-${a}`),"5");
await click(query(`#participation-${a}`));
await submit();
assert.equal(writes.length,1);
assert.equal(writes[0].strategy,"round_robin");
assert.equal(writes[0].workload,"open");
assert.deepEqual(writes[0].members[0],{userId:a,enabled:false,capacity:5});
assert.match(container.textContent,/Assignment rules saved/);
assert.equal(button("Save assignment rules").disabled,true);
await change(query(`#capacity-${a}`),"0");
await submit();
assert.match(query('[role="alert"]').textContent,/whole-number capacities/);
assert.equal(writes.length,1);
await change(query(`#capacity-${a}`),"");
saveError="Settings changed in another session. Reload before saving.";
await submit();
assert.match(query('[role="alert"]').textContent,/Reload before saving/);
assert.equal(button("Save assignment rules").disabled,false);
await click(button("Discard changes"));
assert.equal(query(`#capacity-${a}`).value,"5");
saveError="";
await click(query("#assignment-enabled"));
release=true;
// Leave the action pending to verify controls lock until persistence completes.
await act(async()=>{query("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));});
assert.equal(button("Save assignment rules").disabled,true);
assert.equal(query("fieldset").disabled,true);
assert.equal(query("#assignment-enabled").closest("fieldset").disabled,true);
await act(async()=>{release();release=null;});
assert.equal(saved.enabled,false);
assert.equal(button("Save assignment rules").disabled,true);
assert.equal(query('a[href="/companies"]').textContent.includes("Open company assignments"),true);
assert.equal(query('a[href="/settings/team"]').textContent.includes("Manage team members"),true);
await act(async()=>app.unmount());
await window.happyDOM.close();
console.log("Passed real form controls: toggles, capacity, strategy, workload, preview, save, discard, validation, conflicts, pending locks and navigation.");
