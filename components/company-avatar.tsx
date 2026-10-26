import Image from "next/image";
import type { Company } from "@/lib/types";

export function CompanyAvatar({ company }: { company: Pick<Company, "initials" | "source" | "sourceLabel"> }) {
  const isShopify = company.source.includes("shopify");
  const isMeta = /meta|facebook|messenger|instagram/i.test(company.source);

  return <div className="relative size-8 shrink-0">
    <span className="flex size-8 items-center justify-center rounded-full border border-border bg-primary/10 text-xs font-semibold text-primary">
      {company.initials}
    </span>
    {isShopify || isMeta ? <span role="img" aria-label={`Lead source: ${company.sourceLabel}`} title={`Lead source: ${company.sourceLabel}`} className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-background ring-2 ring-background">
      <Image src={isShopify ? "/shopify-mark.svg" : "/meta-mark.svg"} alt="" width={12} height={12} unoptimized className="size-3 object-contain" />
    </span> : null}
  </div>;
}
