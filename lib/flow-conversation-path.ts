/** Keep notification navigation independent of the workflow execution engine. */
export function flowConversationPath(conversationId: string) {
  const company = /^company:([\da-f-]{36})(?::pipeline|:lead:[\da-f-]{36})?$/i.exec(conversationId);
  return company ? `/companies/${company[1]}` : `/email?thread=${encodeURIComponent(conversationId)}`;
}
