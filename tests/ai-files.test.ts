import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { chatFileSchema, chatMessageSchema, chatImageLimitError, collectChatFiles, MAX_CHAT_FILE_BYTES, type ProviderFile } from "../lib/ai/image-input.ts";
import { prepareChatAttachments } from "../lib/ai/image-input-client.ts";
import { prepareProviderFiles } from "../lib/ai/file-input-server.ts";
import { companyChatSchema } from "../lib/ai/company-chat.ts";
import { workspaceAssistantSchema, buildWorkspaceAssistantPrompt } from "../lib/ai/workspace-assistant.ts";
import { generateGatewayText } from "../lib/ai/gateway.ts";
import { readChatLibraryFiles } from "../lib/ai/file-input-library-client.ts";

const require = createRequire(import.meta.url);
const image = { name: "address.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=" };
const file = (name: string, mediaType: string, data: string | Uint8Array): ProviderFile => ({ name, mediaType, dataUrl: `data:${mediaType};base64,${Buffer.from(data).toString("base64")}`, label: "Message 1, file 1" });
const withoutLabel = ({ name, mediaType, dataUrl }: ProviderFile) => ({ name, mediaType, dataUrl });
const attachment = (name = "notes.txt") => withoutLabel(file(name, "text/plain", "Customer requests 10 kg."));
const message = { role: "user" as const, content: "", images: [image], files: Array.from({ length: 4 }, (_, i) => attachment(`${i}.txt`)) };
const request = { mode: "analyze", pathname: "/", pageLabel: "Home", pageText: "", messages: [message] };

test("both endpoints accept five mixed attachments or five files without a text prompt and reject a sixth", () => {
  for (const turns of [[message], [{ role: "user", content: "", files: Array.from({ length: 5 }, () => attachment()) }], [{ role: "user", content: "", images: Array.from({ length: 5 }, () => image) }]]) {
    assert.equal(companyChatSchema.safeParse({ messages: turns }).success, true);
    assert.equal(workspaceAssistantSchema.safeParse({ ...request, messages: turns }).success, true);
  }
  const overflow = { ...message, files: [...message.files, attachment()] };
  assert.equal(chatMessageSchema.safeParse(overflow).success, false);
  assert.equal(workspaceAssistantSchema.safeParse({ ...request, messages: [overflow] }).success, false);
  assert.equal(companyChatSchema.safeParse({ messages: [{ ...message, role: "assistant" }] }).success, false);
  assert.match(chatImageLimitError([overflow])!, /up to 5/);
});

test("any MIME type including extensionless, archive and executable files can attach; transport bytes and total size stay validated", () => {
  for (const mediaType of ["application/octet-stream", "application/zip", "application/x-msdownload", "image/svg+xml", "audio/mpeg", "video/mp4"]) {
    const value = withoutLabel(file("arbitrary", mediaType, new Uint8Array([0, 1, 255])));
    assert.equal(chatFileSchema.safeParse(value).success, true);
  }
  assert.equal(chatFileSchema.safeParse({ ...attachment(), dataUrl: "https://example.com/track.txt" }).success, false);
  assert.equal(chatFileSchema.safeParse({ ...attachment(), dataUrl: "data:text/html;base64,SGVsbG8=" }).success, false);
  assert.equal(chatFileSchema.safeParse({ ...attachment(), dataUrl: "data:text/plain;base64,AAA" }).success, false);
  const tooBig = withoutLabel(file("huge.bin", "application/octet-stream", new Uint8Array(MAX_CHAT_FILE_BYTES + 1)));
  assert.equal(chatFileSchema.safeParse(tooBig).success, false);
  const large = withoutLabel(file("large.bin", "application/octet-stream", new Uint8Array(1_600_000)));
  assert.match(chatImageLimitError([{ role: "user", content: "", files: [large, large] }])!, /3 MB/);
  assert.equal(chatFileSchema.safeParse({ ...attachment(), dataUrl: "data:text/plain;base64," }).success, true);
});

test("prompts preserve file-to-turn references without embedding raw bytes", () => {
  const parsed = workspaceAssistantSchema.parse(request);
  const prompt = buildWorkspaceAssistantPrompt(parsed);
  assert.doesNotMatch(prompt, /base64/);
  assert.match(prompt, /Message 1, file 1/);
  assert.equal(collectChatFiles(parsed.messages).length, 4);
});

