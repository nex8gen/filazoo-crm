"use client";

import { ErrorState } from "@/components/data-state";

export default function SettingsError({ reset }: { reset: () => void }) {
  return <div className="settings-content"><ErrorState retry={reset} /></div>;
}
