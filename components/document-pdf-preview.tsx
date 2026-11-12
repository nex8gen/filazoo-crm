"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus, RefreshCw } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

export function DocumentPdfPreview({ url, name, onRefresh }: { url: string; name: string; onRefresh: () => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [loaded, setLoaded] = useState<{ url: string; pdf: PDFDocumentProxy } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(280);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [pageText, setPageText] = useState("");
  const [attempt, setAttempt] = useState(0);
  const pdf = loaded?.url === url ? loaded.pdf : null;

  useEffect(() => {
    const controller = new AbortController();
    let task: PDFDocumentLoadingTask | undefined;
    void (async () => {
      setLoading(true); setError("");
      try {
        // Fetch as data instead of navigating an iframe to a PDF. This bypasses
        // browser / embedded-WebView PDF handlers that launch Save As dialogs.
        const [pdfjs, response] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), fetch(url, { signal: controller.signal })]);
        if (!response.ok) throw new Error("Unable to load the PDF. Refresh its preview and try again.");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        pdfjs.GlobalWorkerOptions.workerSrc = `/api/documents/pdf-worker?v=${pdfjs.version}&build=legacy`;
        task = pdfjs.getDocument({ data: bytes, disableWorkerRendering: true,
          cMapUrl: "/api/documents/pdf-assets/cmaps/", cMapPacked: true,
          standardFontDataUrl: "/api/documents/pdf-assets/standard_fonts/", wasmUrl: "/api/documents/pdf-assets/wasm/",
        });
        const document = await task.promise;
        if (controller.signal.aborted) return;
        setLoaded({ url, pdf: document }); setPageNumber(1); setZoom(1);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error && cause.name === "PasswordException" ? "This PDF is password protected. Download it to open it with your password." : "This PDF could not be previewed. Try again or use Download file to open the original.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { controller.abort(); void task?.destroy(); };
  }, [url, attempt]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvasRef.current || loading) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    void (async () => {
      setRendering(true); setError("");
      try {
        const previous = renderTaskRef.current;
        previous?.cancel();
        await previous?.promise.catch(() => {});
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const base = page.getViewport({ scale: 1 });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const scale = Math.min(Math.max(80, width - 24) / base.width * zoom, Math.sqrt(4_000_000 / (base.width * base.height * pixelRatio ** 2)));
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas is unavailable.");
        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({ canvas, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        const text = await page.getTextContent();
        if (!cancelled) setPageText(text.items.map(item => "str" in item ? item.str : "").join(" "));
      } catch (cause) {
        if (!cancelled && !(cause instanceof Error && cause.name === "RenderingCancelledException")) setError("This page could not be rendered. Try another page or refresh the preview.");
      } finally { if (!cancelled) setRendering(false); }
    })();
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pdf, pageNumber, width, zoom, loading]);

  return <div className="library-pdf-preview" aria-label={`PDF preview of ${name}`} aria-busy={loading || rendering}>
    <div className="library-pdf-toolbar">
      <button type="button" aria-label="Previous PDF page" disabled={!pdf || loading || pageNumber <= 1} onClick={() => setPageNumber(page => page - 1)}><ChevronLeft /></button>
      <span aria-live="polite">{pdf ? `${pageNumber} / ${pdf.numPages}` : "PDF preview"}</span>
      <button type="button" aria-label="Next PDF page" disabled={!pdf || loading || pageNumber >= pdf.numPages} onClick={() => setPageNumber(page => page + 1)}><ChevronRight /></button>
      <span className="library-pdf-toolbar-divider" />
      <button type="button" aria-label="Zoom out PDF" disabled={!pdf || loading || zoom <= .5} onClick={() => setZoom(value => Math.max(.5, value - .25))}><Minus /></button>
      <button type="button" aria-label="Fit PDF to width" disabled={!pdf || loading} onClick={() => setZoom(1)} className="library-pdf-zoom">{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Zoom in PDF" disabled={!pdf || loading || zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .25))}><Plus /></button>
    </div>
    <div ref={viewportRef} className="library-pdf-viewport">
      {loading ? <div className="library-pdf-status" role="status"><Loader2 className="animate-spin" />Loading PDF…</div> : null}
      {error ? <div className="library-pdf-status" role="alert"><p>{error}</p><button type="button" onClick={() => { setAttempt(value => value + 1); onRefresh(); }}><RefreshCw />Retry preview</button></div> : null}
      <canvas ref={canvasRef} role="img" aria-label={`${name}, page ${pageNumber}${pdf ? ` of ${pdf.numPages}` : ""}`} hidden={loading || !!error} />
      {rendering && !loading && !error ? <span className="library-pdf-rendering" role="status"><Loader2 className="animate-spin" />Rendering page…</span> : null}
      <p className="sr-only">{pageText}</p>
    </div>
  </div>;
}
