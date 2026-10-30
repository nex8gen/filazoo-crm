/** Legacy definitions must never silently become broader audience rules. */
export const retiredSalesMessage = "Sales stages are no longer supported. Use company status or segment instead.";
export function hasRetiredSalesConfig(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRetiredSalesConfig);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, field]) =>
    ((key === "pipelineStage" || key === "stage") && typeof field === "string" && field.length > 0)
    || (key === "triggerType" && field === "pipeline_stage_changed")
    || (key === "field" && field === "pipeline_stage_is")
    || hasRetiredSalesConfig(field));
}
