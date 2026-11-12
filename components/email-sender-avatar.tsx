import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { emailSenderAvatar } from "@/lib/email-sender-avatar";

export function EmailSenderAvatar({ email, name, companyId }: { email: string; name?: string; companyId?: string | null }) {
  const avatar = emailSenderAvatar({ email, name, companyId });
  return <Avatar aria-hidden="true" className={`size-8 ${avatar.kind === "brand" ? "bg-white" : "bg-background"}`}>
    {avatar.src ? <AvatarImage src={avatar.src} alt="" loading="lazy" referrerPolicy="no-referrer" className={avatar.kind === "brand" ? "object-contain p-1" : undefined} /> : null}
    <AvatarFallback className="bg-brand-soft text-xs font-semibold text-primary">{avatar.initials}</AvatarFallback>
  </Avatar>;
}
