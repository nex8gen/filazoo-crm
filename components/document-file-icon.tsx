"use client";

import { useId } from "react";

type FileIdentity = { name: string; kind?: "file" | "template"; mime_type?: string; source_type?: string | null };

const mimeExtensions: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/zip": "zip",
};

/** Folded paper and prominent format badges shared by every library surface. */
export function DocumentFileIcon({ document, size = 36, className = "" }: { document: FileIdentity; size?: number; className?: string }) {
  const id = useId();
  const extension = document.kind === "template"
    ? "txt"
    : document.name.match(/\.([^.\s]+)$/)?.[1].toLowerCase() || mimeExtensions[document.mime_type ?? ""] || "";
  const template = document.kind === "template";
  const pdf = extension === "pdf";
  const spreadsheet = /^(xlsx?|xlsm|csv|ods|tsv)$/.test(extension);
  const slides = /^(pptx?|pptm|odp)$/.test(extension);
  const word = /^(docx?|docm|odt|rtf)$/.test(extension);
  const image = document.mime_type?.startsWith("image/") || /^(png|jpe?g|gif|webp|avif|svg|heic|bmp|tiff?)$/.test(extension);
  const archive = /^(zip|rar|7z|tar|gz)$/.test(extension);
  const order = !extension && document.source_type === "purchase_order";
  const color = template ? "#8b5cf6" : pdf ? "#f04452" : spreadsheet ? "#169b62" : slides ? "#ed7838" : word ? "#3478e5" : image ? "#a05bd7" : archive ? "#d39b29" : order ? "#268e9c" : "#64748b";
  const dark = template ? "#7040cd" : pdf ? "#d92f40" : spreadsheet ? "#087a4a" : slides ? "#d65b24" : word ? "#215ac0" : image ? "#8041b7" : archive ? "#ad7617" : order ? "#16717e" : "#475569";
  const label = template ? "TXT" : pdf ? "PDF" : spreadsheet ? /^(csv|tsv)$/.test(extension) ? extension.toUpperCase() : "XLS" : slides ? "PPT" : word ? "DOC" : image ? "IMG" : archive ? "ZIP" : order ? "PO" : extension.slice(0, 4).toUpperCase() || "FILE";

  return <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 40 44"
    width={size}
    height={size * 1.1}
    className={`document-file-icon inline-block shrink-0 ${className}`}
    fill="none"
  >
    <defs>
      <linearGradient id={`${id}-paper`} x1="22" y1="3" x2="22" y2="41" gradientUnits="userSpaceOnUse"><stop stopColor="white" /><stop offset="1" stopColor="#f3f4f6" /></linearGradient>
      <linearGradient id={`${id}-badge`} x1="3" y1="21" x2="32" y2="37" gradientUnits="userSpaceOnUse"><stop stopColor={color} /><stop offset="1" stopColor={dark} /></linearGradient>
    </defs>
    <path d="M12 4h13l11 11v24a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" fill="#0f172a" fillOpacity=".08" transform="translate(0 1)" />
    <path d="M12 3h13l11 11v24a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" fill={`url(#${id}-paper)`} stroke="#cbd0d8" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M25 3v8a3 3 0 0 0 3 3h8" fill="#e9edf2" stroke="#cbd0d8" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M14 17h13M14 20h9" stroke={color} strokeOpacity=".28" strokeWidth="1.5" strokeLinecap="round" />
    <rect x="2" y="24" width="31" height="15" rx="4" fill={dark} fillOpacity=".16" />
    <rect x="2" y="22" width="31" height="15" rx="4" fill={`url(#${id}-badge)`} />
    <path d="M6 23h23" stroke="white" strokeOpacity=".23" strokeLinecap="round" />
    <text x="17.5" y="29.8" dominantBaseline="middle" textAnchor="middle" fill="white" fontFamily="Arial, Helvetica, sans-serif" fontSize={label.length > 3 ? 8 : 9} fontWeight="700" letterSpacing=".3">{label}</text>
  </svg>;
}