test("PDFs reach the provider as native files, readable text is bounded, binary formats explain their limitation", async () => {
  const pdf = file("invoice.pdf", "application/pdf", "%PDF-1.7\nexample");
  const parts = await prepareProviderFiles([pdf, file("notes.txt", "text/plain", "Customer requests 10 kg."), file("model.bin", "application/octet-stream", new Uint8Array([0, 255, 2]))]);
  assert.deepEqual(parts[1], { type: "file", mediaType: "application/pdf", filename: "invoice.pdf", data: pdf.dataUrl });
  assert.match(JSON.stringify(parts[2]), /Customer requests 10 kg/);
  assert.match(JSON.stringify(parts[3]), /unreadable/);
  const long = await prepareProviderFiles([file("large.txt", "text/plain", "x".repeat(21_000))]);
  assert.match(JSON.stringify(long), /truncated/);
  assert.ok(JSON.stringify(long).length < 21_000);
  const fakePdf = await prepareProviderFiles([file("fake.pdf", "application/pdf", "ordinary text")]);
  assert.equal(fakePdf.some(part => part.type === "file"), false);
});

test("Office documents extract ordered paragraphs and spreadsheet shared strings, with bounded archive expansion", async () => {
  const docx = zipSync({ "word/document.xml": strToU8('<w:document><w:p><w:t>Shipping &amp; billing</w:t></w:p><w:p><w:t>Address 123</w:t></w:p></w:document>') });
  const xlsx = zipSync({
    "xl/sharedStrings.xml": strToU8('<sst><si><t>Filament &amp; color</t></si></sst>'),
    "xl/worksheets/sheet1.xml": strToU8('<worksheet><row><c t="s"><v>0</v></c><c><v>42</v></c></row></worksheet>'),
  });
  const pptx = zipSync({ "ppt/slides/slide10.xml": strToU8('<a:p><a:t>Tenth slide</a:t></a:p>'), "ppt/slides/slide2.xml": strToU8('<a:p><a:t>Second slide</a:t></a:p>') });
  const text = JSON.stringify(await prepareProviderFiles([file("address.docx", "application/zip", docx), file("prices.xlsx", "application/zip", xlsx), file("slides.pptx", "application/zip", pptx)]));
  for (const expected of ["Shipping & billing", "Address 123", "Filament & color", "42"]) assert.ok(text.includes(expected));
  assert.ok(text.indexOf("Second slide") < text.indexOf("Tenth slide"));
  const oversized = zipSync({ "word/document.xml": strToU8("A".repeat(2_000_001)) });
  const bounded = await prepareProviderFiles([file("bomb.docx", "application/zip", oversized)]);
  assert.match(JSON.stringify(bounded), /unreadable/);
});

test("Gateway sends PDF and extracted file evidence in the same request as images", async () => {
  await generateGatewayText({ token: "synthetic", prompt: "Read my attachments", systemInstruction: "Use attached evidence", images: [{ ...image, label: "Message 1, image 1" }], files: [file("quote.pdf", "application/pdf", "%PDF-1.7\nexample"), file("notes.csv", "text/csv", "SKU,quantity\nPLA,20")], fetcher: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const content = body.input[0].content;
    assert.ok(content.some((part: { type: string }) => part.type === "input_image"));
    assert.ok(content.some((part: { type: string; filename: string }) => part.type === "input_file" && part.filename === "quote.pdf"));
    assert.match(JSON.stringify(content), /PLA,20/);
    return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: "Read all attachments." }] }] });
  } });
});

