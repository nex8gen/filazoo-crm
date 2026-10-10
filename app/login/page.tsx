import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">F</span>
          <span className="text-base font-medium tracking-tight">Filazoo</span>
        </div>
        <LoginForm next={next} />
        <p className="text-center text-xs text-muted-foreground">Private Filazoo workspace</p>
      </div>
    </main>
  );
}
