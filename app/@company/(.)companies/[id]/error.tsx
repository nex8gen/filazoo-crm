"use client";

export default function Error({ reset }: { reset: () => void }) {
  return <div role="alert" className="space-y-4 py-12 text-center text-sm">
    <p>We could not load this company. Please try again.</p>
    <button type="button" onClick={reset} className="rounded-md border px-4 py-2 hover:bg-muted">Try again</button>
  </div>;
}
