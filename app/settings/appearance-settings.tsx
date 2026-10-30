"use client";

import { useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Check, CheckCircle2, Laptop, Moon, Sun } from "lucide-react";

const subscribe = () => () => {};

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const [changed, setChanged] = useState(false);
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return <div className="space-y-4"><div role="group" aria-label="Color theme" className="grid grid-cols-3 gap-3">{[{ id: "light", label: "Light", icon: Sun }, { id: "dark", label: "Dark", icon: Moon }, { id: "system", label: "System", icon: Laptop }].map(option => {
    const selected = mounted && theme === option.id;
    return <button key={option.id} type="button" disabled={!mounted} aria-pressed={selected} onClick={() => { setTheme(option.id); setChanged(true); }} className={`min-w-0 rounded-xl border p-2.5 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:p-3 ${selected ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/50"}`}><span aria-hidden="true" className={`relative mb-3 flex h-20 overflow-hidden rounded-lg border sm:h-24 ${option.id === "light" ? "bg-white text-neutral-900" : option.id === "dark" ? "bg-neutral-900 text-white" : "bg-[linear-gradient(90deg,#fff_50%,#171717_50%)] text-neutral-500"}`}><span className="flex w-1/4 flex-col gap-2 border-r bg-neutral-500/10 p-2"><span className="settings-preview-line w-full" /><span className="settings-preview-line w-full" /><span className="settings-preview-line w-full" /></span><span className="flex flex-1 flex-col gap-2 p-3"><span className="settings-preview-line w-2/3" /><span className="mt-1 h-6 rounded border border-current opacity-15" /><span className="settings-preview-line w-full" /></span></span><span className="flex items-center justify-center gap-1.5"><option.icon aria-hidden="true" className="size-3.5 shrink-0" /><span>{option.label}</span>{selected ? <Check aria-hidden="true" className="size-3.5 text-primary" /> : null}</span></button>;
  })}</div><p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">{changed ? <CheckCircle2 aria-hidden="true" className="size-4 text-primary" /> : null}{changed ? "Theme saved for this browser." : "Applies immediately in this browser."}</p></div>;
}
