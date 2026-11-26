"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useId, useRef, useState, type ClipboardEvent } from "react";
import dynamic from "next/dynamic";
import { FileText, FolderOpen, Paperclip, X } from "lucide-react";
import { MAX_CHAT_ATTACHMENTS, chatImageLimitError, type ChatImage, type ChatFile } from "@/lib/ai/image-input";
import { prepareChatAttachments } from "@/lib/ai/image-input-client";
import { readChatLibraryFiles, type ChatLibraryFile } from "@/lib/ai/file-input-library-client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const AiLibraryPicker = dynamic(() => import("@/components/ui/ai-library-picker"));

export function useAiImageAttachments() {
  const [images, setImages] = useState<ChatImage[]>([]);
  const [files, setFiles] = useState<ChatFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);

  async function add(selected: File[]) {
    return prepare(selected.length, async () => selected);
  }

  async function addLibrary(selected: ChatLibraryFile[]) {
    return prepare(selected.length, () => readChatLibraryFiles(selected));
  }

  async function prepare(count: number, load: () => Promise<File[]>) {
    if (!count || lock.current) return false;
    lock.current = true;
    const run = generation.current;
    setProcessing(true);
    setError(null);
    try {
      if (images.length + files.length + count > MAX_CHAT_ATTACHMENTS) throw new Error(`Add up to ${MAX_CHAT_ATTACHMENTS} files at a time, including images.`);
      const selected = await load();
      if (run !== generation.current) return false;
      const prepared = await prepareChatAttachments(selected);
      if (run !== generation.current) return false;
      const next = [...images, ...prepared.images];
      const nextFiles = [...files, ...prepared.files];
      const limit = chatImageLimitError([{ role: "user", content: "", images: next, files: nextFiles }]);
      if (limit) throw new Error(limit);
      setImages(next);
      setFiles(nextFiles);
      return true;
    } catch (reason) {
      if (run === generation.current) setError(reason instanceof Error ? reason.message : "Unable to add this file.");
      return false;
    } finally {
      lock.current = false;
      setProcessing(false);
    }
  }

  function clear() { generation.current++; setImages([]); setFiles([]); setError(null); }
  function onPaste(event: ClipboardEvent<HTMLElement>) {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length) { event.preventDefault(); void add(pasted); }
  }
  return { images, files, setImages, setFiles, processing, error, add, addLibrary, clear, onPaste, remove: (index: number) => {
    if (index < images.length) setImages((current) => current.filter((_, i) => i !== index));
    else setFiles((current) => current.filter((_, i) => i !== index - images.length));
    setError(null);
  } };
}

export type AiImageAttachments = ReturnType<typeof useAiImageAttachments>;

export function AiImagePicker({ attachments, disabled = false }: { attachments: AiImageAttachments; disabled?: boolean }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const remaining = MAX_CHAT_ATTACHMENTS - attachments.images.length - attachments.files.length;
  return <>
    <input ref={input} id={id} type="file" multiple disabled={disabled || attachments.processing} className="hidden" tabIndex={-1} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void attachments.add(files); }} />
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled || attachments.processing || remaining <= 0} aria-label="Attach files and images" title="Add files" className="ai-composer-action inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"><Paperclip aria-hidden="true" className="size-3.5 shrink-0" /><span className="ai-composer-action-label">{attachments.processing ? "Reading files…" : "Add files"}</span></DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={10} positionerClassName="z-[70]" className="w-[min(25rem,calc(100vw-2rem))] rounded-2xl p-2 shadow-lg">
        <DropdownMenuItem onClick={() => input.current?.click()} className="min-h-10 gap-3"><Paperclip className="text-muted-foreground" /><span>Add photos &amp; files</span><span className="truncate text-xs text-muted-foreground">Upload from computer</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => setLibraryOpen(true)} className="min-h-10 gap-3"><FolderOpen className="text-muted-foreground" /><span>Add from library</span><span className="truncate text-xs text-muted-foreground">Browse and search your files</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {libraryOpen ? <AiLibraryPicker remaining={remaining} onClose={() => setLibraryOpen(false)} onAdd={attachments.addLibrary} /> : null}
  </>;
}

export function AiImagePreviews({ images, files, onRemove, disabled = false }: { images?: ChatImage[]; files?: ChatFile[]; onRemove?: (index: number) => void; disabled?: boolean }) {
  if (!images?.length && !files?.length) return null;
  return <div className="my-2 flex flex-wrap gap-2">{images?.map((image, index) => <div key={`${index}-${image.name}`} className="relative w-20 overflow-hidden rounded-lg border bg-background">
    {/* Local data URLs are already sized for previews and never need image optimization. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={image.dataUrl} alt={image.name} className="h-16 w-full object-contain" />
    <p data-no-translate title={image.name} className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">{image.name}</p>
    {onRemove ? <button type="button" disabled={disabled} onClick={() => onRemove(index)} aria-label={`Remove ${image.name}`} className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full border bg-background/95 disabled:opacity-50"><X aria-hidden="true" className="size-3" /></button> : null}
  </div>)}{files?.map((file, index) => <div key={`file-${index}-${file.name}`} className="relative flex w-36 items-center gap-2 rounded-lg border bg-background px-2 py-3 pr-6">
    <FileText aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
    <span data-no-translate title={file.name} className="min-w-0 truncate text-xs">{file.name}</span>
    {onRemove ? <button type="button" disabled={disabled} onClick={() => onRemove((images?.length ?? 0) + index)} aria-label={`Remove ${file.name}`} className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full border bg-background/95 disabled:opacity-50"><X aria-hidden="true" className="size-3" /></button> : null}
  </div>)}</div>;
}

export function AiImageFeedback({ attachments }: { attachments: AiImageAttachments }) {
  return attachments.error ? <NotificationToast>{attachments.error}</NotificationToast> : null;
}
