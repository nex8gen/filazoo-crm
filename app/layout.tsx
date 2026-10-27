import type { Metadata } from "next";
import { Suspense } from "react";
import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/app-shell";
import { LanguageProvider } from "@/components/language-provider";
import { UserMenu } from "@/components/user-menu";
import { AccountPreferences } from "@/components/account-preferences";
import "./globals.css";
import "./responsive.css";
import "./tables.css";

export const metadata: Metadata = {
  title: { default: "Filazoo", template: "%s · Filazoo" },
  description: "B2B outreach intelligence and relationship management.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={GeistSans.variable} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <LanguageProvider>
          <ThemeProvider>
            <TooltipProvider><Suspense fallback={<div className="min-h-svh bg-background" />}><AccountPreferences><AppShell userMenu={<Suspense fallback={<span className="size-7 rounded-full bg-muted" />}><UserMenu /></Suspense>}>{children}</AppShell></AccountPreferences></Suspense></TooltipProvider>
            <Toaster position="bottom-right" />
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
