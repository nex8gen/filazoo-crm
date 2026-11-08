"use client";

import { useEffect } from "react";
import { stickyTableHeaders } from "@/lib/sticky-table-headers";

export function WorkspaceTableHeaders() {
  useEffect(() => {
    const content = document.getElementById("workspace-content");
    if (content) return stickyTableHeaders(content);
  }, []);

  return null;
}
