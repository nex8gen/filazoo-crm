"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Laptop, Moon, Sun } from "lucide-react";

const subscribe = () => () => {};

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return <div className="grid gap-3 sm:grid-cols-3">{[{ id: "light", label: "Light", icon: Sun }, { id: "dark", label: "Dark", icon: Moon }, { id: "system", label: "System", icon: Laptop }].map((option) => <button key={option.id} type="button" aria-pressed={mounted && theme === option.id} onClick={() => setTheme(option.id)} className={`flex items-center justify-center gap-3 rounded-xl border px-5 py-8 text-sm focus-visible:outline-2 focus-visible:outline-ring ${mounted && theme === option.id ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}><option.icon className="size-5" />{option.label}</button>)}</div>;
}
