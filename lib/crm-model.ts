import {
  pipelineStageLabels,
  pipelineStageValues,
  type PipelineStage,
  type PipelineStageValue,
} from "./types.ts";

const legacyStageMap: Record<string, PipelineStageValue> = {
  qualified: "interested",
  sample: "interested",
  negotiation: "big_order",
};

export function normalizePipelineStage(value: string | null | undefined): PipelineStageValue {
  if (!value) return "new";
  if ((pipelineStageValues as readonly string[]).includes(value)) return value as PipelineStageValue;
  return legacyStageMap[value] ?? "new";
}

export function getPipelineStageLabel(value: string | null | undefined): PipelineStage {
  return pipelineStageLabels[normalizePipelineStage(value)];
}

export function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function companySourcePresentation(source: string | null | undefined) {
  const channels: { label: string; icon: "shopify" | "meta" | null }[] = [];
  for (const token of (source ?? "").split("+")) {
    const value = token.trim().toLowerCase();
    if (!value) continue;
    const channel = /^shopify(?:_|$)/.test(value) ? { label: "Shopify B2B", icon: "shopify" as const }
      : /^(?:meta|facebook|messenger|instagram)(?:_|$)/.test(value) ? { label: "Meta", icon: "meta" as const }
      : { label: value === "manual" ? "Manual" : value.replaceAll("_", " "), icon: null };
    if (!channels.some(({ label }) => label === channel.label)) channels.push(channel);
  }
  // Ingress appends later channels. Keep the original acquisition source first,
  // just as the saved lead segment does, while retaining every channel in labels.
  return {
    label: channels.map(({ label }) => label).join(" + ") || "Imported",
    icon: channels[0]?.icon ?? null,
    count: channels.length,
  };
}

export function formatRelativeDate(value: string | null | undefined, now = new Date()) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  const difference = date.getTime() - now.getTime();
  const days = Math.round(difference / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 14) return `In ${days} days`;
  if (days < -1 && days > -14) return `${Math.abs(days)} days ago`;
  return date.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}
