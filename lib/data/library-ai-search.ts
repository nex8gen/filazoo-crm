import "server-only";
import type { WorkspaceViewer } from "../auth.ts";
import { requireAiFeature } from "./ai-settings.ts";
import { resolveGatewayTokenAsync } from "../ai/provider-credentials.ts";
import { generateGatewayText } from "../ai/gateway.ts";
import { listDocuments } from "./documents.ts";
import { librarySearchTerms, libraryTermsInstruction, librarySelectionInstruction, parseLibraryJson, resolveLibrarySelection, libraryQueries } from "../ai/library-search.ts";

export async function searchLibraryWithAi(viewer: WorkspaceViewer, query: string, kind?: "file" | "template") {
  await requireAiFeature("email", "customers", "products", "billing", "knowledge", "emails");
  const token = await resolveGatewayTokenAsync(process.env);
  if (!token) throw new Error("Configure an AI provider to search the library with AI.");
  const signal = AbortSignal.timeout(55_000);
  const generate = (systemInstruction: string, prompt: string) => generateGatewayText({ token, task: "email", usageUserId: viewer.id, systemInstruction, prompt, maxOutputTokens: 1200, signal });
  const terms = librarySearchTerms.parse(parseLibraryJson(await generate(libraryTermsInstruction, query)));
  const pages = await Promise.all(libraryQueries(query, terms.queries).map(q => listDocuments(viewer, new URLSearchParams({ q, sort: "newest", attachable: "1", ...(kind ? { kind } : {}) }))));
  const candidates = [...new Map(pages.flatMap(page => page.documents).map(item => [item.id, item])).values()];
  if (!candidates.length) return { documents: [], explanation: "No matching files or templates found. Try a customer name, product, or document reference." };
  const selection = await generate(librarySelectionInstruction, JSON.stringify({ request: query, candidates: candidates.map(({ id, name, kind, description, category, company, updated_at, tags }) => ({ id, name, kind, description, category, company, updated_at, tags })) }));
  return resolveLibrarySelection(parseLibraryJson(selection), candidates);
}
