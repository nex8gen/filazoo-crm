import { connection } from "next/server";
import { notFound } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { getPublicWebsite } from "@/lib/data/public-website";
import { portalWebsiteDesign } from "@/lib/portal-website-design";
import { PortalWebsite } from "@/components/portal-website";

export async function PublicWebsitePage({ params }: { params: Promise<{ workspaceId: string; page?: string[] }> }) {
  await connection();
  const { workspaceId, page: segments } = await params;
  const page = segments?.join("/") || "home";
  if (!/^(home|account|pages\/[A-Za-z0-9_-]{1,64})$/.test(page)) notFound();
  const design = await getPublicWebsite(workspaceId);
  if (!design) notFound();
  const basePath = `/website/${workspaceId}`;
  if (page === "account") return <main className="grid min-h-svh place-items-center bg-muted/30 p-6"><section className="w-full max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm"><LockKeyhole className="mx-auto size-7 text-muted-foreground" /><p className="mt-5 text-sm text-muted-foreground" data-no-translate>{design.brandName}</p><h1 className="mt-2 text-xl font-semibold">Your customer account</h1><p className="mt-4 text-sm text-muted-foreground">Open the secure link shared by your team or scan the QR code on your invoice.</p><a href={basePath} className="mt-6 inline-block text-sm underline">Back to website</a></section></main>;
  const pageId = page === "home" ? "home" : page.slice("pages/".length);
  if (!portalWebsiteDesign(design).pages.some(item => item.id === pageId && item.enabled)) notFound();
  return <PortalWebsite design={design} page={page} basePath={basePath} />;
}
