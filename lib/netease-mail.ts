export const neteaseServerProfiles = {
  standard: { label: "Standard", smtpHost: "smtp.qiye.163.com", imapHost: "imap.qiye.163.com" },
  hangzhou: { label: "Hangzhou", smtpHost: "smtphz.qiye.163.com", imapHost: "imaphz.qiye.163.com" },
  overseas: { label: "Overseas", smtpHost: "hwsmtp.qiye.163.com", imapHost: "hwimap.qiye.163.com" },
} as const;

export type NeteaseServerProfile = keyof typeof neteaseServerProfiles;

export function neteaseProfileForHosts(smtpHost?: string | null, imapHost?: string | null): NeteaseServerProfile | null {
  const smtp = smtpHost?.toLowerCase().trim();
  const imap = imapHost?.toLowerCase().trim();
  return (Object.keys(neteaseServerProfiles) as NeteaseServerProfile[]).find(key =>
    neteaseServerProfiles[key].smtpHost === smtp && neteaseServerProfiles[key].imapHost === imap,
  ) ?? null;
}
