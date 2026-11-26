"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PortalEditorSelect } from "@/components/portal-editor-select";
import { PortalWebsite } from "@/components/portal-website";
import { portalPreviewData } from "@/lib/portal-preview";
import { portalPages } from "@/lib/portal-themes";
import { portalWebsiteDesign } from "@/lib/portal-website-design";
import type { PortalDesign } from "@/lib/portal-design";

const PortalExperience = dynamic(() => import("@/components/portal-experience").then(module => module.PortalExperience), {
  loading: () => <div role="status" className="min-h-80 p-6 text-sm text-muted-foreground">Loading customer account…</div>,
});

/** Uses the actual website/account renderers; preview mode never creates a customer session. */
export function PortalThemePreview({ name, design, onClose, children }: { name: string; design: PortalDesign; onClose: () => void; children?: ReactNode }) {
  const [page, setPage] = useState("website/home");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const website = portalWebsiteDesign(design);
  const options = [
    ...website.pages.filter(item => item.enabled).map(item => ({ value: `website/${item.id === "home" ? "home" : `pages/${item.id}`}`, label: item.title, group: "Website" })),
    ...portalPages(design).map(item => ({ value: item.id, label: item.label, group: "Customer account" })),
  ];
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="ptl-preview-dialog">
      <DialogHeader className="ptl-preview-heading"><DialogTitle><span data-no-translate>{name}</span></DialogTitle><DialogDescription>Preview your website and customer account. Account pages show sample data.</DialogDescription></DialogHeader>
      <div className="ptl-preview-toolbar">
        <div className="ptl-preview-pages"><PortalEditorSelect label="Preview page" value={page} options={options} onChange={setPage} /></div>
        <div className="ptl-device-toggle" role="group" aria-label="Preview size">
          <Button variant={device === "desktop" ? "secondary" : "ghost"} size="icon-sm" aria-label="Desktop preview" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor /></Button>
          <Button variant={device === "mobile" ? "secondary" : "ghost"} size="icon-sm" aria-label="Mobile preview" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}><Smartphone /></Button>
        </div>
      </div>
      <div className="ptl-preview-stage"><div className="ptl-preview-frame" data-device={device}>
        {page.startsWith("website/")
          ? <PortalWebsite design={design} preview page={page.slice(8)} onPageChange={next => setPage(next === "account" ? "home" : `website/${next}`)} />
          : <PortalExperience data={portalPreviewData(design)} preview page={page} onPageChange={setPage} onWebsiteHome={() => setPage("website/home")} />}
      </div></div>
      <div className="ptl-preview-footer"><span>Changes are only visible to customers after publishing.</span><div>{children}<Button variant="outline" size="sm" onClick={onClose}>Close preview</Button></div></div>
    </DialogContent>
  </Dialog>;
}
