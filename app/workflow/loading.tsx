"use client";

import { useSearchParams } from "next/navigation";
import { FlowEditorSkeleton, FlowsSkeleton } from "@/components/page-skeletons";

export default function Loading() {
  const searchParams = useSearchParams();
  return searchParams.get("flow") ? <FlowEditorSkeleton /> : <FlowsSkeleton />;
}
