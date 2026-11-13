"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import dynamic from "next/dynamic";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocumentPromotions } from "@/components/document-promotions";
import { useDocumentLibrary } from "@/components/use-document-library";
import type { PromotionTemplateSeed } from "@/lib/document-promotions";
import type { Product } from "@/lib/types";
import type { LibraryDocument } from "@/lib/documents";
import "./documents-workspace.css";
import "./email-campaigns-workspace.css";

const DocumentEditor = dynamic(() => import("@/components/document-editor").then(module => module.DocumentEditor));

function CampaignTemplateEditor({ template, products, onClose }: { template: PromotionTemplateSeed; products: Product[]; onClose: () => void }) {
  const [revision, setRevision] = useState(0);
  const { metadata, error } = useDocumentLibrary("sort=newest&view=templates", 0, revision);

  async function saveTemplate(value: Record<string, unknown>) {
    const response = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, action: value.action ?? "create", id: value.id ?? crypto.randomUUID(), kind: "template" }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to save the email template.");
    toast.success("Email template saved to Files & templates");
    return result.document as LibraryDocument;
  }

  if (metadata && !error) return <DocumentEditor editor={{ mode: "template", initial: template }} folders={metadata.folders} folderId={null} category="promotion" products={products} onClose={onClose} onSave={saveTemplate} />;

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Create email template</DialogTitle><DialogDescription>{error ? "The template library could not be loaded." : "Loading your template folders."}</DialogDescription></DialogHeader>{error ? <NotificationToast><p className="text-sm text-destructive">{error}</p><Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}><RefreshCw />Try again</Button></NotificationToast> : <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading template library…</div>}</DialogContent></Dialog>;
}

export function EmailCampaignsWorkspace({ initialYear, canWrite, sessionScope, products = [] }: { initialYear: number; canWrite: boolean; sessionScope: string; products?: Product[] }) {
  const [template, setTemplate] = useState<PromotionTemplateSeed | null>(null);

  return <div className="document-library campaign-workspace" aria-label="Marketing campaigns">
    <DocumentPromotions year={initialYear} sessionScope={sessionScope} products={products} canWrite={canWrite} onCreateTemplate={setTemplate} />
    {template && canWrite ? <CampaignTemplateEditor template={template} products={products} onClose={() => setTemplate(null)} /> : null}
  </div>;
}
