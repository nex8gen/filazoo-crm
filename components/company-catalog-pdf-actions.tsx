"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Eye, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { companyCatalogPdfFilename, companyCatalogPdfUrl } from "@/lib/company-catalog-pdf";
import type { Catalog } from "@/lib/types";

export function CompanyCatalogPdfActions({ catalog }: { catalog: Catalog }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function loadPdf(download: boolean) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError("");
    if (!download) setOpen(true);
    try {
      const response = await fetch(companyCatalogPdfUrl(catalog.id, download), { signal: current.signal });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "Unable to load the catalog PDF. Please retry.");
      }
      if (!response.headers.get("content-type")?.includes("application/pdf")) throw new Error("Please sign in again to access this catalog PDF.");
      const blob = await response.blob();
      if (current.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement("a");
        link.href = url;
        link.download = companyCatalogPdfFilename(catalog);
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else setPreviewUrl(url);
    } catch (failure) {
      if (current.signal.aborted) return;
      const message = failure instanceof Error ? failure.message : "Unable to load the catalog PDF.";
      setError(message);
      if (download) toast.error(message);
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }

  function closePreview(value: boolean) {
    setOpen(value);
    if (!value) {
      controller.current?.abort();
      setBusy(false);
      setPreviewUrl("");
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} aria-label={`Preview ${catalog.company} catalog v${catalog.version}`} onClick={() => void loadPdf(false)}><Eye />Preview</Button>
        <Button size="sm" variant="outline" disabled={busy} aria-label={`Download ${catalog.company} catalog v${catalog.version}`} onClick={() => void loadPdf(true)}>{busy ? <LoaderCircle className="animate-spin" /> : <Download />}Download</Button>
      </div>
      <Dialog open={open} onOpenChange={closePreview}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{catalog.company} — Catalog v{catalog.version}</DialogTitle>
            <DialogDescription>Preview the saved catalog PDF or download a copy.</DialogDescription>
          </DialogHeader>
          {busy ? <div role="status" className="flex h-64 items-center justify-center gap-2"><LoaderCircle className="size-5 animate-spin" />Preparing PDF…</div> : error ? <div role="alert" className="space-y-3 py-8"><p className="text-destructive">{error}</p><Button variant="outline" onClick={() => void loadPdf(false)}>Retry</Button></div> : previewUrl ? <iframe src={previewUrl} title={`${catalog.company} catalog PDF`} className="h-[65dvh] w-full rounded-md border" /> : null}
          <div className="flex justify-end"><Button disabled={busy || !previewUrl} onClick={() => void loadPdf(true)}><Download />Download PDF</Button></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
