import type { Metadata } from "next";
import { Suspense } from "react";
import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceSurface } from "@/components/workspace-surface";
import { AppLoading } from "@/components/app-loading";
import { LanguageProvider } from "@/components/language-provider";
import { SiteMonitoring } from "@/components/site-monitoring";
import { WorkspaceErrorBoundary } from "@/components/workspace-error-boundary";
import "./globals.css";
import "./ai-theme.css";
import "./responsive.css";
import "./tables.css";

export const metadata: Metadata = {
  title: { default: "Filazoo", template: "%s · Filazoo" },
  description: "B2B outreach intelligence and relationship management.",
};

export default function RootLayout({ children, company, product }: LayoutProps<"/">) {
  return (
    <html lang="en" className={GeistSans.variable} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <LanguageProvider>
          <ThemeProvider>
            <TooltipProvider><WorkspaceErrorBoundary><Suspense fallback={<AppLoading fullScreen />}><WorkspaceSurface>{children}{company}{product}</WorkspaceSurface></Suspense></WorkspaceErrorBoundary></TooltipProvider>
            <Toaster position="bottom-right" />
          </ThemeProvider>
        </LanguageProvider>
        <Suspense fallback={null}><SiteMonitoring /></Suspense>
      </body>
    </html>
  );
}
