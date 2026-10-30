export type ProviderFolder = { path: string; name: string; kind: "inbox" | "sent" | "drafts" | "archive" | "trash" | "spam" | "custom" };

export function providerFolderKind(path: string, flags: string[]): ProviderFolder["kind"] {
  const has = (flag: string) => flags.some((value) => value.toLowerCase() === `\\${flag}`.toLowerCase());
  if (/^inbox$/i.test(path)) return "inbox";
  if (has("Sent") || /(?:^|[/\.])(?:sent(?: items| messages)?|已发送|已发送邮件)$/i.test(path)) return "sent";
  if (has("Drafts") || /(?:^|[/\.])(?:drafts?|草稿箱|草稿)$/i.test(path)) return "drafts";
  if (has("Trash") || /(?:^|[/\.])(?:trash|deleted(?: items| messages)?|已删除|已删除邮件)$/i.test(path)) return "trash";
  if (has("Junk") || /(?:^|[/\.])(?:junk(?: email)?|spam|垃圾邮件|垃圾箱)$/i.test(path)) return "spam";
  if (has("Archive") || has("All") || /(?:^|[/\.])(?:archive|all mail|归档|所有邮件)$/i.test(path)) return "archive";
  return "custom";
}

export function validProviderFolder(value: string) { return value.length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value); }
