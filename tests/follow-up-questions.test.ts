import test from "node:test";
import assert from "node:assert/strict";
import { splitFollowUpQuestions } from "../lib/ai/follow-up-questions.ts";

test("extracts final related questions while preserving the answer and citations", () => {
  const answer = "[Buyer](/companies/verified) requested a quotation. [W1]";
  assert.deepEqual(splitFollowUpQuestions(`${answer}\n\nRelated questions:\n- What is blocking this order?\n- What should we ask this buyer next?`), {
    answer, questions: ["What is blocking this order?", "What should we ask this buyer next?"],
  });
  assert.deepEqual(splitFollowUpQuestions(`${answer}\n\nRelated questions: What is blocking this order? · What should we ask next?`).questions, ["What is blocking this order?", "What should we ask next?"]);
});

test("supports Markdown labels, localized questions and saved inline suggestions", () => {
  for (const heading of ["**Related questions:**", "### Follow-up questions:", "**相关问题：**", "后续问题："]) {
    assert.deepEqual(splitFollowUpQuestions(`客户已确认数量。\n\n${heading}\n1. 下一步应确认什么？\n2. 这笔订单有什么阻碍？`).questions, ["下一步应确认什么？", "这笔订单有什么阻碍？"]);
  }
  assert.deepEqual(splitFollowUpQuestions("Answer.\nRelated questions: Why? · Why?").questions, ["Why?"]);
});

test("does not hide ordinary answers, drafts, code samples or malformed suggestions", () => {
  for (const text of [
    "Answer without suggestions.", "Related questions: Why?", "Answer.\nRelated questions: Not a question.",
    "Answer.\nRelated questions: Why?\nUnrelated trailing prose.", "Answer.\nRelated questions: Why? · When? · Who?",
    "Answer.\nRelated questions: [Click?](javascript:alert(1))", "Answer.\nRelated questions: <script>Why?</script>",
    "Answer.\n```text\nRelated questions: Why?\n```", "Answer.\n~~~\nRelated questions: Why?",
    `Answer.\nRelated questions: ${"a".repeat(201)}?`,
  ]) assert.deepEqual(splitFollowUpQuestions(text), { answer: text, questions: [] }, text);
});
