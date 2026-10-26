import { z } from "zod";
import type { AppLanguage } from "../i18n.ts";
export const companyProfileSchema=z.object({summary:z.string().min(20),productsTheyPrint:z.string(),companySize:z.enum(["small","medium","large","unknown"]),fitScore:z.number().int().min(1).max(10),interestTags:z.array(z.string()).min(1),evidence:z.array(z.string()).min(1),mode:z.literal("mock")});
export type CompanyProfile=z.infer<typeof companyProfileSchema>;
export function runMockProfileAgent(input: { companyName: string; websiteSummary: string; language?: AppLanguage }): CompanyProfile {
  const chinese = input.language === "zh-CN";
  const text = input.websiteSummary.toLowerCase();
  const engineering = /industrial|engineering|工业|工程/.test(text);
  const tags = [engineering ? (chinese ? "工程材料" : "Engineering") : "PLA", /flexible|柔性/.test(text) ? "TPU" : /outdoor|户外/.test(text) ? "PETG" : chinese ? "批量采购" : "Bulk"].filter((tag, index, all) => all.indexOf(tag) === index);
  const score = Math.min(10, 5 + (/3d print|3d\s*打印/.test(text) ? 2 : 0) + (/production|manufactur|生产|制造/.test(text) ? 2 : 0) + (/bulk|批量/.test(text) ? 1 : 0));
  const prototypes = /prototype|原型/.test(text);
  return companyProfileSchema.parse({
    summary: chinese ? `仅根据所提供的企业描述，${input.companyName} 与 Filazoo 的业务具有相关性。` : `${input.companyName} appears relevant to Filazoo based only on the supplied company description.`,
    productsTheyPrint: prototypes ? (chinese ? "原型及功能性零件" : "Prototypes and functional parts") : chinese ? "现有资料尚未确认" : "Not confirmed from supplied evidence",
    companySize: "unknown", fitScore: score, interestTags: tags, evidence: [input.websiteSummary], mode: "mock",
  });
}
