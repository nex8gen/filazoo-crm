"use client";

import Image from "next/image";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Plus, Star, X, LoaderCircle } from "lucide-react";
import { uploadCompanyMedia } from "@/lib/product-media-upload";
import { isProductVideo, libraryMediaUploadError, PRODUCT_LIBRARY_MEDIA_TYPES } from "@/lib/product-media";
import { MAX_PRODUCT_MEDIA } from "@/lib/product-images";
import { ProductMediaPicker } from "@/components/product-media-picker";
import type { DataMode } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const compactQuery = "(max-width: 640px)";
function subscribeCompact(onChange: () => void) {
  const query = window.matchMedia(compactQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const compactSnapshot = () => window.matchMedia(compactQuery).matches;
const serverCompactSnapshot = () => true;

export function ProductMediaGallery({ value, onChange, disabled, mode, onBusyChange }: {
  value: string[];
  onChange: (urls: string[]) => void;
  disabled: boolean;
  mode: DataMode;
  onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const gridId = useId();
  const compact = useSyncExternalStore(subscribeCompact, compactSnapshot, serverCompactSnapshot);
  // The cover occupies four cells; reserve the final cell for adding or viewing more.
  const visibleLimit = compact ? 4 : 8;
  const visibleImages = showAll ? value : value.slice(0, visibleLimit);
  const coverIndex = value.findIndex(url => !isProductVideo(url));
  const remaining = Math.max(0, value.length - visibleLimit);
  const collapsed = remaining > 0 && !showAll;
  const canAdd = !disabled && value.length < MAX_PRODUCT_MEDIA;

  async function add(files: File[]) {
    if (!files.length || disabled || uploading.current) return;
    setError("");
    if (value.length + files.length > MAX_PRODUCT_MEDIA) { setError(`Add up to ${MAX_PRODUCT_MEDIA} media files per product.`); return; }
    const invalid = files.map(file => libraryMediaUploadError(file.type, file.size)).find(Boolean);
    if (invalid) { setError(invalid); return; }
    uploading.current = true;
    setBusy(true);
    onBusyChange(true);
    let next = [...value];
    try {
      for (const file of files) {
        const { url } = await uploadCompanyMedia(file, mode);
        next = [...new Set([...next, url])];
        onChange(next);
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Could not upload this image."); }
    finally { uploading.current = false; setBusy(false); onBusyChange(false); }
  }

  function renderImage(url: string, index: number) {
    const video = isProductVideo(url);
    return <div key={url} className={`product-media-item${index === 0 ? " product-media-cover" : ""}`}>
        {video ? <video src={url} aria-label={`Product video ${index + 1}`} controls playsInline preload="metadata" /> : <Image src={url} alt={index === 0 ? "Product cover image" : `Product image ${index + 1}`} width={index === 0 ? 400 : 200} height={index === 0 ? 400 : 200} unoptimized />}
        {index === coverIndex ? <span className="product-media-cover-label">Cover</span> : null}
        {!disabled ? <div className="product-media-controls">
          {index > 0 && !video ? <Button type="button" variant="outline" size="icon-xs" disabled={busy} aria-label={`Use image ${index + 1} as cover`} title="Set as cover" onClick={() => onChange([url, ...value.filter(item => item !== url)])}><Star /></Button> : null}
          <Button type="button" variant="outline" size="icon-xs" disabled={busy} aria-label={`Remove product ${video ? "video" : "image"} ${index + 1}`} title="Remove media" onClick={() => onChange(value.filter(item => item !== url))}><X /></Button>
        </div> : null}
      </div>;
  }

  function renderAdd() {
    return canAdd ? <Button type="button" variant="outline" className={`product-media-add${!value.length ? " product-media-add-empty" : ""}`} disabled={busy} aria-label="Add product media" onClick={() => setPickerOpen(true)}>{busy ? <LoaderCircle className="animate-spin" /> : <Plus />}<span>{busy ? "Uploading…" : "Add media"}</span></Button> : null;
  }

  return <div className="product-media" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void add(Array.from(event.dataTransfer.files)); }}>
    <div id={gridId} className="product-media-grid">
      {visibleImages.map(renderImage)}
      {collapsed ? <Button type="button" variant="outline" className="product-media-item product-media-more" aria-label={`Show ${remaining} more product ${remaining === 1 ? "image" : "images"}`} aria-expanded={false} aria-controls={gridId} onClick={() => setShowAll(true)}>
        {isProductVideo(value[visibleLimit]) ? <video src={value[visibleLimit]} muted playsInline preload="metadata" aria-hidden="true" /> : <Image src={value[visibleLimit]} alt="" width={200} height={200} unoptimized />}
        <span>+{remaining} more</span>
      </Button> : renderAdd()}
      {disabled && !value.length ? <p className="text-sm text-muted-foreground">No media added.</p> : null}
    </div>
    <Input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="Upload product images" accept={Object.keys(PRODUCT_LIBRARY_MEDIA_TYPES).join(",")} multiple disabled={disabled || busy} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void add(files); }} />
    {!collapsed ? <div className="product-media-footer">
      <p className="product-media-help" role="status">{busy ? "Uploading media…" : disabled ? `${value.length} media files` : "Choose from company storage or upload images and videos, up to 50 MB each."}</p>
      {showAll && remaining > 0 ? <Button type="button" variant="ghost" size="sm" aria-label="Show less product media" aria-expanded={true} aria-controls={gridId} onClick={() => setShowAll(false)}>Show less</Button> : null}
    </div> : null}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    {pickerOpen ? <ProductMediaPicker open onOpenChange={setPickerOpen} existing={value} limit={MAX_PRODUCT_MEDIA - value.length} onAdd={urls => onChange([...new Set([...value, ...urls])].slice(0, MAX_PRODUCT_MEDIA))} disabled={disabled || busy} mode={mode} onBusyChange={onBusyChange} /> : null}
  </div>;
}
