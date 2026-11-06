export type CompanyEmailScope = {
  id: string;
  name: string;
  emails: string[];
  ownerId?: string | null;
};

type EmailParticipants = {
  contact: string; from?: string;
  to?: readonly { address: string }[]; cc?: readonly { address: string }[]; bcc?: readonly { address: string }[];
};

/** Header participants only: quoted bodies, names and domains cannot establish ownership. */
export function emailParticipantAddresses(message: EmailParticipants): string[] {
  return [...new Set([message.contact, message.from, ...message.to?.map(item => item.address) ?? [],
    ...message.cc?.map(item => item.address) ?? [], ...message.bcc?.map(item => item.address) ?? []]
    .flatMap(address => address?.trim() ? [address.trim().toLowerCase()] : []))];
}

export function companyEmailContact(message: EmailParticipants, addresses: ReadonlySet<string>): string | undefined {
  return emailParticipantAddresses(message).find(address => addresses.has(address));
}

/** Match all exact saved customer participants, including secondary To and CC recipients. */
export function filterCompanyEmails<T extends EmailParticipants>(messages: T[], company: CompanyEmailScope): T[] {
  const addresses = new Set(company.emails.map((email) => email.trim().toLowerCase()).filter(Boolean));
  return messages.filter((message) => companyEmailContact(message, addresses) !== undefined);
}

/** Carry company authorization through lazy bodies, inline images and downloads. */
export function scopeCompanyEmailContent<T extends { html?: string | null; attachments?: Array<{ url?: string }> }>(email: T, companyId: string): T & { companyScopeId: string } {
  let html = email.html;
  const attachments = email.attachments?.map(attachment => {
    if (!attachment.url?.startsWith("/api/email/")) return attachment;
    const url = new URL(attachment.url, "http://crm.local");
    url.searchParams.set("companyId", companyId);
    const scoped = `${url.pathname}${url.search}`;
    if (html) {
      const escaped = attachment.url.replaceAll("&", "&amp;");
      const pattern = [escaped, attachment.url].filter((value, index, values) => values.indexOf(value) === index)
        .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      html = html.replace(new RegExp(pattern, "g"), match => match === escaped ? scoped.replaceAll("&", "&amp;") : scoped);
    }
    return { ...attachment, url: scoped };
  });
  return { ...email, html, attachments, companyScopeId: companyId };
}
