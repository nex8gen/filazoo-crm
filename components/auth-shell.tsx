import AuthSectionOne from "@/components/ui/auth-section-1";

export function AuthShell({ children, footer, step }: { children: React.ReactNode; footer?: string; animatedBackground?: boolean; step?: number }) {
  return <AuthSectionOne footer={footer} step={step}>{children}</AuthSectionOne>;
}
