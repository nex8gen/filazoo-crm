import { companyOrderBadge } from "@/lib/company-orders";

const metals = {
  black: { background: "linear-gradient(135deg, #646469 0%, #29292e 32%, #111115 62%, #48484f 100%)", edge: "#26262b", rim: "#97979f", ink: "#ffffff" },
  bronze: { background: "linear-gradient(135deg, #f3d8b6 0%, #c48d5b 30%, #9a5e32 57%, #e2b484 83%, #ad7146 100%)", edge: "#a66c3f", rim: "#fff0da", ink: "#492b16" },
  silver: { background: "linear-gradient(135deg, #fcfdff 0%, #d7dde5 28%, #9aa5b4 56%, #eef2f7 82%, #a9b2c0 100%)", edge: "#929dad", rim: "#ffffff", ink: "#303c4d" },
  gold: { background: "linear-gradient(135deg, #fff3be 0%, #e9c467 29%, #c29736 56%, #ffe9a4 82%, #d1a442 100%)", edge: "#be922c", rim: "#fff6d4", ink: "#5c420e" },
};

export function CompanyOrderBadge({ count, className = "" }: { count: number; className?: string }) {
  const badge = companyOrderBadge(count);
  const metal = metals[badge.tier];
  const description = `${badge.label} · ${badge.tier === "black" ? "No paid orders yet" : `${badge.tier[0].toUpperCase()}${badge.tier.slice(1)}`} · Fully paid invoices; linked invoices count once per order`;
  return <span role="img" aria-label={description} title={description} data-order-tier={badge.tier} data-no-translate
    className={`relative inline-grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border align-middle shadow-[0_1px_2px_#0000001a,inset_0_1px_1px_#ffffff80] ${className}`}
    style={{ background: metal.background, borderColor: metal.edge, color: metal.ink }}>
    <svg aria-hidden="true" viewBox="0 0 32 32" className="absolute inset-0 size-full fill-none">
      <circle cx="16" cy="16" r="13.5" stroke={metal.rim} strokeWidth="0.8" opacity="0.85" />
      <circle cx="16" cy="16" r="11.4" stroke={metal.edge} strokeWidth="0.7" opacity="0.6" />
      <circle cx="16" cy="16" r="12.5" stroke={metal.edge} strokeWidth="0.8" strokeDasharray="0.65 2.3" opacity="0.65" />
      <path d="m6 15 1 1-1 1-1-1Zm20 0 1 1-1 1-1-1Z" fill={metal.rim} opacity="0.8" />
    </svg>
    <span aria-hidden="true" className={`relative font-semibold leading-none tabular-nums ${badge.text === "3+" ? "text-[11px]" : "text-[13px]"}`} style={{ textShadow: "0 1px 0 #ffffff55" }}>{badge.text}</span>
  </span>;
}
