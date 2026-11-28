import type { Metadata } from "next";
import { MarketingSite } from "@/components/marketing/marketing-site";
import { MARKETING_ORIGIN } from "@/lib/marketing";

const description = "Meet NewAI, the connected AI workspace for B2B sales. Find leads, manage customers and email, automate follow-ups, and take quotations through to orders and invoices.";

export const metadata: Metadata = {
  metadataBase: new URL(MARKETING_ORIGIN),
  title: { absolute: "NewAI — Sell smarter. Grow better, together." },
  description,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", siteName: "NewAI", title: "NewAI — Sell smarter. Grow better, together.", description, url: "/", images: [{ url: "/marketing/social-card.png", width: 1200, height: 630, alt: "NewAI — Sell smarter. Grow better, together." }] },
  twitter: { card: "summary_large_image", title: "NewAI — Sell smarter. Grow better, together.", description, images: ["/marketing/social-card.png"] },
};

export default function MarketingPage() {
  return <MarketingSite />;
}
