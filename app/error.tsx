"use client";

import { ErrorState } from "@/components/data-state";

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return <ErrorState retry={retry} />;
}
