import AuthSectionOne from "@/components/ui/auth-section-1";

export function AuthShell({ children, footer, step, variant }: { children: React.ReactNode; footer?: string; animatedBackground?: boolean; step?: number; variant?: "signin" }) {
  return <AuthSectionOne footer={footer} step={step} variant={variant}>{children}</AuthSectionOne>;
}
