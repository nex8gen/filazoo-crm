import "server-only";
import { simulateFlow, type FlowFacts } from "../flow-engine.ts";
import type { FlowEmailTestInput, FlowEmailTestResult } from "../flow-email-test.ts";
import { generateFlowAiReply, loadFlowReplyProducts, prepareFlowTemplateCatalog, type FlowReplyMessage } from "./flow-ai-reply.ts";
import { emailTemplates, renderFlowTemplate } from "../flow-templates.ts";

/** Preview only: never creates a run, writes CRM data, uploads attachments or sends email. */
export async function testFlowWithEmails(input: FlowEmailTestInput, managerName: string | null): Promise<FlowEmailTestResult> {
  const config = input.flow.triggerConfig;
  const facts: FlowFacts = { customerReplied: false, openedEmail: false, clickedLink: false,
    category: typeof config.category === "string" ? config.category : null,
    segment: typeof config.segment === "string" ? config.segment : null,
    country: typeof config.country === "string" ? config.country : null,
    companyStatus: typeof config.companyStatus === "string" ? config.companyStatus : null,
    pipelineStage: typeof config.pipelineStage === "string" ? config.pipelineStage : null,
    fitScore: typeof config.minFitScore === "number" ? config.minFitScore : null };
  const simulation = simulateFlow(input.flow, facts);
  const executedAi = simulation.trace.filter((entry) => entry.type === "ai_auto_reply" && entry.status === "would_run");
  if (executedAi.length * input.emails.length > 6) throw new Error("Test up to six AI actions at a time. Use fewer sample emails.");
  const productRows = executedAi.length ? await loadFlowReplyProducts({
    useProducts: executedAi.some((entry) => input.flow.steps[entry.step - 1].config.useProducts === true),
    attachCatalog: executedAi.some((entry) => input.flow.steps[entry.step - 1].config.attachCatalog === true),
  }) : [];
  const result: FlowEmailTestResult = { cases: [] };
  for (const email of input.emails) {
    const testCase: FlowEmailTestResult["cases"][number] = { subject: email.subject, trace: simulation.trace, replies: [] };
    const messages: FlowReplyMessage[] = [{ subject: email.subject, body: email.body, direction: "received", created_at: new Date().toISOString() }];
    let previousMessages = input.firstMessage ? 0 : 1;
    for (const entry of simulation.trace) {
      if (entry.status !== "would_run") continue;
      const step = input.flow.steps[entry.step - 1];
      if (step.type === "send_email") {
        try {
          const template = emailTemplates[String(step.config.templateId)];
          const contact = { name: input.customerName, email: email.from };
          const subject = renderFlowTemplate(String(step.config.subject || template.subject), contact);
          const body = renderFlowTemplate(String(step.config.body || template.body), contact);
          const attachments = step.config.templateId === "send_catalog" ? await prepareFlowTemplateCatalog() : [];
          testCase.replies.push({ step: entry.step, subject, body, attachments: attachments.map((attachment) => ({ filename: attachment.filename, size: attachment.content.length })) });
          previousMessages += 1;
          messages.unshift({ subject, body, direction: "sent", created_at: new Date().toISOString() });
        } catch (error) { testCase.error = error instanceof Error ? error.message : "Unable to prepare template."; break; }
      }
      if (step.type !== "ai_auto_reply") continue;
      try {
        const reply = await generateFlowAiReply({ config: step.config, contact: { name: input.customerName, email: email.from },
          company: { name: input.companyName, country: facts.country, segment: facts.segment }, managerName, messages, productRows,
          previousAutomatedMessages: previousMessages });
        testCase.replies.push({ step: entry.step, subject: reply.subject, body: reply.body,
          attachments: reply.attachments.map((attachment) => ({ filename: attachment.filename, size: attachment.content.length })) });
        messages.unshift({ subject: reply.subject, body: reply.body, direction: "sent", created_at: new Date().toISOString() });
        previousMessages += 1;
      } catch (error) {
        testCase.error = error instanceof Error ? error.message : "Unable to generate the test reply.";
        break;
      }
    }
    result.cases.push(testCase);
  }
  return result;
}
