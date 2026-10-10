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
