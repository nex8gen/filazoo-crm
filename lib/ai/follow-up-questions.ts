/** Read only a final, well-formed suggestions section; leave other prose intact. */
export function splitFollowUpQuestions(text: string): { answer: string; questions: string[] } {
  const section = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]+)?(?:\*\*)?(?:Related questions|Follow-up questions|相关问题|后续问题)(?:\*\*)?[ \t]*[:：](?:\*\*)?[ \t]*([\s\S]*)$/i.exec(text);
  if (!section) return { answer: text, questions: [] };
  const answer = text.slice(0, section.index).trimEnd();
  // A label in a code sample is content, not a request control.
  if (!answer.trim() || (answer.match(/^\s*(?:```|~~~)/gm)?.length ?? 0) % 2) return { answer: text, questions: [] };
  const candidates = section[1].trim().split(/\r?\n|[ \t]+·[ \t]+/).map(value => value.trim().replace(/^(?:[-*•]|\d+[.)])[ \t]+/, "").replace(/^\*\*(.+)\*\*$/, "$1")).filter(Boolean);
  if (!candidates.length || candidates.length > 2 || candidates.some(value => value.length > 200 || !/[?？]$/.test(value) || /[<>`\[\]]/.test(value))) return { answer: text, questions: [] };
  return { answer, questions: [...new Set(candidates)] };
}
