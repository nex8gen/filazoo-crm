import { BrandMarkIcon } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SonarGrid } from "@/components/ui/sonar-grid";

export function AuthShell({ children, footer = "Private Filazoo workspace", animatedBackground = false }: { children: React.ReactNode; footer?: string; animatedBackground?: boolean }) {
  return (
    <main className="relative isolate grid min-h-screen place-items-center overflow-hidden bg-background p-4">
      <div className="absolute right-4 top-4 z-10"><LanguageSwitcher /></div>
      {animatedBackground ? (
        <SonarGrid aria-hidden="true" className="absolute inset-0 -z-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_34%_30%_at_50%_50%,var(--color-background)_0%,transparent_100%)]" />
        </SonarGrid>
      ) : null}
      <div className="relative w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center">
          <BrandMarkIcon className="h-7 w-auto text-foreground" />
        </div>
        {children}
        <p className="text-center text-xs text-muted-foreground">{footer}</p>
      </div>
    </main>
  );
}
