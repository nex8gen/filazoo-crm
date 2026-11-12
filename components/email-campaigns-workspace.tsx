"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageActions } from "@/components/page-header";
import { DocumentPromotions } from "@/components/document-promotions";
import { useDocumentLibrary } from "@/components/use-document-library";
import type { PromotionTemplateSeed } from "@/lib/document-promotions";
import type { Product } from "@/lib/types";
import "./documents-workspace.css";
import "./email-campaigns-workspace.css";

const DocumentEditor = dynamic(() => import("@/components/document-editor").then(module => module.DocumentEditor));

function CampaignTemplateEditor({ template, onClose }: { template: PromotionTemplateSeed; onClose: () => void }) {
  const [revision, setRevision] = useState(0);
  const { metadata, error } = useDocumentLibrary("sort=newest&view=templates", 0, revision);

  async function saveTemplate(value: Record<string, unknown>) {
    const response = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, action: "create", id: crypto.randomUUID(), kind: "template" }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to save the email template.");
    toast.success("Email template saved to Files & templates");
  }

  if (metadata && !error) return <DocumentEditor editor={{ mode: "template", initial: template }} folders={metadata.folders} folderId={null} category="promotion" onClose={onClose} onSave={saveTemplate} />;

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Create email template</DialogTitle><DialogDescription>{error ? "The template library could not be loaded." : "Loading your template folders."}</DialogDescription></DialogHeader>{error ? <div role="alert" className="space-y-3"><p className="text-sm text-destructive">{error}</p><Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}><RefreshCw />Try again</Button></div> : <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading template library…</div>}</DialogContent></Dialog>;
}

export function EmailCampaignsWorkspace({ initialYear, canWrite, products = [] }: { initialYear: number; canWrite: boolean; products?: Product[] }) {
  const [year, setYear] = useState(initialYear);
  const [template, setTemplate] = useState<PromotionTemplateSeed | null>(null);

  return <div className="document-library campaign-workspace" aria-label="Marketing campaigns">
    <PageActions><Button variant="outline" size="sm" nativeButton={false} render={<Link href="/documents?category=promotion" />}><FileText className="size-4" />Email templates</Button></PageActions>
    <DocumentPromotions year={year} products={products} onYearChange={setYear} canWrite={canWrite} onCreateTemplate={setTemplate} />
    {template && canWrite ? <CampaignTemplateEditor template={template} onClose={() => setTemplate(null)} /> : null}
  </div>;
}
