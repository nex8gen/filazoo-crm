"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "cn";

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return <SwitchPrimitive.Root data-slot="switch" className={cn("group/switch relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full bg-neutral-300 p-[3px] align-middle shadow-inner outline-none transition-colors duration-200 before:absolute before:-inset-y-2 before:inset-x-0 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-checked:bg-[#248a50] data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:bg-neutral-600 dark:data-checked:bg-[#34c759] motion-reduce:transition-none", className)} {...props}>
    <SwitchPrimitive.Thumb data-slot="switch-thumb" className="pointer-events-none block size-[22px] translate-x-0 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/25%)] transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] group-active/switch:scale-95 data-checked:translate-x-5 motion-reduce:transition-none rtl:data-checked:-translate-x-5" />
  </SwitchPrimitive.Root>;
}
