"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Clipboard, ExternalLink, History, Mail, MoreHorizontal, PanelsTopLeft, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { assignPipelineOwner, scheduleCompanyFollowup } from "@/app/crm-actions";
import { followupInstant, followupLocalTime } from "@/lib/company-followup";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BdSalesManager } from "@/lib/data/members";

type CompanyActionsMenuProps = {
  companyId: string;
  ownerId: string | null;
  managers: BdSalesManager[];
  canAssign: boolean;
  canWrite: boolean;
  email: string;
  website: string;
  nextFollowupAt: string | null;
};

function normalizedWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function CompanyActionsMenu({ companyId, ownerId, managers, canAssign, canWrite, email, website, nextFollowupAt }: CompanyActionsMenuProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [followupOpen, setFollowupOpen] = useState(false);
  const [followup, setFollowup] = useState("");
  const [selectedOwner, setSelectedOwner] = useState(ownerId || "unassigned");
  const menuRef = useRef<HTMLDivElement>(null);
  const websiteUrl = normalizedWebsite(website);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function dismissWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissWithKeyboard);
    };
  }, []);

  function saveAssignment() {
    const nextOwnerId = selectedOwner === "unassigned" ? null : selectedOwner;
    if (nextOwnerId === ownerId) {
      setAssignmentOpen(false);
      return;
    }
    startTransition(async () => {
      try {
        const result = await assignPipelineOwner(companyId, nextOwnerId);
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        if (!result?.success) throw new Error("Assignment could not be confirmed. Please refresh and retry.");
        setAssignmentOpen(false);
        toast.success(result.success);
        router.refresh();
      } catch {
        toast.error("Assignment could not be confirmed. Please refresh and retry.");
      }
    });
  }

  async function copy(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(success);
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  }

  function saveFollowup() {
    startTransition(async () => {
      try {
        const result = await scheduleCompanyFollowup(companyId, followupInstant(followup));
        if (result?.error) { toast.error(result.error); return; }
        if (!result?.success) throw new Error("Follow-up could not be confirmed.");
        setFollowupOpen(false);
        toast.success(result.success);
        router.refresh();
      } catch {
        toast.error("Follow-up could not be confirmed. Please refresh and retry.");
      }
    });
  }

  const actionClass = "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

  return <>
    <div ref={menuRef} className="relative shrink-0">
      <button type="button" aria-label="Open company actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen((open) => !open); }} className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <MoreHorizontal className="size-4" />
      </button>
      {menuOpen ? <div role="menu" aria-label="Company actions" className="absolute right-0 top-[calc(100%+0.375rem)] z-[100] w-60 rounded-xl border border-border/80 bg-popover p-1.5 text-popover-foreground shadow-xl shadow-black/10">
        <p className="px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company actions</p>
        {canAssign ? <button type="button" role="menuitem" className={actionClass} onClick={() => { setMenuOpen(false); setSelectedOwner(ownerId || "unassigned"); setAssignmentOpen(true); }}><UserRoundCog />Change assignee</button> : null}
        {canWrite ? <button type="button" role="menuitem" className={actionClass} onClick={() => { setMenuOpen(false); setFollowup(followupLocalTime(nextFollowupAt)); setFollowupOpen(true); }}><CalendarClock />Schedule follow-up</button> : null}
        <button type="button" role="menuitem" className={actionClass} onClick={() => { setMenuOpen(false); router.push(`/companies/${companyId}?tab=history`); }}><History />View activity history</button>
        <button type="button" role="menuitem" className={actionClass} onClick={() => { setMenuOpen(false); router.push(`/pipeline?company=${encodeURIComponent(companyId)}`); }}><PanelsTopLeft />Open in pipeline</button>
        <div role="separator" className="-mx-1 my-1 h-px bg-border" />
        {canWrite ? <button type="button" role="menuitem" className={actionClass} disabled={!email} onClick={() => { setMenuOpen(false); router.push(`/companies/${companyId}?tab=email&compose=1`); }}><Mail />Email customer</button> : null}
        <button type="button" role="menuitem" className={actionClass} disabled={!websiteUrl} onClick={() => { setMenuOpen(false); if (websiteUrl) window.open(websiteUrl, "_blank", "noopener,noreferrer"); }}><ExternalLink />Visit website</button>
        <div role="separator" className="-mx-1 my-1 h-px bg-border" />
        <button type="button" role="menuitem" className={actionClass} disabled={!email} onClick={() => { setMenuOpen(false); if (email) void copy(email, "Email address copied."); }}><Clipboard />Copy email address</button>
        <button type="button" role="menuitem" className={actionClass} onClick={() => { setMenuOpen(false); void copy(companyId, "Company ID copied."); }}><Clipboard />Copy company ID</button>
      </div> : null}
    </div>

    {canWrite ? <Dialog open={followupOpen} onOpenChange={(open) => { if (!pending) setFollowupOpen(open); }}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader><DialogTitle>Schedule follow-up</DialogTitle><DialogDescription>Choose a time in your local timezone. Clear the date to cancel the reminder.</DialogDescription></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); saveFollowup(); }} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="action-followup">Scheduled date and time</Label><Input id="action-followup" type="datetime-local" value={followup} onChange={(event) => setFollowup(event.target.value)} disabled={pending} /></div>
          <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setFollowupOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save follow-up"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog> : null}

    {canAssign ? <Dialog open={assignmentOpen} onOpenChange={(open) => { if (!pending) setAssignmentOpen(open); }}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Change assignee</DialogTitle>
          <DialogDescription>Choose the BD Manager responsible for this company, or return it to the unassigned queue.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="company-assignee">Assigned BD Manager</Label>
          <Select value={selectedOwner} onValueChange={(value) => value && setSelectedOwner(value)} disabled={pending}>
            <SelectTrigger id="company-assignee" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {managers.map((manager) => <SelectItem key={manager.id} value={manager.id}>{manager.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {!managers.length ? <p className="text-xs text-muted-foreground">No active BD Managers are available for assignment.</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setAssignmentOpen(false)}>Cancel</Button>
          <Button type="button" disabled={pending} onClick={saveAssignment}>{pending ? "Saving…" : "Save assignment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog> : null}
  </>;
}
