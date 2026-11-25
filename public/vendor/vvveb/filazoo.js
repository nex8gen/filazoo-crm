/* Filazoo adapter for the Apache-2.0 VvvebJs editor. No PHP endpoints are used. */
(function () {
  const origin = location.origin;
  const send = (type, payload = {}) => parent.postMessage({ type, ...payload }, origin);
  let initialized = false;
  let baseCss = "";
  window.renameUrl = window.deleteUrl = window.saveReusableUrl = window.oEmbedProxyUrl = "";
  Vvveb.ComponentsGroup = { "Page elements": ["html/heading", "html/paragraph", "html/image", "html/link", "html/list", "html/blockquote", "html/hr", "html/table"] };
  // Use HTTPS image URLs; the upstream PHP uploader is not part of this app.
  ImageInput.init = function (data) { return this.render("imageinput", data); };
  ImageInput.setValue = function (value) { this.element[0].querySelector('input[type="text"]').value = value || ""; };
  ImageInput.events = [["focusout", "onChange", 'input[type="text"]']];
  const layouts = {
    hero: { name: "Welcome banner", html: '<section style="padding:64px 32px;background:#edf5ef;border-radius:20px"><p style="color:var(--brand);font-weight:700">WELCOME TO OUR WEBSITE</p><h1 style="font-size:44px;max-width:700px">A better experience, built around you.</h1><p style="max-width:580px">Tell your customers what makes your business special.</p><a href="https://example.com" style="display:inline-block;padding:12px 22px;background:var(--brand);color:#fff;border-radius:10px;text-decoration:none">Discover more</a></section>' },
    features: { name: "Three feature cards", html: '<section style="padding:40px 24px"><h2 style="font-size:32px">Made for your business</h2><div class="fz-grid"><article style="padding:24px;border:1px solid #dce6df;border-radius:16px"><h3>Quality you can trust</h3><p>Share the details that set you apart.</p></article><article style="padding:24px;border:1px solid #dce6df;border-radius:16px"><h3>Personal support</h3><p>Help customers find their next step.</p></article><article style="padding:24px;border:1px solid #dce6df;border-radius:16px"><h3>Built around you</h3><p>Introduce your services and expertise.</p></article></div></section>' },
    about: { name: "About your business", html: '<section style="padding:48px 28px"><p style="color:var(--brand)">OUR STORY</p><h2 style="font-size:36px">Introduce your business</h2><p style="max-width:700px">Add your story, values, and the people behind your business. Double-click any text to make it your own.</p></section>' },
    contact: { name: "Contact details", html: '<section style="padding:36px;background:#f3f5f4;border-radius:16px"><h2>Let’s talk</h2><p>Have a question? We would love to hear from you.</p><a href="mailto:hello@example.com">hello@example.com</a></section>' },
    gallery: { name: "Image & caption", html: '<figure style="margin:0;padding:24px"><img src="https://placehold.co/1200x600/png" alt="Replace with your own image" style="width:100%;border-radius:16px"><figcaption style="padding:12px 0;color:#637168">Your image caption</figcaption></figure>' }
  };
  Vvveb.BlocksGroup = { "Filazoo sections": [] };
  Object.entries(layouts).forEach(([id, block]) => {
    Vvveb.Blocks.add("filazoo/" + id, { ...block, image: "icons/section.svg" });
    Vvveb.BlocksGroup["Filazoo sections"].push("filazoo/" + id);
  });
  // The native editor performs visual mutations; persistence stays in Filazoo.
  Vvveb.Gui.saveAjax = () => send("filazoo:apply-request");
  Vvveb.Builder.saveAjax = () => send("filazoo:apply-request");
  window.addEventListener("message", event => {
    if (event.source !== parent || event.origin !== origin || !event.data) return;
    if (event.data.type === "filazoo:init" && !initialized) {
      initialized = true;
      const { website, css, accent, dark } = event.data;
      baseCss = css;
      document.documentElement.setAttribute("data-bs-theme", dark ? "dark" : "light");
      document.documentElement.style.setProperty("--bs-primary", accent);
      Vvveb.Builder.init("canvas.html", () => {
        const doc = Vvveb.Builder.iframe.contentDocument;
        doc.body.innerHTML = website.html;
        const style = doc.getElementById("vvvebjs-styles") || doc.createElement("style");
        style.id = "vvvebjs-styles";
        style.textContent = website.css;
        doc.head.append(style);
        const base = doc.createElement("style");
        base.id = "filazoo-base";
        base.textContent = baseCss + ":root{--brand:" + accent + "}";
        doc.head.prepend(base);
        Vvveb.StyleManager.init(doc);
        Vvveb.Undo.reset();
        new MutationObserver(() => send("filazoo:dirty")).observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true });
        new MutationObserver(() => send("filazoo:dirty")).observe(style, { childList: true, subtree: true, characterData: true });
        doc.addEventListener("click", e => { if (e.target.closest("a")) e.preventDefault(); });
        Vvveb.TreeList.loadComponents();
        send("filazoo:loaded");
      });
      Vvveb.Gui.init();
      Vvveb.FileManager.init();
      Vvveb.SectionList.init();
      Vvveb.StyleList.init();
      Vvveb.TreeList.init();
      Vvveb.Breadcrumb.init();
      Vvveb.CssEditor.init();
      document.addEventListener("keydown", event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopImmediatePropagation(); send("filazoo:apply-request"); }
      }, true);
      // Remove upstream demo/backend controls, including their keyboard bindings.
      document.querySelectorAll('[data-vvveb-action="saveAjax"], [data-vvveb-action="download"], [data-vvveb-action="newPage"], [data-vvveb-action="deletePage"], [data-vvveb-action="renamePage"]').forEach(el => el.remove());
    }
    if (event.data.type === "filazoo:brand" && /^#[a-f\d]{6}$/i.test(event.data.accent || "")) {
      const base = Vvveb.Builder.iframe?.contentDocument?.getElementById("filazoo-base");
      if (base) base.textContent = baseCss + ":root{--brand:" + event.data.accent + "}";
    }
    if (event.data.type === "filazoo:capture" && Vvveb.Builder.iframe?.contentDocument) {
      const doc = Vvveb.Builder.iframe.contentDocument;
      const clone = doc.body.cloneNode(true);
      clone.querySelectorAll("[contenteditable]").forEach(el => el.removeAttribute("contenteditable"));
      send("filazoo:result", { requestId: event.data.requestId, website: { html: clone.innerHTML, css: doc.getElementById("vvvebjs-styles")?.textContent || "" } });
    }
  });
  window.addEventListener("error", () => send("filazoo:error"));
  send("filazoo:ready");
})();
