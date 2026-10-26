export type CompanyEmailScope = {
  id: string;
  name: string;
  emails: string[];
};

/** Match saved customer addresses exactly; company names and domains are not unique. */
export function filterCompanyEmails<T extends { contact: string }>(messages: T[], company: CompanyEmailScope): T[] {
  const addresses = new Set(company.emails.map((email) => email.trim().toLowerCase()).filter(Boolean));
  return messages.filter((message) => addresses.has(message.contact.trim().toLowerCase()));
}
