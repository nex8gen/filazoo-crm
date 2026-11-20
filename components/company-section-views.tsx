"use client";

import dynamic from "next/dynamic";
import { CompanySectionSkeleton } from "@/components/company-section-skeleton";

// Keep section code behind a client import boundary. The server still loads
// only the selected tab's data, and profile loads don't preload charts/inbox.
const loadingAnalysis = () => <CompanySectionSkeleton tab="analyse" />;
const loadingPortal = () => <CompanySectionSkeleton tab="customer-portal" />;
const loadingEmail = () => <CompanySectionSkeleton tab="email" />;

export const CompanyAnalysisDashboard = dynamic(() => import("./company-analysis-dashboard").then(module => module.CompanyAnalysisDashboard), { loading: loadingAnalysis });
export const CompanyPortalWorkspace = dynamic(() => import("./company-portal-workspace").then(module => module.CompanyPortalWorkspace), { loading: loadingPortal });
export const EmailInboxWorkspace = dynamic(() => import("./email-inbox").then(module => module.EmailInboxWorkspace), { loading: loadingEmail });
