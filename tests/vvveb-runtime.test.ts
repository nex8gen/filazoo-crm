import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import jsdom from "jsdom";
const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;

test("vendored Vvveb loads, edits blocks, captures styles and supports undo/redo", async () => {
  const errors: string[] = [];
  const console = new VirtualConsole();
  console.on("jsdomError", error => { if (!error.message.includes("Could not parse CSS")) errors.push(error.message); });
  const dom = new JSDOM(readFileSync("public/vendor/vvveb/editor.html", "utf8"), { url: "https://filazoo.test/vendor/vvveb/editor.html", runScripts: "dangerously", resources: { interceptors: [requestInterceptor((request: Request) => {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith("/vendor/vvveb/")) return new Response("", { status: 404 });
    try { return new Response(readFileSync(resolve("public", "." + pathname)), { headers: { "Content-Type": pathname.endsWith(".js") ? "application/javascript" : pathname.endsWith(".css") ? "text/css" : "text/html" } }); }
    catch { return new Response("", { status: 404 }); }
  })] }, pretendToBeVisual: true, virtualConsole: console });
  const window = dom.window;
  const send = (data: object) => window.dispatchEvent(new window.MessageEvent("message", { origin: "https://filazoo.test", source: window, data }));
  const wait = async (ready: () => boolean) => {
    for (let i = 0; i < 100 && !ready(); i++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(ready(), errors.join("\n"));
  };
  try {
    await new Promise(resolve => window.addEventListener("load", resolve, { once: true }));
    send({ type: "filazoo:init", website: { html: "<section><h1>My brand</h1></section>", css: "h1{color:red}" }, accent: "#25865b", css: "body{margin:0}", dark: false });
    await wait(() => Boolean(window.document.querySelector("iframe")?.contentDocument?.querySelector("h1")));
    const vvveb = window.eval("Vvveb");
    const canvas = vvveb.Builder.iframe.contentDocument as Document;
    assert.equal(canvas.querySelector("h1")?.textContent, "My brand");
    assert.equal(canvas.querySelectorAll("#vvvebjs-styles").length, 1);
    assert.equal(canvas.querySelector("#vvvebjs-styles")?.textContent, "h1{color:red}");
    assert.equal(window.document.querySelector("iframe")?.getAttribute("sandbox"), "allow-same-origin");
    vvveb.Builder.selectNode(canvas.querySelector("h1"));
    vvveb.Builder.loadNodeComponent(canvas.querySelector("h1"));
    assert.ok(window.document.querySelector('.component-properties input, .component-properties textarea'));
    const image = canvas.createElement("img"); image.src = "https://example.com/photo.png"; canvas.body.append(image);
    vvveb.Builder.selectNode(image);
    vvveb.Builder.loadNodeComponent(image);
    assert.ok(window.document.querySelector('input[value], input[type="text"]'));
    vvveb.StyleManager.setStyle(canvas.querySelector("h1"), "letter-spacing", "2px");
    const container = canvas.createElement("div");
    container.innerHTML = vvveb.Blocks.get("filazoo/features").html;
    const section = container.firstChild!;
    canvas.body.appendChild(section);
    vvveb.Undo.addMutation({ type: "childList", target: canvas.body, addedNodes: [section], nextSibling: null });
    assert.ok(canvas.body.textContent?.includes("Personal support"));
    vvveb.Undo.undo();
    assert.ok(!canvas.body.textContent?.includes("Personal support"));
    vvveb.Undo.redo();
    assert.ok(canvas.body.textContent?.includes("Personal support"));
    const result = new Promise<MessageEvent>(resolve => window.addEventListener("message", event => { if (event.data?.type === "filazoo:result") resolve(event as unknown as MessageEvent); }));
    send({ type: "filazoo:capture", requestId: "capture-current-page" });
    const captured = (await result).data;
    assert.equal(captured.requestId, "capture-current-page");
    const payload = captured.website;
    assert.match(payload.html, /My brand/);
    assert.match(payload.html, /Personal support/);
    assert.match(payload.css, /letter-spacing: 2px/);
    send({ type: "filazoo:brand", accent: "#5261d8" });
    assert.match(canvas.querySelector("#filazoo-base")?.textContent || "", /#5261d8/);
    assert.deepEqual(errors, []);
  } finally { window.close(); }
});
