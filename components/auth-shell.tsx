import AuthSectionOne from "@/components/ui/auth-section-1";

export function AuthShell({ children, footer, step, variant }: { children: React.ReactNode; footer?: string; animatedBackground?: boolean; step?: 1 | 2 | 3; variant?: "signin" | "signup" }) {
  return <AuthSectionOne footer={footer} step={step} variant={variant}>{children}</AuthSectionOne>;
}
