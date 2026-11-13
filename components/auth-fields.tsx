"use client";

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

export const authButtonClass = "flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-action px-5 text-base font-medium text-action-foreground transition-colors hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-action-ring focus-visible:outline-offset-4 disabled:cursor-wait disabled:opacity-50";

export function AuthHeading({ title, children }: { title: string; children: ReactNode }) {
  return <div className="mb-8"><h1 className="text-3xl font-semibold leading-tight tracking-[-0.025em] sm:text-4xl">{title}</h1><div className="mt-3 text-base leading-6 text-black/60 dark:text-white/60">{children}</div></div>;
}

export function AuthField({ label, id, type = "text", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="space-y-2"><label htmlFor={id} className="text-sm font-medium">{label}</label><div className="relative"><input {...props} id={id} type={type === "password" && visible ? "text" : type} className={`h-12 w-full min-w-0 rounded-[10px] border border-black/25 bg-transparent px-4 text-[1rem] leading-6 text-black outline-none transition-shadow placeholder:text-black/35 focus:border-primary focus:ring-2 focus:ring-ring/20 disabled:opacity-60 dark:border-white/20 dark:text-white dark:placeholder:text-white/35 dark:focus:border-primary ${type === "password" ? "pr-12" : ""}`} />{type === "password" ? <button type="button" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible(v => !v)} className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded text-black/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring dark:text-white/50">{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button> : null}</div></div>;
}
