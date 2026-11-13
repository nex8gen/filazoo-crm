"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocumentDetailsEditor, type DocumentEditorProps } from "@/components/document-editor";
import { emailDesignText, newEmailDesign, type EmailDesign } from "@/lib/email-design";
import type { LibraryDocument } from "@/lib/documents";

const EmailDesignEditor = dynamic(() => import("@/components/email-design-editor").then(module => module.EmailDesignEditor));

export function DocumentTemplateEditor(props: DocumentEditorProps) {
  const source = props.editor.document;
  const [loaded, setLoaded] = useState<LibraryDocument | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/documents/${source.id}?details=1`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to open the template.");
        if (!controller.signal.aborted) { setLoaded(result.document); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to open the template."); }
    })();
    return () => controller.abort();
  }, [source, attempt]);

  if (source && !loaded) return <Dialog open onOpenChange={open => { if (!open) props.onClose(); }}><DialogContent><DialogHeader><DialogTitle>Open email template</DialogTitle><DialogDescription>Loading the saved email design and template settings.</DialogDescription></DialogHeader>{error ? <NotificationToast><p>{error}</p><Button variant="outline" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Try again</Button></NotificationToast> : <div role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Loading email editor…</div>}</DialogContent></Dialog>;
  return <TemplateDesigner {...props} document={loaded ?? props.editor.initial} />;
}

function TemplateDesigner({ document, ...props }: DocumentEditorProps & { document?: Partial<LibraryDocument> }) {
  const [settings, setSettings] = useState<Partial<LibraryDocument>>(() => ({ ...document, folder_id: document?.folder_id ?? props.folderId, category: "everyday" }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsChanged, setSettingsChanged] = useState(false);
  const [initial] = useState(() => document?.email_design ?? (document?.body ? newEmailDesign(document.body, "text") : newEmailDesign()));

  async function save(design: EmailDesign, name: string, existing?: LibraryDocument | null) {
    const saved = await props.onSave({ ...settings, action: existing ? "update" : "create", id: existing?.id ?? crypto.randomUUID(), updated_at: existing?.updated_at, name, body: emailDesignText(design), email_design: design });
    if (!saved) throw new Error("The template could not be saved. Try again.");
    setSettings(saved);
    setSettingsChanged(false);
    return saved;
  }

  return <>
    <EmailDesignEditor initial={initial} name={document?.name ?? "New email template"} subject={settings.subject ?? ""} template={props.editor.document ? document as LibraryDocument : null} products={props.products} saveOnDone detailsChanged={settingsChanged} onEditDetails={() => setSettingsOpen(true)} onSave={save} onApply={() => {}} onClose={props.onClose} />
    {settingsOpen ? <DocumentDetailsEditor editor={{ mode: "template", initial: settings }} folders={props.folders} folderId={props.folderId} onClose={() => setSettingsOpen(false)} onSave={async value => { setSettings(current => ({ ...current, ...value })); setSettingsChanged(true); }} /> : null}
  </>;
}
