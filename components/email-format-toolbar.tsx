"use client";

import { Bold, Italic, Underline, List, Link as LinkIcon } from "lucide-react";
import type { RefObject } from "react";
import type { EmailBodyEditorHandle } from "./email-body-editor";

export function EmailFormatToolbar({ editor, disabled = false }: { editor: RefObject<EmailBodyEditorHandle | null>; disabled?: boolean }) {
  return <div className="flex items-center gap-1" aria-label="Message formatting">
    {([["bold", Bold], ["italic", Italic], ["underline", Underline], ["insertUnorderedList", List]] as const).map(([command, Icon]) => <button key={command} type="button" disabled={disabled} title={command === "insertUnorderedList" ? "Bullet list" : command} aria-label={command === "insertUnorderedList" ? "Bullet list" : command} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.current?.format(command)} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"><Icon className="size-4" /></button>)}
    <button type="button" disabled={disabled} title="Insert link" aria-label="Insert link" onMouseDown={(event) => event.preventDefault()} onClick={() => { const url = window.prompt("Link URL (https://…)"); if (url && /^(https?:\/\/|mailto:)/i.test(url)) editor.current?.insertLink(url, editor.current.selectedText() || url); }} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"><LinkIcon className="size-4" /></button>
  </div>;
}
