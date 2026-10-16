import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export function LegalPage({
  eyebrow,
  title,
  description,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b bg-background/95">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 sm:px-8">
          <a href="https://filazoo.com" className="flex items-center gap-2.5 font-semibold" aria-label="Filazoo website">
            <BrandMark className="h-6 w-auto text-primary" />
            <span>Filazoo</span>
          </a>
          <nav className="flex items-center gap-5 text-sm text-muted-foreground" aria-label="Legal pages">
            <Link className="transition-colors hover:text-foreground" href="/privacy">Privacy</Link>
            <Link className="transition-colors hover:text-foreground" href="/data-deletion">Data deletion</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-primary">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{description}</p>
        <p className="mt-3 text-xs text-muted-foreground">Last updated: {updated}</p>

        <article className="mt-10 space-y-9 text-sm leading-7 text-foreground/90 [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:pl-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
          {children}
        </article>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© 2026 Filazoo</span>
          <a href="mailto:raul@filazoo.com" className="hover:text-foreground">raul@filazoo.com</a>
        </div>
      </footer>
    </div>
  );
}
