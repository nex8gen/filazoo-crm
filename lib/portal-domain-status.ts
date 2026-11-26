/** Lightweight status display shared with the library; keep DNS parsing out of that client bundle. */
export const portalDomainStatuses = ["pending_dns", "pending_ssl", "connected", "disconnecting"] as const;
export const portalDomainLabels = { pending_dns: "Waiting for DNS", pending_ssl: "Preparing HTTPS", connected: "Connected", disconnecting: "Disconnecting" };
