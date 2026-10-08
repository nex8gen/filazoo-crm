import type { Metadata } from "next";
import { Manrope, Sora } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { Suspense } from "react";
import "./globals.css";

const manrope = Manrope({ variable: "--font-body", subsets: ["latin"] });
const sora = Sora({ variable: "--font-display", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Filazoo CRM", template: "%s · Filazoo CRM" },
  description: "B2B prospecting, outreach, and relationship management for Filazoo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} ${sora.variable}`}>
      <body>
        <Suspense fallback={<main className="main-content"><div className="page-loading">Loading workspace…</div></main>}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
