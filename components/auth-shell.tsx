import { BrandMarkIcon } from "@/components/brand-mark";

export function AuthShell({ children, footer = "Private Filazoo workspace" }: { children: React.ReactNode; footer?: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center">
          <BrandMarkIcon className="h-7 w-auto text-foreground" />
        </div>
        {children}
        <p className="text-center text-xs text-muted-foreground">{footer}</p>
      </div>
    </main>
  );
}
