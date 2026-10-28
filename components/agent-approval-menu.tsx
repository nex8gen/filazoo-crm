"use client";

import { ChevronDown, ShieldCheck, Zap } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function AgentApprovalMenu({ value, onChange, disabled, iconOnly = false }: {
  value: "ask" | "auto";
  onChange: (value: "ask" | "auto") => void;
  disabled: boolean;
  iconOnly?: boolean;
}) {
  const { t } = useLanguage();
  const label = value === "ask" ? "Ask for approval" : "Auto-approve";
  return <DropdownMenu>
    <DropdownMenuTrigger disabled={disabled} aria-label={`${t("Action approval")}: ${t(label)}`} title={t(label)} className={`inline-flex items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 ${iconOnly ? "size-9 shrink-0 rounded-xl" : "h-6 w-fit gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2 text-[10px] leading-none"}`}>
      {value === "ask" ? <ShieldCheck aria-hidden="true" className={iconOnly ? "size-4" : "size-3"} /> : <Zap aria-hidden="true" className={iconOnly ? "size-4" : "size-3"} />}{!iconOnly ? <><span>{label}</span><ChevronDown aria-hidden="true" className="size-2.5 opacity-60" /></> : null}
    </DropdownMenuTrigger>
    {/* The portaled positioner must sit above the AI sidebar's z-[60] layer. */}
    <DropdownMenuContent side="top" align="start" positionerClassName="z-[70]" className="w-[300px] max-w-[calc(100vw-2rem)]">
      <DropdownMenuGroup>
        <DropdownMenuLabel>How should agent actions be approved?</DropdownMenuLabel>
        <DropdownMenuRadioGroup aria-label="Action approval" value={value} disabled={disabled} onValueChange={(mode) => { if (mode === "ask" || mode === "auto") onChange(mode); }}>
          {(["ask", "auto"] as const).map((mode) => <DropdownMenuRadioItem key={mode} value={mode} closeOnClick>
            {mode === "ask" ? <ShieldCheck aria-hidden="true" className="text-muted-foreground" /> : <Zap aria-hidden="true" className="text-amber-600 dark:text-amber-400" />}
            <span className="min-w-0 flex-1"><span className="block font-medium">{mode === "ask" ? "Ask for approval" : "Auto-approve"}</span><span className="block text-xs text-muted-foreground">{mode === "ask" ? "Review before each action." : "Includes sending requested emails."}</span></span>
          </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
