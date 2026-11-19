"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Check, ImageIcon, LayoutGrid, List, LoaderCircle, Search, Upload, Video } from "lucide-react";
import type { DataMode } from "@/lib/types";
import { libraryMediaUploadError, mediaSizeLabel, PRODUCT_LIBRARY_MEDIA_TYPES, type ProductLibraryMedia, type ProductMediaPage } from "@/lib/product-media";
import { uploadCompanyMedia } from "@/lib/product-media-upload";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import "./product-media-picker.css";

function MediaPreview({ item }: { item: ProductLibraryMedia }) {
  const [failed, setFailed] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const video = item.mimeType.startsWith("video/");
  return <span className="company-media-thumbnail">
    {failed ? video ? <Video /> : <ImageIcon /> : video ? <video src={item.url} muted playsInline preload="metadata" aria-hidden="true" onError={() => setFailed(true)} onLoadedMetadata={event => { const seconds = event.currentTarget.duration; if (Number.isFinite(seconds)) setDuration(seconds); }} /> : <Image src={item.url} alt="" width={160} height={160} unoptimized onError={() => setFailed(true)} />}
    {video ? <span className="company-media-video-label"><Video />{duration === null ? "Video" : `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`}</span> : null}
  </span>;
}

export function ProductMediaPicker({ open, onOpenChange, existing, limit, onAdd, disabled, mode, onBusyChange }: {
  open: boolean; onOpenChange: (open: boolean) => void; existing: string[]; limit: number;
  onAdd: (urls: string[]) => void; disabled: boolean; mode: DataMode; onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [size, setSize] = useState("all");
  const [sort, setSort] = useState("newest");
  const [layout, setLayout] = useState("grid");
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<ProductMediaPage & { key: string }>({ items: [], total: 0, key: "" });
  const [uploaded, setUploaded] = useState<ProductLibraryMedia[]>([]);
  const [selected, setSelected] = useState<Map<string, ProductLibraryMedia>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const key = JSON.stringify([query.trim(), type, size, sort]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      if (mode === "demo") { setPage({ key, items: [], total: 0 }); setLoading(false); return; }
      const params = new URLSearchParams({ q: query.trim(), type, size, sort, offset: String(offset) });
      void fetch(`/api/product-media?${params}`, { signal: controller.signal }).then(async response => {
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(result.error || "Could not load company media.");
        if (!controller.signal.aborted) setPage(current => ({ ...result, key, items: offset > 0 && current.key === key ? [...current.items, ...result.items.filter((item: ProductLibraryMedia) => !current.items.some(previous => previous.id === item.id))] : result.items }));
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load company media."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query.trim() ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, key, query, type, size, sort, offset, attempt, mode]);
  const items = page.key === key ? page.items : [];
  const extra = uploaded.filter(item => !items.some(other => other.url === item.url)
    && (!query.trim() || item.name.toLowerCase().includes(query.trim().toLowerCase()))
    && (type === "all" || item.mimeType.startsWith(`${type}/`))
    && (size === "all" || (size === "small" ? item.size < 1048576 : size === "medium" ? item.size >= 1048576 && item.size <= 10485760 : item.size > 10485760)));
  const visible = [...extra, ...items];
  const unavailable = disabled || busy;
  const canUpload = mode === "demo" || page.canUpload !== false;

  function changeFilter(change: () => void) { change(); setOffset(0); }
  function toggle(item: ProductLibraryMedia) {
    if (unavailable || existing.includes(item.url)) return;
    setSelected(current => {
      const next = new Map(current);
      if (next.has(item.url)) next.delete(item.url);
      else if (next.size < limit) next.set(item.url, item);
      return next;
    });
  }
  async function upload(files: File[]) {
    if (!files.length || unavailable || !canUpload || uploading.current) return;
    setUploadError("");
    if (files.length > 20) { setUploadError("Upload up to 20 files at a time."); return; }
    const invalid = files.map(file => libraryMediaUploadError(file.type, file.size)).find(Boolean);
    if (invalid) { setUploadError(invalid); return; }
    uploading.current = true; setBusy(true); onBusyChange(true);
    try {
      for (const file of files) {
        const item = await uploadCompanyMedia(file, mode);
        setUploaded(current => [item, ...current]);
        setSelected(current => current.size < limit && !existing.includes(item.url) ? new Map(current).set(item.url, item) : current);
      }
    } catch (cause) { setUploadError(cause instanceof Error ? cause.message : "Could not upload this media file."); }
    finally { uploading.current = false; setBusy(false); onBusyChange(false); }
  }
  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="company-media-picker" showCloseButton={!busy} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); void upload(Array.from(event.dataTransfer.files)); }}>
      <DialogHeader className="company-media-header"><DialogTitle>Select media</DialogTitle><DialogDescription>Choose images and videos from company storage, or upload new files.</DialogDescription></DialogHeader>
      <div className="company-media-toolbar">
        <InputGroup className="company-media-search"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput type="search" aria-label="Search company media" placeholder="Search files" value={query} onChange={event => changeFilter(() => setQuery(event.target.value))} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} /></InputGroup>
        <Select value={sort} onValueChange={value => changeFilter(() => setSort(value ?? "newest"))}><SelectTrigger aria-label="Sort company media" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newest">Newest first</SelectItem><SelectItem value="oldest">Oldest first</SelectItem><SelectItem value="name">Name A–Z</SelectItem></SelectContent></Select>
        <div className="company-media-view"><Button type="button" variant={layout === "grid" ? "secondary" : "ghost"} size="icon-sm" aria-label="Media grid view" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><LayoutGrid /></Button><Button type="button" variant={layout === "list" ? "secondary" : "ghost"} size="icon-sm" aria-label="Media list view" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><List /></Button></div>
        <div className="company-media-filters"><Select value={type} onValueChange={value => changeFilter(() => setType(value ?? "all"))}><SelectTrigger aria-label="Company media type" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Images & videos</SelectItem><SelectItem value="image">Images</SelectItem><SelectItem value="video">Videos</SelectItem></SelectContent></Select><Select value={size} onValueChange={value => changeFilter(() => setSize(value ?? "all"))}><SelectTrigger aria-label="Company media file size" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any file size</SelectItem><SelectItem value="small">Under 1 MB</SelectItem><SelectItem value="medium">1–10 MB</SelectItem><SelectItem value="large">Over 10 MB</SelectItem></SelectContent></Select></div>
      </div>
      <div className="company-media-scroll" aria-busy={loading || busy}>
        {canUpload ? <div className="company-media-upload"><Button type="button" variant="outline" size="sm" disabled={unavailable} onClick={() => input.current?.click()}>{busy ? <LoaderCircle className="animate-spin" /> : <Upload />}{busy ? "Uploading…" : "Upload media"}</Button><p>Drag images and videos here · Up to 50 MB per file</p><Input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="Upload company media" accept={Object.keys(PRODUCT_LIBRARY_MEDIA_TYPES).join(",")} multiple disabled={unavailable} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void upload(files); }} /></div> : null}
        {uploadError ? <p role="alert" className="company-media-error">{uploadError}</p> : null}
        {error ? <div className="company-media-state" role="alert"><p>{error}</p><Button type="button" variant="outline" size="sm" onClick={() => setAttempt(current => current + 1)}>Try again</Button></div> : null}
        {!visible.length && (loading || page.key !== key) && !error ? <div className="company-media-state" role="status"><LoaderCircle className="animate-spin" />Loading company media…</div> : !visible.length && !error ? <div className="company-media-state"><ImageIcon /><p>{query.trim() || type !== "all" || size !== "all" ? "No matching media. Try another search or filter." : "No images or videos in company storage yet."}</p></div> : null}
        <div className={`company-media-grid${layout === "list" ? " company-media-list" : ""}`}>
          {visible.map(item => {
            const added = existing.includes(item.url), checked = selected.has(item.url), locked = unavailable || added || (!checked && selected.size >= limit);
            return <label key={item.id} className="company-media-tile" data-selected={checked || added || undefined} data-disabled={locked || undefined}>
              <Checkbox className="company-media-check" aria-label={`Select ${item.name}`} checked={checked || added} disabled={locked} onCheckedChange={() => toggle(item)} />
              <MediaPreview item={item} /><span className="company-media-file-info"><span className="company-media-file-name" title={item.name}>{item.name}</span><small>{item.mimeType.split("/")[1].replace("svg+xml", "svg").replace("quicktime", "mov").toUpperCase()} · {mediaSizeLabel(item.size)}{added ? " · Added" : ""}</small></span>{checked ? <Check className="company-media-selected-icon" /> : null}
            </label>;
          })}
        </div>
        {page.key === key && page.items.length < page.total ? <div className="company-media-load"><Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => setOffset(page.items.length)}>{loading ? <LoaderCircle className="animate-spin" /> : null}Load more</Button></div> : null}
      </div>
      <footer className="company-media-footer"><span role="status">{selected.size} selected{limit > 0 ? ` · ${limit} available ${limit === 1 ? "space" : "spaces"}` : ""}</span><div><Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" disabled={unavailable || !selected.size} onClick={() => { onAdd([...selected.keys()]); onOpenChange(false); }}>Done</Button></div></footer>
    </DialogContent>
  </Dialog>;
}
