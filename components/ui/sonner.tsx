"use client";

import type { CSSProperties } from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Loader2Icon, XIcon } from "lucide-react";
import "./sonner.css";

// Keep one shared notification host so every toast uses the same appearance,
// stacking, keyboard controls and pause-on-hover behavior throughout the app.
const Toaster = ({ className, style, toastOptions, icons, ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      duration={3000}
      visibleToasts={3}
      gap={10}
      offset={16}
      mobileOffset={16}
      closeButton
      className={`toaster${className ? ` ${className}` : ""}`}
      icons={{
        loading: <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />,
        close: <XIcon aria-hidden="true" className="size-4" />,
        ...icons,
      }}
      style={{
        "--width": "420px",
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "12px",
        ...style,
      } as CSSProperties}
      toastOptions={{
        ...toastOptions,
        classNames: { ...toastOptions?.classNames, toast: `cn-toast${toastOptions?.classNames?.toast ? ` ${toastOptions.classNames.toast}` : ""}` },
      }}
      {...props}
    />
  );
};

export { Toaster };
