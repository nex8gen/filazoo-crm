"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return <Button aria-label="Toggle color theme" size="icon" variant="ghost" suppressHydrationWarning onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}><Sun className="hidden dark:block" /><Moon className="dark:hidden" /></Button>;
}
