"use client";

import { catchError, type ErrorInfo } from "next/error";

function WorkspaceUnavailable(_props: object, { retry }: ErrorInfo) {
  return (
    <main className="grid min-h-svh place-items-center bg-background p-6 text-foreground">
      <div role="alert" className="max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">Workspace temporarily unavailable</h1>
        <p className="text-sm text-muted-foreground">We could not load your workspace. Check your connection and try again.</p>
        <button type="button" onClick={retry} className="rounded-md bg-action px-4 py-2 text-sm font-medium text-action-foreground hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-ring">Try again</button>
      </div>
    </main>
  );
}

export const WorkspaceErrorBoundary = catchError(WorkspaceUnavailable);
