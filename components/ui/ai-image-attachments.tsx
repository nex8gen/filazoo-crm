"use client";

import { useId, useRef, useState, type ClipboardEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { CHAT_IMAGE_ACCEPT, MAX_CHAT_IMAGES, chatImageLimitError, type ChatImage } from "@/lib/ai/image-input";
import { prepareChatImages } from "@/lib/ai/image-input-client";

export function useAiImageAttachments() {
  const [images, setImages] = useState<ChatImage[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);

  async function add(files: File[]) {
    if (!files.length || lock.current) return;
    lock.current = true;
    const run = generation.current;
    setProcessing(true);
    setError(null);
    try {
      if (images.length + files.length > MAX_CHAT_IMAGES) throw new Error(`Add up to ${MAX_CHAT_IMAGES} images at a time.`);
      const prepared = await prepareChatImages(files);
      if (run !== generation.current) return;
      const next = [...images, ...prepared];
      const limit = chatImageLimitError([{ role: "user", content: "", images: next }]);
      if (limit) throw new Error(limit);
      setImages(next);
    } catch (reason) {
      if (run === generation.current) setError(reason instanceof Error ? reason.message : "Unable to add this image.");
    } finally {
      lock.current = false;
      setProcessing(false);
    }
  }

  function clear() { generation.current++; setImages([]); setError(null); }
  function onPaste(event: ClipboardEvent<HTMLElement>) {
    const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (files.length) { event.preventDefault(); void add(files); }
  }
  return { images, setImages, processing, error, add, clear, onPaste, remove: (index: number) => { setImages((current) => current.filter((_, i) => i !== index)); setError(null); } };
}

export type AiImageAttachments = ReturnType<typeof useAiImageAttachments>;

export function AiImagePicker({ attachments, disabled = false }: { attachments: AiImageAttachments; disabled?: boolean }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return <>
    <input ref={input} id={id} type="file" accept={CHAT_IMAGE_ACCEPT} multiple disabled={disabled || attachments.processing} className="hidden" tabIndex={-1} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void attachments.add(files); }} />
    <button type="button" disabled={disabled || attachments.processing || attachments.images.length >= MAX_CHAT_IMAGES} onClick={() => input.current?.click()} aria-label="Attach images" title="Attach images (JPG, PNG or WebP, up to 10 MB each)" className="inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"><ImagePlus aria-hidden="true" className="size-3.5" /><span>{attachments.processing ? "Reading image…" : "Add image"}</span></button>
  </>;
}

export function AiImagePreviews({ images, onRemove, disabled = false }: { images?: ChatImage[]; onRemove?: (index: number) => void; disabled?: boolean }) {
  if (!images?.length) return null;
  return <div className="my-2 flex flex-wrap gap-2">{images.map((image, index) => <div key={`${index}-${image.name}`} className="relative w-20 overflow-hidden rounded-lg border bg-background">
    {/* Local data URLs are already sized for previews and never need image optimization. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={image.dataUrl} alt={image.name} className="h-16 w-full object-contain" />
    <p data-no-translate title={image.name} className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">{image.name}</p>
    {onRemove ? <button type="button" disabled={disabled} onClick={() => onRemove(index)} aria-label={`Remove ${image.name}`} className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full border bg-background/95 disabled:opacity-50"><X aria-hidden="true" className="size-3" /></button> : null}
  </div>)}</div>;
}

export function AiImageFeedback({ attachments }: { attachments: AiImageAttachments }) {
  return <>{attachments.processing ? <p role="status" className="my-1 text-xs text-muted-foreground">Preparing image…</p> : null}{attachments.error ? <p role="alert" className="my-1 text-xs text-destructive">{attachments.error}</p> : null}</>;
}
