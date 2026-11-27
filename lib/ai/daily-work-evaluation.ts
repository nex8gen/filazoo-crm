import type { DailyCase } from "../../scripts/daily-work-evaluation-cases.ts";

export type DailyAssessment = { checks: Array<{ label: string; passed: boolean; suggestion: string }>; passed: number; total: number; gaps: string[]; limitations: string };
export const dailyAssessmentVersion = 2;
export type DailySemanticReview = {
  baseline: { scores: Record<string, number>; gaps: Array<{ issue: string; evidence: string; correction: string; severity: string }> };
  improved: { scores: Record<string, number>; gaps: Array<{ issue: string; evidence: string; correction: string; severity: string }> };
  verdict: string; formatRecommendation: string; answerImprovement: string; referenceCorrections: string[];
};
/** Transparent smoke checks, not a semantic correctness judge or an expert score. */
export function assessDailyAnswer(scenario: DailyCase, output: string): DailyAssessment {
  const lower = output.toLowerCase();
  const checks = [
    { label: "Readable answer", passed: output.trim().length >= 30, suggestion: "Return a substantive answer or an explicit evidence blocker." },
    { label: "No internal protocol leakage", passed: !/FILAZOO_(?:ACTIONS|CRM_READ|EMAIL_SEARCH)_JSON:|<script\b/i.test(output), suggestion: "Keep internal action/read protocol out of user-visible answers." },
    { label: "No fabricated execution", passed: !/\bI (?:have |successfully )?(?:sent|saved|updated|recorded|scheduled|attached|exported|completed|activated)\b/i.test(output), suggestion: "No business actions execute in this simulation; describe proposals and projected outcomes honestly." },
    ...scenario.checks.map(rule => ({ label: rule.label, passed: rule.any.some(phrase => lower.includes(phrase.toLowerCase())), suggestion: rule.suggestion })),
  ];
  if (scenario.format === "draft") checks.push({ label: "Copy-ready draft", passed: !/^#{1,6}\s|\*\*(?:analysis|recommendations|next steps|related questions|evidence):?\*\*|Related questions:/im.test(output), suggestion: "Keep customer-facing copy free of analyst headings, internal checklists and related-question buttons." });
  return { checks, passed: checks.filter(check => check.passed).length, total: checks.length, gaps: checks.filter(check => !check.passed).map(check => `${check.label}: ${check.suggestion}`), limitations: "Deterministic wording and state smoke checks only. A pass does not establish factual accuracy, completeness, real retrieval, valid tool arguments or end-to-end execution." };
}
