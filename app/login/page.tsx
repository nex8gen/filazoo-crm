import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">F</span>
          <span className="text-base font-medium tracking-tight">Filazoo</span>
        </div>
        <LoginForm />
        <p className="text-center text-xs text-muted-foreground">Private workspace · Demo interface</p>
      </div>
    </main>
  );
}
