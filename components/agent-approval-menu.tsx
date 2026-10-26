"use client";

import { useId, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, ShieldCheck, Zap } from "lucide-react";
import { useLanguage } from "@/components/language-provider";

export function AgentApprovalMenu({ value, onChange, disabled }: {
  value: "ask" | "auto";
  onChange: (value: "ask" | "auto") => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const name = useId();
  const { t } = useLanguage();
  const label = value === "ask" ? "Ask for approval" : "Auto-approve";
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger disabled={disabled} aria-label={`${t("Action approval")}: ${t(label)}`} className="inline-flex h-6 w-fit items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2 text-[10px] leading-none text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50">
      {value === "ask" ? <ShieldCheck aria-hidden="true" className="size-3" /> : <Zap aria-hidden="true" className="size-3" />}<span>{label}</span><ChevronDown aria-hidden="true" className="size-2.5 opacity-60" />
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="top" align="start" sideOffset={7} className="z-[80]">
        <Popover.Popup className="w-[300px] max-w-[calc(100vw-2rem)] rounded-xl border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-xl outline-none">
          <Popover.Title className="px-2 py-1.5 text-[10px] font-normal text-muted-foreground">How should agent actions be approved?</Popover.Title>
          <fieldset className="space-y-0.5 border-0 p-0">
            <legend className="sr-only">Action approval</legend>
            {(["ask", "auto"] as const).map((mode) => <label key={mode} className="relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-muted/70 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring">
              <input type="radio" name={name} value={mode} checked={value === mode} disabled={disabled} onChange={() => { onChange(mode); setOpen(false); }} className="sr-only" />
              {mode === "ask" ? <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /> : <Zap aria-hidden="true" className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />}
              <span className="min-w-0 flex-1"><span className="block text-[11px] font-medium leading-4">{mode === "ask" ? "Ask for approval" : "Auto-approve"}</span><span className="block text-[10px] leading-4 text-muted-foreground">{mode === "ask" ? "Review before each action." : "Includes sending requested emails."}</span></span>
              {value === mode ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /> : <span aria-hidden="true" className="size-3.5 shrink-0" />}
            </label>)}
          </fieldset>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