test("picker hook handles five mixed files, paste, removal, overflow and clearing during a read", async () => {
  const oldReader = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
  const oldBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  class Reader {
    result = ""; onload?: () => void;
    readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(buffer => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`; this.onload?.(); }); }
  }
  Object.defineProperty(globalThis, "FileReader", { configurable: true, value: Reader });
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: async () => ({ width: 1, height: 1, close() {} }) });
  try {
    const slots: unknown[] = []; let cursor = 0;
    const react = {
      useState(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value: unknown) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
      useRef(initial: unknown) { const i = cursor++; return slots[i] ??= { current: initial }; }, useId: () => "attachment-picker",
    };
    const exports: Record<string, (...args: never[]) => unknown> = {};
    const code = ts.transpileModule(readFileSync(new URL("../components/ui/ai-image-attachments.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const input = await import("../lib/ai/image-input.ts");
    function Menu() {}
    vm.runInNewContext(code, { exports, require: (name: string) => name === "react" ? react : name === "next/dynamic" ? { default: () => () => null } : name === "react/jsx-runtime" ? require(name) : name === "@/lib/ai/image-input" ? input : name === "@/lib/ai/image-input-client" ? { prepareChatAttachments } : name === "@/components/ui/dropdown-menu" ? { DropdownMenu: Menu, DropdownMenuTrigger: Menu, DropdownMenuContent: Menu, DropdownMenuItem: Menu } : {} });
    const render = () => { cursor = 0; return exports.useAiImageAttachments() as { images: typeof image[]; files: ReturnType<typeof attachment>[]; processing: boolean; error: string | null; add(files: File[]): Promise<void>; clear(): void; remove(index: number): void; onPaste(event: unknown): void }; };
    const png = new File([Buffer.from(image.dataUrl.split(",")[1], "base64")], image.name, { type: "image/png" });
    const selected = [png, ...Array.from({ length: 4 }, (_, i) => new File(["notes"], `${i}.txt`))];
    await render().add(selected);
    assert.equal(render().images.length, 1); assert.equal(render().files.length, 4);
    await render().add([new File(["sixth"], "sixth.bin")]);
    assert.match(render().error!, /up to 5/); assert.equal(render().files.length, 4);
    render().remove(1); assert.equal(render().files[0].name, "1.txt");
    let prevented = false;
    render().onPaste({ clipboardData: { files: [new File(["pasted"], "pasted.csv")] }, preventDefault() { prevented = true; } });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(prevented, true); assert.equal(render().files.at(-1)?.name, "pasted.csv");
    render().clear();
    const pending = render().add(selected);
    assert.equal(render().processing, true);
    render().clear(); await pending;
    assert.equal(render().images.length + render().files.length, 0);
    const tree = exports.AiImagePicker({ attachments: render() } as never) as { props: { children: Array<{ type: string; props: Record<string, unknown> }> } };
    const picker = tree.props.children.find(child => child.type === "input")!;
    assert.equal(picker.props.multiple, true); assert.equal(picker.props.accept, undefined);
    assert.match(JSON.stringify(tree), /Upload from computer/);
    assert.match(JSON.stringify(tree), /Browse and search your files/);
    assert.equal(exports.AiImageFeedback({ attachments: render() } as never), null, "the composer has no extra helper text");
  } finally {
    if (oldReader) Object.defineProperty(globalThis, "FileReader", oldReader); else Reflect.deleteProperty(globalThis, "FileReader");
    if (oldBitmap) Object.defineProperty(globalThis, "createImageBitmap", oldBitmap); else Reflect.deleteProperty(globalThis, "createImageBitmap");
  }
});

test("library files use authenticated links and enforce streamed size and five-file limits", async () => {
  const document = { id: "library-id", name: "notes.txt", mime_type: "text/plain", size: 5 };
  const urls: string[] = [];
  const files = await readChatLibraryFiles([document], async url => {
    urls.push(String(url));
    return String(url).startsWith("/api/documents/") ? Response.json({ url: "https://storage.example/signed-notes" }) : new Response("notes", { headers: { "content-type": "text/plain" } });
  });
  assert.deepEqual(urls, ["/api/documents/library-id?download=1", "https://storage.example/signed-notes"]);
  assert.equal(files[0].name, "notes.txt"); assert.equal(await files[0].text(), "notes");
  await assert.rejects(readChatLibraryFiles([document], async () => Response.json({ error: "Access denied" }, { status: 403 })), /Access denied/);
  await assert.rejects(readChatLibraryFiles(Array.from({ length: 6 }, () => document)), /up to 5/);
  await assert.rejects(readChatLibraryFiles([document], async url => String(url).startsWith("/api/") ? Response.json({ url: "https://storage.example/large" }) : new Response(new Uint8Array(MAX_CHAT_FILE_BYTES + 1))), /3 MB/);
});
