import Image from "next/image";
import type { ReactNode } from "react";
import type { Company } from "@/lib/types";
import { companyPortrait } from "@/lib/company-avatar";

export function CompanyAvatar({ company, size = "sm", badge, badgeLabel }: {
  company: Pick<Company, "id" | "name"> & Partial<Pick<Company, "source" | "sourceLabel">>;
  size?: "sm" | "lg"; badge?: ReactNode; badgeLabel?: string;
}) {
  const isShopify = company.source?.includes("shopify");
  const isMeta = /meta|facebook|messenger|instagram/i.test(company.source ?? "");

  return <div className={`relative shrink-0 ${size === "lg" ? "size-11" : "size-8"}`}>
    <Image src={companyPortrait(company.id)} alt={`${company.name} profile`} width={44} height={44} unoptimized className="size-full rounded-full bg-muted object-cover ring-1 ring-border/70" />
    {badge ? <span role="img" aria-label={badgeLabel} title={badgeLabel} className="absolute -right-1 -bottom-0.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground ring-[2.5px] ring-card [&>svg]:size-3">{badge}</span> : isShopify || isMeta ? <span role="img" aria-label={`Lead source: ${company.sourceLabel}`} title={`Lead source: ${company.sourceLabel}`} className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-background ring-2 ring-background">
      <Image src={isShopify ? "/shopify-mark.svg" : "/meta-mark.svg"} alt="" width={12} height={12} unoptimized className="size-3 object-contain" />
    </span> : null}
  </div>;
}
