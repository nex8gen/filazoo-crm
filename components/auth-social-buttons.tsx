"use client";

import { NotificationToast } from "@/components/ui/notification-toast";


import { useActionState } from "react";
import { socialSignIn } from "@/app/auth/social-actions";
import type { AuthProvider } from "@/lib/auth-providers";

export function AuthSocialButtons({ providers, next, signup = false, layout = "inline" }: { providers: AuthProvider[]; next: string; signup?: boolean; layout?: "inline" | "tiles" }) {
  const [state, action, pending] = useActionState(socialSignIn, undefined);
  const displayed = [...new Set<AuthProvider>([...providers, "alipay", "wechat"])];
  if (layout === "tiles") {
    return <div className="mt-[var(--auth-social-gap,2.5rem)]">
      <p className="mb-3 flex items-center gap-3 text-center text-xs text-black/55 dark:text-white/55"><span aria-hidden="true" className="h-px flex-1 bg-border" />or continue with<span aria-hidden="true" className="h-px flex-1 bg-border" /></p>
      <form action={action} aria-busy={pending} className="grid grid-cols-2 gap-3">
        <input type="hidden" name="next" value={next} />
        {displayed.map(provider => <button key={provider} type="submit" name="provider" value={provider} disabled={pending || !providers.includes(provider)}
          aria-label={`${signup ? "Sign up" : "Sign in"} with ${providerName(provider)}`}
          aria-description={!providers.includes(provider) ? `${providerName(provider)} sign-in is awaiting activation.` : undefined}
          className="flex h-11 min-w-0 items-center justify-center gap-2 rounded-[10px] border border-black/25 px-3 text-sm hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5"><ProviderIcon provider={provider} />{providerName(provider)}</button>)}
      </form>
      {state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}
    </div>;
  }
  return <div className="mb-[var(--auth-social-margin,1.75rem)]">
    <form action={action} aria-busy={pending} className="grid grid-cols-2 gap-3">
      <input type="hidden" name="next" value={next} />
      {displayed.map(provider => <button key={provider} type="submit" name="provider" value={provider} disabled={pending || !providers.includes(provider)}
        aria-label={`${signup ? "Sign up" : "Sign in"} with ${providerName(provider)}`}
        aria-description={!providers.includes(provider) ? `${providerName(provider)} sign-in is awaiting activation.` : undefined}
        className="flex h-11 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-black/25 px-3 text-sm hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5"><ProviderIcon provider={provider} /><span><span className="hidden sm:inline">{signup ? "Sign up" : "Sign in"} with </span>{providerName(provider)}</span></button>)}
    </form>
    {state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}
    <div className="mt-[var(--auth-divider-gap,1.75rem)] mb-[var(--auth-divider-gap,1.75rem)] flex items-center gap-4 text-sm text-black/50 dark:text-white/50"><span className="h-px flex-1 bg-black/15 dark:bg-white/15" />or continue with email<span className="h-px flex-1 bg-black/15 dark:bg-white/15" /></div>
  </div>;
}

function providerName(provider: AuthProvider) { return { alipay: "Alipay", wechat: "WeChat", google: "Google", apple: "Apple" }[provider]; }
function ProviderIcon({ provider }: { provider: AuthProvider }) {
  if (provider === "wechat") return <WechatIcon />;
  return provider === "google" ? <GoogleIcon /> : provider === "apple" ? <AppleIcon /> : <AlipayIcon />;
}

function AlipayIcon() {
  // Alipay brand mark from Simple Icons (CC0), with the logo's original shape.
  return <svg width="20" height="20" viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
    <rect x=".102" y=".001" width="23.796" height="24" rx="3.8" fill="white" />
    <path fill="#1677FF" d="M19.695 15.07c3.426 1.158 4.203 1.22 4.203 1.22V3.846c0-2.124-1.705-3.845-3.81-3.845H3.914C1.808.001.102 1.722.102 3.846v16.31c0 2.123 1.706 3.845 3.813 3.845h16.173c2.105 0 3.81-1.722 3.81-3.845v-.157s-6.19-2.602-9.315-4.119c-2.096 2.602-4.8 4.181-7.607 4.181-4.75 0-6.361-4.19-4.112-6.949.49-.602 1.324-1.175 2.617-1.497 2.025-.502 5.247.313 8.266 1.317a16.796 16.796 0 0 0 1.341-3.302H5.781v-.952h4.799V6.975H4.77v-.953h5.81V3.591s0-.409.411-.409h2.347v2.84h5.744v.951h-5.744v1.704h4.69a19.453 19.453 0 0 1-1.986 5.06c1.424.52 2.702 1.011 3.654 1.333m-13.81-2.032c-.596.06-1.71.325-2.321.869-1.83 1.608-.735 4.55 2.968 4.55 2.151 0 4.301-1.388 5.99-3.61-2.403-1.182-4.438-2.028-6.637-1.809" />
  </svg>;
}

function WechatIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
    <path fill="#07C160" d="M9.5 3C4.8 3 1 6.1 1 10c0 2.2 1.2 4.2 3.1 5.5l-.8 2.7 3-1.5c1 .3 2 .5 3.2.5h.6A6.9 6.9 0 0 1 9 13.5c0-3.9 3.7-7 8.2-7h.2C16 4.4 13 3 9.5 3Z" />
    <path fill="#07C160" d="M23 13.5c0-3.1-2.9-5.5-6.5-5.5S10 10.4 10 13.5 12.9 19 16.5 19c.9 0 1.7-.1 2.4-.4l2.5 1.3-.7-2.3c1.4-1 2.3-2.5 2.3-4.1Z" />
    <g fill="white"><circle cx="6.5" cy="8.5" r="1" /><circle cx="12" cy="8.5" r="1" /><circle cx="14" cy="12.5" r=".8" /><circle cx="19" cy="12.5" r=".8" /></g>
  </svg>;
}

function GoogleIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853" /><path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84Z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1.64 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" fill="#EB4335" /></svg>;
}

function AppleIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 12.54c-.03-3.02 2.47-4.47 2.58-4.54-1.41-2.06-3.6-2.34-4.38-2.37-1.86-.19-3.64 1.1-4.58 1.1-.95 0-2.42-1.07-3.98-1.04-2.05.03-3.94 1.19-4.99 3.02-2.13 3.69-.54 9.16 1.53 12.15 1.01 1.46 2.22 3.1 3.81 3.04 1.53-.06 2.11-.99 3.96-.99s2.37.99 3.99.96c1.65-.03 2.69-1.49 3.69-2.96 1.16-1.69 1.64-3.33 1.66-3.41-.04-.02-3.2-1.23-3.24-4.87ZM14.03 3.66c.84-1.02 1.41-2.43 1.25-3.84-1.21.05-2.68.81-3.55 1.83-.78.9-1.46 2.34-1.28 3.72 1.35.1 2.73-.69 3.58-1.71Z" /></svg>;
}
