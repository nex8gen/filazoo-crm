"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { monitoringUrl } from "@/lib/monitoring-url";

export function SiteMonitoring() {
  return <>
    <Analytics beforeSend={(event) => ({ ...event, url: monitoringUrl(event.url) })} />
    <SpeedInsights beforeSend={(event) => ({ ...event, url: monitoringUrl(event.url) })} />
  </>;
}
