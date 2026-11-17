"use client";

import "./email-campaign-builder.css";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CampaignTemplateLibrary } from "@/components/campaign-template-library";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { applyFlowEmailTemplate, flowEmailContent } from "@/lib/flow-email-editor";
import type { EmailDesign } from "@/lib/email-design";
import type { JsonConfig } from "@/lib/flows";

export function FlowEmailTemplatePage({ config, mode, sessionKey, disabled, onApply, onClose }: { config: JsonConfig; mode: "library" | "text" | "html" | "current"; sessionKey: string; disabled: boolean; onApply: (config: JsonConfig) => void; onClose: () => void }) {
  const content = flowEmailContent(config);
  const [editor, setEditor] = useState({ mode, version: 0 });
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent showCloseButton={false} aria-describedby={undefined} className="wf-email-template-page !max-w-none">
    <header><Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft />Back to email details</Button><DialogTitle>Email templates</DialogTitle><span>Choose a template for this email</span></header>
    <CampaignTemplateLibrary key={`${editor.mode}-${editor.version}`} selectedId={typeof config.sourceTemplateId === "string" ? config.sourceTemplateId : null} canWrite={!disabled} body={content.body} subject={content.subject} name={String(config.emailName || "Workflow email")} design={config.emailDesign as EmailDesign | undefined} products={[]} sessionKey={sessionKey} recoverDesigner={false} initialEditor={editor.mode === "library" ? undefined : editor.mode} onWriteMessage={() => setEditor(current => ({ mode: "text", version: current.version + 1 }))}
      onSelect={template => onApply(applyFlowEmailTemplate(config, { id: template.id, name: template.name, subject: template.subject, body: template.body, design: template.email_design }))}
      onDesignApply={(design, template) => onApply(applyFlowEmailTemplate(config, { id: template?.id, name: template?.name || "Custom email", design }))}
    />
  </DialogContent></Dialog>;
}
