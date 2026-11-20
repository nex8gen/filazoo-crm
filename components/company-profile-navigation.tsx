"use client";

import { createContext } from "react";

// A refreshed profile has a list background but no originating history entry.
// Keep its close destination even if tab navigation activates an intercepted route.
export const CompanyProfileReturnContext = createContext<string | undefined>(undefined);
