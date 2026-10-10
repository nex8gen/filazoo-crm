export function AuthShell({ children, footer = "Private Filazoo workspace" }: { children: React.ReactNode; footer?: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">F</span>
          <span className="text-base font-medium tracking-tight">Filazoo</span>
        </div>
        {children}
        <p className="text-center text-xs text-muted-foreground">{footer}</p>
      </div>
    </main>
  );
}
