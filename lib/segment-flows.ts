import type { FlowInput, JsonConfig, TriggerType } from "./flows.ts";

type FlowSegment = { id: string; name: string; kind: string };

export function isSegmentAudienceFlow(triggerType: TriggerType, config: JsonConfig) {
  return triggerType === "company_segment_changed" && (Boolean(config.savedSegmentId) || config.segmentAudience === true);
}

export function segmentCompaniesHref(config: JsonConfig) {
  const query = new URLSearchParams(config.savedSegmentId ? { segmentId: String(config.savedSegmentId) } : { segment: String(config.segment) });
  return `/companies?${query}`;
}

export function segmentFlowHref(segment: FlowSegment) {
  const query = new URLSearchParams(segment.kind === "saved" ? { segmentId: segment.id } : { segment: segment.name });
  return `/workflow?${query}`;
}

export function createSegmentFlowDraft(segment: FlowSegment): FlowInput {
  return {
    name: `${segment.name} auto workflow`.slice(0, 160),
    triggerType: "company_segment_changed",
    triggerConfig: { segment: segment.name, segmentAudience: true, ...(segment.kind === "saved" ? { savedSegmentId: segment.id } : {}), reentryMode: "no_reentry" },
    status: "draft",
    steps: [],
  };
}
