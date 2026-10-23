"use client";

import { useSearchParams } from "next/navigation";
import { EmailSkeleton } from "@/components/inbox-skeletons";

export default function Loading() {
  const searchParams = useSearchParams();
  return <EmailSkeleton reading={Boolean(searchParams.get("thread"))} />;
}
