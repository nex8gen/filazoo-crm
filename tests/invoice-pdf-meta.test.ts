import test from "node:test";
import assert from "node:assert/strict";
import { invoicePdfFilename, mergeInvoiceAttachment } from "../lib/invoice-pdf-meta.ts";

const attachment = { id: "invoice-123", filename: "INV-000003-DRAFT.pdf", content: "JVBERi0=", contentType: "application/pdf", size: 100 };
test("draft and void invoice filenames are unambiguous", () => {
  assert.equal(invoicePdfFilename({number:3,status:"draft"}),"INV-000003-DRAFT.pdf");
  assert.equal(invoicePdfFilename({number:3,status:"issued"}),"INV-000003.pdf");
  assert.equal(invoicePdfFilename({number:3,status:"void"}),"INV-000003-VOID.pdf");
});
test("reattaching replaces the older invoice PDF and retains other files", () => {
  const other = {...attachment,id:"catalog",filename:"catalog.pdf"};
  const old = {...attachment,content:"old"};
  assert.deepEqual(mergeInvoiceAttachment([old,other],attachment),[other,attachment]);
});
test("invoice attachments respect file count and size limits, including replacements", () => {
  const ten = Array.from({length:10},(_,i)=>({...attachment,id:String(i)}));
  assert.throws(()=>mergeInvoiceAttachment(ten,attachment),/10 files/);
  assert.equal(mergeInvoiceAttachment(ten,{...attachment,id:"0"}).length,10);
  assert.throws(()=>mergeInvoiceAttachment([],{...attachment,size:7_500_001}),/7.5 MB/);
});
