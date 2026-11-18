"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Copy, Eye, Globe, LoaderCircle, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationToast } from "@/components/ui/notification-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PortalThemeArtwork } from "@/components/portal-theme-artwork";
import { PortalLocalTime } from "@/components/portal-local-time";
import { defaultPortalDesign, type PortalDesign, type PortalDesignView } from "@/lib/portal-design";
import { createPortalTemplate, livePortalThemeId, portalLibraryThemes, portalTemplates } from "@/lib/portal-themes";
import { portalPreviewData } from "@/lib/portal-preview";
import { createPortalTheme, publishPortalTheme } from "@/app/customer-portal/actions";
import "@/app/invoices/invoices.css";
import "@/app/customer/customer.css";
import "./portal-theme-library.css";

const PortalExperience = dynamic(() => import("@/components/portal-experience").then(module => module.PortalExperience), {
  loading: () => <div role="status" className="min-h-80 p-6 text-sm text-muted-foreground">Loading…</div>,
});

export function PortalThemeLibrary({ initial, canWrite, workspaceName }: { initial: PortalDesignView; canWrite: boolean; workspaceName: string }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState("");
  const locked = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<{ name: string; design: PortalDesign } | null>(null);
  const [previewPage, setPreviewPage] = useState("home");
  const themes = portalLibraryThemes(view);
  const liveId = livePortalThemeId(view);
  const liveTheme = themes.find(theme => theme.id === liveId);
  const liveDesign = view.published ?? defaultPortalDesign();
  const editHref = (id: string) => `/customer-portal/themes/${encodeURIComponent(id)}`;
  function showPreview(name: string, design: PortalDesign) { setPreviewPage("home"); setPreview({ name, design }); }
  async function add(input: { templateId?: string; sourceId?: string }, label: string) {
    if (!canWrite || locked.current) return;
    locked.current = true; setBusy(input.templateId || input.sourceId || "new"); setError(""); setNotice("");
    try {
      const result = await createPortalTheme({ ...input, revision: view.revision });
      if ("error" in result) setError(result.error);
      else { setView(result.saved); setNotice(`${label} added to your theme library. `); }
    } catch { setError("Unable to add your theme. Please try again."); }
    finally { locked.current = false; setBusy(""); }
  }
  async function publish(themeId: string) {
    if (!canWrite || locked.current) return;
    locked.current = true; setBusy(`publish:${themeId}`); setError(""); setNotice("");
    try {
      const result = await publishPortalTheme({ themeId, revision: view.revision });
      if (result.error) setError(result.error);
      else if (result.saved) { setView(result.saved); setNotice("Theme published."); }
    } catch { setError("Unable to publish this theme. Please try again."); }
    finally { locked.current = false; setBusy(""); }
  }
  return <div className="portal-theme-library">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-4"><div className="flex items-center gap-3"><Globe className="size-4 text-muted-foreground" /><div><p className="text-sm font-medium">Custom domain</p><p className="text-xs text-muted-foreground">Use your own address for your customer portal.</p></div></div><Link href="/customer-portal/domains" className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted">Manage domain</Link></div>
    {!canWrite && <p className="text-sm text-muted-foreground">Read-only access</p>}
    {error && <NotificationToast>{error}</NotificationToast>}{notice && <NotificationToast tone="success">{notice}</NotificationToast>}
    <Card size="sm" className="ptl-live-card gap-0 py-0" aria-label="Live theme"><CardHeader className="ptl-live-heading"><CardTitle>Live theme</CardTitle><Badge variant="secondary">Live</Badge></CardHeader><div className="ptl-live-art"><PortalThemeArtwork design={liveDesign} /></div><CardFooter className="ptl-live-footer"><div><h2>{liveTheme?.name ?? "Default theme"}</h2>{view.publishedAt && <p>Published <PortalLocalTime value={view.publishedAt} /></p>}</div><div><Button variant="outline" size="sm" onClick={() => showPreview("Live theme", liveDesign)}><Eye />Preview</Button><Button size="sm" nativeButton={false} render={<Link href={editHref(liveId ?? themes[0].id)} />}>{canWrite ? "Edit theme" : "View theme"}</Button></div></CardFooter></Card>
    <section className="ptl-library" aria-label="Theme library"><div className="ptl-section-title"><h2>Theme library <Badge variant="secondary">{themes.length}</Badge></h2><Button variant="outline" size="sm" nativeButton={false} render={<a href="#portal-templates" />}><Plus />Add theme</Button></div><Card size="sm" className="ptl-drafts gap-0 py-0">{themes.map(theme => {
      const isLive = theme.id === liveId;
      const changed = !isLive || JSON.stringify(theme.design) !== JSON.stringify(view.published);
      return <div key={theme.id} className="ptl-draft-row"><button type="button" className="ptl-draft-thumb" aria-label={`Preview ${theme.name}`} onClick={() => showPreview(theme.name, theme.design)}><PortalThemeArtwork design={theme.design} /></button><div className="ptl-draft-info"><h3>{theme.name}<Badge variant="secondary">{isLive ? changed ? "Live · Draft changes" : "Live" : "Draft"}</Badge></h3>{theme.updatedAt && <p>Saved <PortalLocalTime value={theme.updatedAt} /></p>}</div><div className="ptl-draft-actions"><Button variant="ghost" size="icon-sm" disabled={!canWrite || Boolean(busy) || themes.length >= 20} aria-label={`Duplicate ${theme.name}`} onClick={() => void add({ sourceId: theme.id }, `${theme.name} copy`)}>{busy === theme.id ? <LoaderCircle className="animate-spin" /> : <Copy />}</Button><Button variant="outline" size="sm" disabled={!canWrite || Boolean(busy) || !changed} onClick={() => void publish(theme.id)}>{busy === `publish:${theme.id}` ? <LoaderCircle className="animate-spin" /> : <Globe />}Publish</Button><Button variant="outline" size="sm" nativeButton={false} render={<Link href={editHref(theme.id)} />}>Edit theme</Button></div></div>;
    })}</Card></section>
    <section id="portal-templates" className="ptl-templates" aria-label="Theme templates"><div className="ptl-section-title"><h2>Templates</h2></div><div className="ptl-template-grid">{portalTemplates.map(template => {
      const design = createPortalTemplate(template.id, workspaceName);
      return <Card key={template.id} size="sm" className="ptl-template-card gap-0 py-0"><button type="button" className="ptl-template-preview" aria-label={`Preview ${template.name} template`} onClick={() => showPreview(template.name, design)}><PortalThemeArtwork design={design} /></button><CardFooter className="ptl-template-info"><h3>{template.name}</h3><Button size="sm" variant="outline" disabled={!canWrite || Boolean(busy) || themes.length >= 20} onClick={() => void add({ templateId: template.id }, template.name)}>{busy === template.id ? <LoaderCircle className="animate-spin" /> : <Plus />}Add</Button></CardFooter></Card>;
    })}</div></section>
    <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(null); }}><DialogContent className="ptl-preview-dialog"><DialogHeader><DialogTitle>{preview?.name}</DialogTitle><DialogDescription className="sr-only">Theme preview with sample customer data.</DialogDescription></DialogHeader>{preview && <div className="ptl-preview-frame"><PortalExperience data={portalPreviewData(preview.design)} preview page={previewPage} onPageChange={setPreviewPage} /></div>}</DialogContent></Dialog>
  </div>;
}
