"use client";

import dynamic from "next/dynamic";

// Keep section code behind a client import boundary. The server still loads
// only the selected tab's data, and profile loads don't preload charts/inbox.
const loading = () => <div role="status" className="min-h-60 rounded-lg bg-muted/20 p-5 text-sm text-muted-foreground">Loading…</div>;

export const CompanyAnalysisDashboard = dynamic(() => import("./company-analysis-dashboard").then(module => module.CompanyAnalysisDashboard), { loading });
export const CompanyPortalWorkspace = dynamic(() => import("./company-portal-workspace").then(module => module.CompanyPortalWorkspace), { loading });
export const EmailInboxWorkspace = dynamic(() => import("./email-inbox").then(module => module.EmailInboxWorkspace), { loading });
