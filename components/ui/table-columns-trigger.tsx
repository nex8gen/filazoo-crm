"use client";

import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function TableColumnsTrigger({ className }: { className?: string }) {
  return <DropdownMenuTrigger render={<Button type="button" variant="outline" size="icon" className={className} />} aria-label="Columns" title="Columns">
    <Columns3 aria-hidden="true" />
  </DropdownMenuTrigger>;
}
